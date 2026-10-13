import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Observable } from 'rxjs'
import type { AiSession, InterviewSession, InterviewStatus, Prisma } from '@prisma/client'
import { PrismaService } from '@/prisma/prisma.service'
import type { AiCredentials } from '../user/user-ai-config.service'
import { CredentialService } from '../shared/credential.service'
import { SessionGuardService } from '../shared/session-guard.service'
import { InterviewLlmService, type InterviewScoreDetail } from './interview-llm.service'
import type { CreateInterviewDto } from './dto/create-interview.dto'
import type { InterviewStreamDto } from './dto/interview-stream.dto'
import { SsePush, InterviewSseEvent, InterviewDetail } from '@/common/types/interview'

/**
 * 面试编排服务
 *
 * 状态机：pending_questions ──start──→ in_progress ──all answered/finish──→ finished
 * 附加：客户端中途中止（停止生成/断开）→ stopped；继续答题或重新出题后恢复 in_progress
 */
@Injectable()
export class InterviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly interviewLlm: InterviewLlmService,
    private readonly credentialService: CredentialService,
    private readonly sessionGuard: SessionGuardService,
  ) {}
  /**
   * 从 extra JSON 安全读取字段（Prisma Json 类型在 MySQL 中可能是对象或 null）
   * 返回值直接 as T，调用方按字段类型正确读取
   */
  private getExtra<T extends Record<string, any>>(extra: Prisma.InputJsonValue | null): T {
    if (!extra || typeof extra !== 'object') return {} as T
    return extra as unknown as T
  }

  /**
   * 序列化面试会话：BigInt → string，保证安全 JSON.stringify
   */
  private serializeInterviewSession(
    session: AiSession & { interviewSession: InterviewSession },
  ): Record<string, unknown> {
    return {
      id: String(session.id),
      userId: session.userId,
      type: session.type,
      title: session.title,
      providerId: session.providerId,
      modelId: session.modelId,
      status: session.status,
      interviewStatus: session.interviewSession.status,
      resumeId: session.interviewSession.resumeId,
      jobTitle: session.interviewSession.jobTitle,
      difficulty: session.interviewSession.difficulty,
      category: session.interviewSession.category,
      jobDescription: session.interviewSession.jobDescription,
      questionCount: session.interviewSession.questionCount,
      totalScore: session.interviewSession.totalScore
        ? Number(session.interviewSession.totalScore)
        : null,
      summary: session.interviewSession.summary,
      scoreDetail: session.interviewSession.scoreDetail ?? null,
      durationSec: session.interviewSession.durationSec,
      startedAt: session.interviewSession.startedAt,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    }
  }

  /**
   * 创建面试会话（双写 ai_session + interview_session，状态 pending_questions）
   */
  async createInterview(userId: number, dto: CreateInterviewDto): Promise<Record<string, unknown>> {
    // 校验简历归属
    const resume = await this.prisma.resume.findUnique({ where: { id: dto.resumeId } })
    if (!resume || resume.userId !== userId) {
      throw new NotFoundException('简历不存在或无权访问')
    }

    // 面试标题（由岗位自动生成）
    const title = dto.jobTitle ? `${dto.jobTitle} 面试` : `面试 - ${resume.title || '我的简历'}`

    const session = await this.prisma.$transaction(async (tx) => {
      const aiSession = await tx.aiSession.create({
        data: {
          userId,
          type: 'interview',
          title,
          providerId: dto.providerId,
          modelId: dto.modelId,
          resumeId: dto.resumeId,
        },
      })
      const interviewSession = await tx.interviewSession.create({
        data: {
          sessionId: aiSession.id,
          resumeId: dto.resumeId,
          jobTitle: dto.jobTitle,
          jobDescription: dto.jobDescription,
          difficulty: dto.difficulty ?? 'medium',
          category: dto.category,
          questionCount: dto.questionCount ?? 5,
          status: 'pending_questions',
        },
      })
      return { aiSession, interviewSession }
    })

    return this.serializeInterviewSession({
      ...session.aiSession,
      interviewSession: session.interviewSession,
    } as AiSession & { interviewSession: InterviewSession })
  }

  /**
   * 面试统一 SSE 流
   */
  interviewStream(
    userId: number,
    sessionIdStr: string,
    dto: InterviewStreamDto,
  ): Observable<{ data: string }> {
    return new Observable((subscriber) => {
      const streamAbort = new AbortController()
      let finished = false
      let interviewId: bigint | null = null

      const push: SsePush = (payload: InterviewSseEvent) => {
        subscriber.next({ data: JSON.stringify(payload) })
      }

      /** 统一收口：标记流正常完成后关闭（teardown 看到 finished=true 就不做中止处理） */
      const finish = () => {
        finished = true
        subscriber.complete()
      }

      ;(async () => {
        try {
          // 1. 校验会话归属 + 状态
          const interview = await this.sessionGuard.findOwnedInterview(userId, sessionIdStr)
          interviewId = interview.id
          const iSession = interview.interviewSession
          if (iSession.status === 'finished') {
            push({ event: 'error', message: '面试已结束' })
            finish()
            return
          }

          // 2. 解析凭证（三条路径共用）
          const credentials = await this.credentialService.resolveCredentials(
            userId,
            interview.providerId ?? undefined,
          )

          // 3a. 未开始 → 流式出第一题（round=1，出完落库并把状态推进到 in_progress）
          //     （stopped 状态的第一题被中止后，重新触发流也会走这里重新出题）
          if (iSession.status === 'pending_questions') {
            await this.runAskQuestion(interview, push, credentials, 1, streamAbort.signal)
            finish()
            return
          }

          // 3b. 进行中（含 stopped 恢复）→ 答题 / 提前结束
          const finishOnly = dto.finishOnly === true
          const content = dto.content?.trim() ?? ''
          if (!content && !finishOnly) {
            push({ event: 'error', message: '请填写回答内容' })
            finish()
            return
          }

          // 当前轮次 = 已回答题数 + 1；总轮数为固定常量
          const answeredCount = await this.prisma.aiSessionMessage.count({
            where: { sessionId: interview.id, kind: 'answer' },
          })
          const currentRound = answeredCount + 1
          const totalRounds = interview.interviewSession.questionCount

          // 提前结束且放弃当前题（不带 content）：不落库回答，直接总结
          if (finishOnly && !content) {
            await this.runSummary(interview, push, credentials, streamAbort.signal)
            finish()
            return
          }

          // 4. 落库用户回答
          await this.prisma.aiSessionMessage.create({
            data: {
              sessionId: interview.id,
              role: 'user',
              kind: 'answer',
              content,
              extra: { roundIndex: currentRound },
            },
          })

          // 提前结束且提交了本题回答：落库后不评价，直接总结
          if (finishOnly) {
            await this.runSummary(interview, push, credentials, streamAbort.signal)
            finish()
            return
          }

          // 6. 判断是否还有下一轮（面试结束后统一评价所有回答，不在每题后评价）
          const hasNext = currentRound < totalRounds

          // 7. 还有轮次 → 流式出下一题（追问式）；轮次用尽 → 总结
          if (hasNext) {
            await this.runAskQuestion(
              interview,
              push,
              credentials,
              currentRound + 1,
              streamAbort.signal,
            )
            finish()
            return
          }
          await this.runSummary(interview, push, credentials, streamAbort.signal)
          finish()
        } catch (error) {
          console.error('[Interview] 面试流程失败', error)
          push({
            event: 'error',
            message: error instanceof Error ? error.message : '面试流程失败',
          })
          finish()
        }
      })()

      // teardown：SSE 连接关闭时触发（正常 complete 与客户端断开都会走到这里）
      return () => {
        // 正常完成（done/error 事件推送完毕后连接关闭），不做中止处理
        if (finished) return

        // 用户中途中止（停止生成按钮 / 关闭页面 / 刷新）：
        // 1. abort 正在进行中的 LLM 上游请求（出题/总结流式生成），避免白白消耗 token
        streamAbort.abort()
        // 2. 面试尚未结束 → 状态标记为 stopped（数据库留痕，可恢复继续）
        //    updateMany 带 status 条件，防止竞态覆盖刚写入的 finished
        if (interviewId) {
          this.prisma.interviewSession
            .updateMany({
              where: {
                sessionId: interviewId,
                status: { in: ['pending_questions', 'in_progress'] },
              },
              data: { status: 'stopped' },
            })
            .catch((e) => console.error('[Interview] 标记中止状态失败', e))
        }
      }
    })
  }

  /**
   * 流式生成第 round 轮的面试题并落库
   */
  private async runAskQuestion(
    interview: AiSession & { interviewSession: InterviewSession },
    push: SsePush,
    credentials: AiCredentials,
    round: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const iSession = interview.interviewSession
    const totalRounds = iSession.questionCount

    // 0. 推开始事件（前端显示"面试官正在提问…"）
    push({ event: 'question_start', round, totalRounds })

    // 1. 读简历内容（拼接所有 section 为纯文本）
    const resume = await this.prisma.resume.findUnique({ where: { id: iSession.resumeId } })
    if (!resume) throw new NotFoundException('简历不存在')
    const resumeText = this.stringifyResumeContent(resume.content as Prisma.InputJsonValue)

    // 2. 收集历史问答（追问的上下文来源）
    const history = await this.collectHistory(interview.id)

    // 3. 流式出题：逐 token 推送，同时累积全文；流结束后从 handle 拿 usage
    //    signal 来自外层 interviewStream（客户端中途中止时被 abort）
    let fullQuestion = ''
    const qHandle = this.interviewLlm.streamQuestion(
      {
        resumeText,
        jobTitle: iSession.jobTitle ?? undefined,
        jobDescription: iSession.jobDescription ?? undefined,
        difficulty: iSession.difficulty,
        roundIndex: round,
        totalRounds,
        history,
        signal,
      },
      credentials,
    )
    await new Promise<void>((resolve, reject) => {
      qHandle.observable.subscribe({
        next: (chunk) => {
          fullQuestion += chunk.content
          push({ event: 'question', content: chunk.content })
        },
        error: (err) => reject(err),
        complete: () => resolve(),
      })
    })
    const qUsage = qHandle.getUsage()

    const questionText = fullQuestion.trim()
    if (!questionText) {
      throw new BadRequestException('题目生成失败，请重试')
    }

    // 4. 落库题目（含 token 统计）+ 推完成事件；状态统一推进为 in_progress（恢复 stopped），首轮记录 startedAt
    await this.prisma.$transaction(async (tx) => {
      await tx.aiSessionMessage.create({
        data: {
          sessionId: interview.id,
          role: 'system',
          kind: 'question',
          content: questionText,
          promptTokens: qUsage.promptTokens,
          completionTokens: qUsage.completionTokens,
          extra: { roundIndex: round },
        },
      })
      await tx.interviewSession.update({
        where: { sessionId: interview.id },
        data: {
          status: 'in_progress',
          ...(round === 1 ? { startedAt: new Date() } : {}),
        },
      })
      // 刷新 ai_session.updatedAt
      await tx.aiSession.update({
        where: { id: interview.id },
        data: { updatedAt: new Date() },
      })
    })
    push({ event: 'question_done', round, totalRounds })
  }

  /**
   * 收集已发生的问答（question 与 answer 按 roundIndex 配对），作为下一题追问的上下文
   * @param sessionId 会话 ID
   * @returns 按轮次升序的问答列表（第 1 轮出题时为空数组）
   */
  private async collectHistory(
    sessionId: bigint,
  ): Promise<Array<{ round: number; question: string; answer: string }>> {
    const messages = await this.prisma.aiSessionMessage.findMany({
      where: { sessionId, kind: { in: ['question', 'answer'] } },
      orderBy: { id: 'asc' },
    })
    const history: Array<{ round: number; question: string; answer: string }> = []
    let current: { round: number; question: string; answer: string } | null = null
    for (const msg of messages) {
      const extra = this.getExtra<{ roundIndex?: number }>(msg.extra)
      const round = typeof extra.roundIndex === 'number' ? extra.roundIndex : history.length + 1
      if (msg.kind === 'question') {
        if (current) history.push(current)
        current = { round, question: msg.content, answer: '' }
      } else if (current && msg.kind === 'answer') {
        current.answer = msg.content
      }
    }
    if (current) history.push(current)
    return history
  }

  /**
   * 总结阶段：收集所有 Q&A → 调 LLM 生成结构化评分 + 流式总结文本 → 填 DB
   * 同时推送 SSE 帧：summary_start → summary* → done
   */
  private async runSummary(
    interview: AiSession & { interviewSession: InterviewSession },
    push: SsePush,
    credentials: AiCredentials,
    signal?: AbortSignal,
  ): Promise<void> {
    // 1. 收集所有 Q&A
    const allMessages = await this.prisma.aiSessionMessage.findMany({
      where: { sessionId: interview.id },
      orderBy: { id: 'asc' },
    })

    const questions: Array<{ roundIndex: number; question: string }> = []
    const answers: Record<number, string> = {}

    for (const msg of allMessages) {
      const extra = this.getExtra<{ roundIndex?: number }>(msg.extra)

      if (msg.kind === 'question' && typeof extra.roundIndex === 'number') {
        questions.push({ roundIndex: extra.roundIndex, question: msg.content })
      } else if (msg.kind === 'answer' && typeof extra.roundIndex === 'number') {
        answers[extra.roundIndex] = msg.content
      }
    }

    questions.sort((a, b) => a.roundIndex - b.roundIndex)

    // 空回答检查：一题都没答就无法生成有意义的总结（提前放弃场景）
    if (Object.keys(answers).length === 0) {
      throw new BadRequestException('您还没有回答任何问题，无法生成面试总结')
    }

    // 2. 立刻开始总结（不等评价，用户体验优先）
    push({ event: 'summary_start' })

    // 3. 调 LLM 生成结构化评分（直接基于 Q&A，不依赖单题评价）
    const {
      scoreDetail,
      summaryText,
      usage: summaryJsonUsage,
    } = await this.interviewLlm.generateSummary(
      {
        questions: questions.map((q) => ({
          roundIndex: q.roundIndex,
          question: q.question,
          userAnswer: answers[q.roundIndex] ?? '（候选人未作答）',
        })),
        jobTitle: interview.interviewSession.jobTitle ?? undefined,
        jobDescription: interview.interviewSession.jobDescription ?? undefined,
        difficulty: interview.interviewSession.difficulty,
      },
      credentials,
    )

    // 4. 流式推送总结文本（兜底：如果流式失败则直接用已生成的 summaryText）
    let summaryStreamUsage = { promptTokens: 0, completionTokens: 0 }
    try {
      const sHandle = this.interviewLlm.streamSummaryText(
        {
          questions: questions.map((q) => ({
            roundIndex: q.roundIndex,
            question: q.question,
            userAnswer: answers[q.roundIndex] ?? '（候选人未作答）',
          })),
          jobTitle: interview.interviewSession.jobTitle ?? undefined,
          jobDescription: interview.interviewSession.jobDescription ?? undefined,
          difficulty: interview.interviewSession.difficulty,
          signal,
        },
        credentials,
      )
      await new Promise<void>((resolve, reject) => {
        sHandle.observable.subscribe({
          next: (chunk) => push({ event: 'summary', content: chunk.content }),
          error: (err) => reject(err),
          complete: () => resolve(),
        })
      })
      summaryStreamUsage = sHandle.getUsage()
    } catch {
      // 流式总结失败：推送兜底 summaryText
      push({ event: 'summary', content: summaryText })
    }

    // 汇总两次 LLM 调用的 token（generateSummary + streamSummaryText）
    const summaryPromptTokens = summaryJsonUsage.promptTokens + summaryStreamUsage.promptTokens
    const summaryCompletionTokens =
      summaryJsonUsage.completionTokens + summaryStreamUsage.completionTokens

    // 5. 更新 interview_session + 写总结消息（含 token 统计）
    const startedAt = interview.interviewSession.startedAt
    const durationSec = startedAt ? Math.floor((Date.now() - startedAt.getTime()) / 1000) : null

    const updated = await this.prisma.$transaction(async (tx) => {
      // 写总结消息（kind=evaluation，额外标记）
      await tx.aiSessionMessage.create({
        data: {
          sessionId: interview.id,
          role: 'assistant',
          kind: 'evaluation',
          content: summaryText,
          promptTokens: summaryPromptTokens,
          completionTokens: summaryCompletionTokens,
          extra: { isSummary: true, overallScore: scoreDetail.overallScore },
        },
      })
      // 更新 interview_session 为 finished
      return tx.interviewSession.update({
        where: { sessionId: interview.id },
        data: {
          status: 'finished',
          totalScore: scoreDetail.overallScore,
          scoreDetail: scoreDetail as unknown as Prisma.InputJsonValue,
          summary: summaryText,
          durationSec,
        },
      })
    })

    // 6. 推送 done 事件（面试正式结束）
    push({
      event: 'done',
      totalScore: scoreDetail.overallScore,
      summary: summaryText,
      scoreDetail,
      interviewSession: this.serializeInterviewSession({
        ...interview,
        interviewSession: updated,
      }),
    })

    // 7. 后台静默批量评价（用户已看到总结，不阻塞体验；失败不影响 done 事件）
    // 用 fire-and-forget：不在 await 里，SSE 连接关闭后仍可继续执行
    this.runSilentEvaluation(interview, questions, answers, credentials).catch((e) => {
      console.error('[Interview] 后台评价失败（不影响主流程）', e)
    })
  }

  /**
   * 后台静默批量评价：done 事件推送后才开始执行
   */
  private async runSilentEvaluation(
    interview: AiSession & { interviewSession: InterviewSession },
    questions: Array<{ roundIndex: number; question: string }>,
    answers: Record<number, string>,
    credentials: AiCredentials,
  ): Promise<void> {
    const totalRounds = interview.interviewSession.questionCount
    const answeredQuestions = questions.filter((q) => answers[q.roundIndex])
    for (const q of answeredQuestions) {
      const round = q.roundIndex
      const { evaluation: ev, usage } = await this.interviewLlm.evaluateAnswer(
        {
          question: q.question,
          userAnswer: answers[round],
          roundIndex: round,
          totalRounds,
          jobDescription: interview.interviewSession.jobDescription ?? undefined,
        },
        credentials,
      )
      await this.prisma.aiSessionMessage.create({
        data: {
          sessionId: interview.id,
          role: 'assistant',
          kind: 'evaluation',
          content: ev.feedback,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          extra: {
            roundIndex: round,
            score: ev.score,
            strengths: ev.strengths,
            weaknesses: ev.weaknesses,
            suggestions: ev.suggestions,
          },
        },
      })
    }
    console.log('[Interview] 后台评价完成，共', answeredQuestions.length, '题')
  }

  /** 面试列表（offset 分页，按最近活跃倒序，排除已删除） */
  async listInterviews(
    userId: number,
    page: number,
    pageSize: number,
  ): Promise<{ list: Record<string, unknown>[]; total: number; page: number; pageSize: number }> {
    const where: Prisma.AiSessionWhereInput = {
      userId,
      type: 'interview',
      status: { not: 'deleted' },
    }
    const [rows, total] = await Promise.all([
      this.prisma.aiSession.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { interviewSession: true, _count: { select: { messages: true } } },
      }),
      this.prisma.aiSession.count({ where }),
    ])

    if (rows.length == 0) {
      return {
        list: [],
        total,
        page,
        pageSize,
      }
    }
    const serializeList = rows.map((row) =>
      this.serializeInterviewSession(row as AiSession & { interviewSession: InterviewSession }),
    )
    return {
      list: serializeList,
      total,
      page,
      pageSize,
    }
  }

  /** 面试详情（含所有消息 + 评分） */
  async getInterview(userId: number, sessionIdStr: string): Promise<InterviewDetail> {
    const interview = await this.sessionGuard.findOwnedInterview(userId, sessionIdStr)
    const iSession = interview.interviewSession

    // 按 roundIndex 读取题目/回答/评价
    const messages = await this.prisma.aiSessionMessage.findMany({
      where: { sessionId: interview.id },
      orderBy: { id: 'asc' },
    })

    const details: InterviewDetail = {
      id: String(interview.id),
      userId: interview.userId,
      resumeId: iSession.resumeId,
      jobTitle: iSession.jobTitle,
      difficulty: iSession.difficulty,
      category: iSession.category,
      status: iSession.status,
      totalRounds: 0,
      answeredRounds: 0,
      totalScore: iSession.totalScore ? Number(iSession.totalScore) : null,
      summary: iSession.summary,
      scoreDetail: (iSession.scoreDetail as unknown as InterviewScoreDetail | null) ?? null,
      durationSec: iSession.durationSec,
      questions: [],
      answers: [],
      evaluations: [],
      createdAt: interview.createdAt.toISOString(),
      updatedAt: interview.updatedAt.toISOString(),
    }

    for (const msg of messages) {
      // 动态出题模式：题目 extra 只存 roundIndex；评价 extra 存评分结构
      const extra = this.getExtra<{
        roundIndex?: number
        score?: number
        feedback?: string
        strengths?: string[]
        weaknesses?: string[]
        suggestions?: string[]
      }>(msg.extra)

      if (msg.kind === 'question' && typeof extra.roundIndex === 'number') {
        details.questions.push({
          roundIndex: extra.roundIndex,
          question: msg.content,
        })
      } else if (msg.kind === 'answer' && typeof extra.roundIndex === 'number') {
        details.answers.push({ roundIndex: extra.roundIndex, content: msg.content })
      } else if (msg.kind === 'evaluation' && typeof extra.roundIndex === 'number') {
        // 总结消息的 extra 只有 { isSummary, overallScore }，没有 roundIndex，
        // 上面按 roundIndex 判断即可天然排除总结，不会混进单题评价
        details.evaluations.push({
          roundIndex: extra.roundIndex,
          score: extra.score ?? 0,
          feedback: msg.content,
          strengths: Array.isArray(extra.strengths) ? extra.strengths : [],
          weaknesses: Array.isArray(extra.weaknesses) ? extra.weaknesses : [],
          suggestions: Array.isArray(extra.suggestions) ? extra.suggestions : [],
        })
      }
    }

    details.totalRounds = details.questions.length
    details.answeredRounds = details.answers.length

    return details
  }

  /** 软删除面试（标记 ai_session.status=deleted） */
  async deleteInterview(userId: number, sessionIdStr: string): Promise<{ success: true }> {
    const interview = await this.sessionGuard.findOwnedInterview(userId, sessionIdStr)
    await this.prisma.aiSession.update({
      where: { id: interview.id },
      data: { status: 'deleted' },
    })
    return { success: true }
  }

  /**
   * 把 Resume JSON 内容（前端 Resume 接口结构）拼接成纯文本
   */
  private stringifyResumeContent(content: Prisma.InputJsonValue): string {
    if (!content || typeof content !== 'object') return ''
    const c = content as Record<string, unknown>

    const parts: string[] = []
    const basic = (c.basic ?? {}) as Record<string, unknown>
    if (basic.name) parts.push(`姓名：${basic.name}`)
    if (basic.position) parts.push(`岗位：${basic.position}`)
    if (basic.phone) parts.push(`电话：${basic.phone}`)
    if (basic.email) parts.push(`邮箱：${basic.email}`)

    const sections: Array<{ key: string; label: string; format: (item: unknown) => string }> = [
      {
        key: 'educations',
        label: '教育经历',
        format: (e) =>
          `${(e as any).school} - ${(e as any).major} ${(e as any).degree ?? ''} ${(e as any).dateRange ?? ''}\n${(e as any).description ?? ''}`,
      },
      {
        key: 'internships',
        label: '实习经历',
        format: (e) =>
          `${(e as any).companyName} - ${(e as any).position} ${(e as any).dateRange ?? ''}\n${(e as any).description ?? ''}`,
      },
      {
        key: 'projects',
        label: '项目经历',
        format: (e) =>
          `${(e as any).name} - ${(e as any).role ?? ''} ${(e as any).dateRange ?? ''}\n${(e as any).description ?? ''}`,
      },
    ]

    for (const { key, label, format } of sections) {
      const arr = c[key] as unknown[] | undefined
      if (Array.isArray(arr) && arr.length > 0) {
        parts.push(`\n## ${label}`)
        for (const item of arr) {
          if ((item as any).visible === false) continue
          parts.push(format(item))
        }
      }
    }

    if (c.skills) parts.push(`\n## 技能\n${c.skills}`)
    if (c.summary) parts.push(`\n## 自我评价\n${c.summary}`)

    return parts.join('\n').trim()
  }
}
