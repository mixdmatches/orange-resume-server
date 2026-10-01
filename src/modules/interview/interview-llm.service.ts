import { BadRequestException, Injectable } from '@nestjs/common'
import { Observable } from 'rxjs'
import OpenAI from 'openai'
import type { AiCredentials } from '../user/user-ai-config.service'
import { AiCommonService } from '../shared/ai-common.service'

/* ============================================================
 * 契约冻结（contract frozen）：以下接口的返回结构不得随意修改，
 * 前后端 + DB 三方对齐，所有字段必须提供缺省值
 * ============================================================ */

/** 单题评价结果（JSON 输出契约） */
export interface QuestionEvaluation {
  /** 本题得分（0-100） */
  score: number
  /** 回答亮点 */
  strengths: string[]
  /** 回答不足 */
  weaknesses: string[]
  /** 综合点评（100-200 字） */
  feedback: string
  /** 提升建议 */
  suggestions: string[]
}

/** LLM 调用的 usage 统计（每个 assistant 消息落库时必填） */
export interface LlmUsage {
  /** 输入 token（prompt + history） */
  promptTokens: number
  /** 输出 token（模型生成） */
  completionTokens: number
}

/** 流式调用的返回包装：Observable 负责推送 content 增量，getUsage() 在流结束后返回真实 token */
export interface LlmStreamHandle {
  observable: Observable<{ content: string }>
  /** 流结束后调用拿 usage；流进行中或失败返回 0 值 */
  getUsage(): LlmUsage
}

/** 面试总结评分（JSON 输出契约，InterviewSession.scoreDetail 字段） */
export interface InterviewScoreDetail {
  /** 总分（0-100） */
  overallScore: number
  /** 分维度评分 */
  dimensions: Array<{
    name: string
    score: number
    comment: string
  }>
  /** 整体亮点 */
  strengths: string[]
  /** 主要不足 */
  weaknesses: string[]
  /** 改进建议（3-5 条） */
  suggestions: string[]
  /** 最终面试结论（推荐程度） */
  finalVerdict: string
}

/** 出题上下文（每轮动态出题用，含历史问答以支持追问） */
export interface QuestionPromptContext {
  /** 简历纯文本 */
  resumeText: string
  /** 目标岗位 */
  jobTitle?: string
  /** 岗位描述（可选，提供给 LLM 参考面试要求） */
  jobDescription?: string
  /** 面试难度 */
  difficulty: string
  /** 当前轮次（1 开始） */
  roundIndex: number
  /** 总轮数 */
  totalRounds: number
  /** 已发生的问答（第 1 轮为空数组；追问的上下文来源） */
  history: Array<{ round: number; question: string; answer: string }>
  /** 可选中止信号（客户端断开时中止上游请求） */
  signal?: AbortSignal
}

/** 单题评价上下文（动态出题模式无参考答案，由 LLM 直接评判） */
interface EvaluationPromptContext {
  question: string
  userAnswer: string
  roundIndex: number
  totalRounds: number
  jobDescription?: string
}

/** 总结评价上下文（直接基于 Q&A 评分，不依赖单题评价结果） */
interface SummaryPromptContext {
  questions: Array<{
    roundIndex: number
    question: string
    userAnswer: string
  }>
  jobTitle?: string
  jobDescription?: string
  difficulty: string
  signal?: AbortSignal
}

/**
 * 面试 LLM 封装服务
 *
 * 核心职责：把 OpenAI SDK 适配到面试业务的提示词 + JSON 契约 + 流式输出
 * 所有方法都是"纯粹的 LLM 调用"——不碰 DB、不做状态机，由 interview.service 编排调用
 *
 * 动态出题模式：不预生成题库，每轮根据简历 + 历史问答现场流式生成下一题（支持追问）
 */
@Injectable()
export class InterviewLlmService {
  constructor(private readonly aiCommon: AiCommonService) {}

  // ======================================================================
  // 内部辅助
  // ======================================================================

  /**
   * 创建 OpenAI 客户端（委托 AiCommonService，凭证仅在内存中短期使用）
   */
  private createClient(credentials: AiCredentials): OpenAI {
    return this.aiCommon.createOpenAIClient(credentials)
  }

  /**
   * 把 AI SDK 错误格式化为可读消息（委托 AiCommonService）
   */
  private formatError(error: unknown): string {
    return this.aiCommon.formatError(error)
  }

  /**
   * 把 API Key 掩码（委托 AiCommonService）
   */
  private maskKey(key: string): string {
    return this.aiCommon.maskKey(key)
  }

  // ======================================================================
  // 1. 流式出题（每轮动态生成，支持追问）
  // ======================================================================

  /**
   * 流式生成第 roundIndex 轮的面试题
   * - 第 1 轮：基于简历出开场题
   * - 后续轮：基于历史问答，优先对上一回答中值得深挖的点追问，否则切换考察维度
   * 输出为纯文本问题（流式 token），无 JSON 结构
   */
  streamQuestion(ctx: QuestionPromptContext, credentials: AiCredentials): LlmStreamHandle {
    const openai = this.createClient(credentials)

    const jobHint = ctx.jobTitle ? `，面向岗位「${ctx.jobTitle}」` : ''
    const jdHint = ctx.jobDescription
      ? `\n\n**岗位描述**（出题时需紧扣岗位要求考察候选人匹配度）：\n${ctx.jobDescription}`
      : ''

    const difficultyHint =
      ctx.difficulty === 'easy'
        ? '基础概念与直接经验'
        : ctx.difficulty === 'hard'
          ? '架构决策与底层原理'
          : '项目经验与实现原理'

    // 历史问答文本（第 1 轮为空）
    const historyText = ctx.history
      .map((h) => `【第 ${h.round} 题】${h.question}\n【候选人回答】${h.answer}`)
      .join('\n\n')

    const isFirst = ctx.history.length === 0
    const systemPrompt = `你是一位资深技术面试官${jobHint}${jdHint}，正在对候选人进行共 ${ctx.totalRounds} 轮、难度偏${ctx.difficulty}（考察${difficultyHint}）的模拟面试。

${
  isFirst
    ? `现在请提出第 1 个面试问题：
1. 从候选人简历中选择最值得考察的项目 / 技能点切入
2. 问题要具体、开放，能引导候选人展开（禁止"请介绍一下你自己"这类通用题）
3. 只提一个问题，直接输出问题文本，不要任何前缀、序号、解释或追问引导语`
    : `前面已经进行了 ${ctx.history.length} 轮问答，记录如下。现在请提出第 ${ctx.roundIndex} 个问题：
1. 优先对候选人上一题回答中值得深挖的点追问：表述含糊处、亮点技术方案、存疑的实现细节
2. 如果上一回答已经充分，则结合简历切换到尚未考察的维度（换项目 / 换技能点）
3. 追问要具体到上一回答的内容（可引用候选人原话中的关键词），不要泛泛而问
4. 只提一个问题，直接输出问题文本，不要任何前缀、序号、解释或追问引导语`
}`

    const userContent = isFirst
      ? `候选人简历内容：\n${ctx.resumeText}`
      : `候选人简历内容：\n${ctx.resumeText}\n\n=== 前面轮次的问答记录 ===\n${historyText}\n\n请提出第 ${ctx.roundIndex} 个问题。`

    // usage 闭包变量：流结束后由 getUsage() 返回
    let promptTokens = 0
    let completionTokens = 0

    const observable = new Observable<{ content: string }>((subscriber) => {
      ;(async () => {
        try {
          // 优先带 stream_options 统计 token；厂商不支持时降级重试一次
          const buildBody = (includeUsage: boolean) => ({
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userContent },
            ],
            model: credentials.modelId,
            temperature: 0.8,
            stream: true as const,
            ...(includeUsage ? { stream_options: { include_usage: true } } : {}),
          })
          let stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
          try {
            stream = (await openai.chat.completions.create(
              buildBody(true) as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
              { signal: ctx.signal },
            )) as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
          } catch {
            console.warn('[InterviewLlm] 厂商不支持 stream_options，降级为无 usage 统计重试')
            stream = (await openai.chat.completions.create(
              buildBody(false) as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
              { signal: ctx.signal },
            )) as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
          }

          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content || ''
            if (delta) subscriber.next({ content: delta })
            // 最后一个 chunk 可能携带 usage
            if (chunk.usage) {
              promptTokens = chunk.usage.prompt_tokens ?? 0
              completionTokens = chunk.usage.completion_tokens ?? 0
            }
          }
          subscriber.complete()
        } catch (error) {
          console.error(
            '[InterviewLlm] 流式出题失败（key=%s, round=%d）',
            this.maskKey(credentials.apiKey),
            ctx.roundIndex,
            error,
          )
          subscriber.error(new BadRequestException(this.formatError(error)))
        }
      })()
      return () => {}
    })

    return {
      observable,
      getUsage: () => ({ promptTokens, completionTokens }),
    }
  }

  // ======================================================================
  // 2. 单题评价（非流式，JSON 模式）
  // ======================================================================

  /**
   * 对用户的单题回答进行评分 + 反馈
   * 动态出题模式没有预生成的参考答案，由 LLM 基于问题本身直接评判
   */
  async evaluateAnswer(
    ctx: EvaluationPromptContext,
    credentials: AiCredentials,
  ): Promise<{ evaluation: QuestionEvaluation; usage: LlmUsage }> {
    const openai = this.createClient(credentials)

    const jdHint = ctx.jobDescription
      ? `\n\n**岗位描述**（评价时需参考候选人回答与岗位要求的匹配度）：\n${ctx.jobDescription}`
      : ''
    const systemPrompt = `你是一位专业的技术面试官，正在进行第 ${ctx.roundIndex}/${ctx.totalRounds} 题的评价。${jdHint}

严格输出以下 JSON 格式（不要输出任何其他内容）：
{
  "score": 85,
  "strengths": ["亮点1", "亮点2"],
  "weaknesses": ["不足1", "不足2"],
  "feedback": "综合点评（100-200 字，口语化但专业，不要用分点符号）",
  "suggestions": ["改进建议1", "改进建议2"]
}

评分标准：
- 90-100：回答完整且有深度，体现真实项目经验
- 75-89：回答基本正确，有一定细节但深度不足
- 60-74：回答有明显漏洞或偏题
- 0-59：完全答不出或答非所问

注意：
1. feedback 要具体，引用候选人回答中的原话片段
2. score 必须是整数`

    try {
      const completion = await openai.chat.completions.create({
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: `【面试问题】\n${ctx.question}\n\n【候选人回答】\n${ctx.userAnswer}`,
          },
        ],
        model: credentials.modelId,
        response_format: { type: 'json_object' },
        temperature: 0.3,
        stream: false,
      })

      const raw = completion.choices[0]?.message?.content || '{}'
      const parsed = JSON.parse(raw) as Partial<QuestionEvaluation>
      const usage: LlmUsage = {
        promptTokens: completion.usage?.prompt_tokens ?? 0,
        completionTokens: completion.usage?.completion_tokens ?? 0,
      }

      // 全字段兜底（契约冻结，所有字段必须有值）
      return {
        evaluation: {
          score: Math.max(0, Math.min(100, Math.round(parsed.score ?? 50))),
          strengths:
            Array.isArray(parsed.strengths) && parsed.strengths.length
              ? (parsed.strengths as string[]).slice(0, 3)
              : ['回答态度认真'],
          weaknesses:
            Array.isArray(parsed.weaknesses) && parsed.weaknesses.length
              ? (parsed.weaknesses as string[]).slice(0, 3)
              : ['回答可进一步深化'],
          feedback: parsed.feedback ?? '该问题的回答基本符合预期，建议在细节上进一步完善。',
          suggestions:
            Array.isArray(parsed.suggestions) && parsed.suggestions.length
              ? (parsed.suggestions as string[]).slice(0, 3)
              : ['建议多结合具体项目经验展开回答'],
        },
        usage,
      }
    } catch (error) {
      console.error('[InterviewLlm] 评价失败（round=%d）', ctx.roundIndex, error)
      // 评价失败不阻塞面试——返回兜底值让流程继续
      return {
        evaluation: {
          score: 50,
          strengths: ['回答态度认真'],
          weaknesses: ['评价生成失败，请重试'],
          feedback: '评价生成失败，请稍后重试。',
          suggestions: ['建议稍后重新参加该题评价'],
        },
        usage: { promptTokens: 0, completionTokens: 0 },
      }
    }
  }

  // ======================================================================
  // 3. 面试总结评分（非流式 JSON）+ 流式总结文本
  // ======================================================================

  /**
   * 生成结构化总结评分（非流式 JSON，用于回填 interview_session.total_score + score_detail）
   * 同时返回基于评分拼接的自然语言总结文本（作为流式总结失败时的兜底）
   */
  async generateSummary(
    ctx: SummaryPromptContext,
    credentials: AiCredentials,
  ): Promise<{ scoreDetail: InterviewScoreDetail; summaryText: string; usage: LlmUsage }> {
    const openai = this.createClient(credentials)

    const jobHint = ctx.jobTitle ? `，面向岗位「${ctx.jobTitle}」` : ''
    const jdHint = ctx.jobDescription
      ? `\n\n**岗位描述**（总结时需参考候选人整体表现与岗位要求的匹配度）：\n${ctx.jobDescription}`
      : ''
    const allQaText = ctx.questions
      .map(
        (q) =>
          `--- 第 ${q.roundIndex} 题 ---\n` +
          `问题：${q.question}\n` +
          `候选人回答：${q.userAnswer}`,
      )
      .join('\n\n')

    const systemPrompt = `你是一位资深技术面试官${jobHint}${jdHint}，请根据候选人在本轮面试中的所有问答，独立判断并生成综合评分。

评分时请你自己根据问答内容判断候选人的技术能力、项目深度、沟通表达等维度，不要依赖任何外部评价。

严格输出以下 JSON 格式（不要输出任何其他内容）：
{
  "overallScore": 78,
  "dimensions": [
    { "name": "技术能力", "score": 80, "comment": "..." },
    { "name": "项目深度", "score": 75, "comment": "..." },
    { "name": "沟通表达", "score": 82, "comment": "..." },
    { "name": "问题解决", "score": 70, "comment": "..." }
  ],
  "strengths": ["亮点1", "亮点2", "亮点3"],
  "weaknesses": ["不足1", "不足2", "不足3"],
  "suggestions": ["改进建议1", "改进建议2", "改进建议3"],
  "finalVerdict": "强烈推荐 / 推荐 / 考虑 / 暂不推荐"
}

评分标准：
- 85-100：强烈推荐，可直接进入下一轮
- 70-84：推荐，有一定基础但需关注薄弱点
- 55-69：考虑，基础不牢，需要加强
- 0-54：暂不推荐，差距较大

要求：
1. dimensions 固定 4 个维度（技术能力/项目深度/沟通表达/问题解决）
2. 每个维度 comment 要简洁（20-50 字）
3. strengths / weaknesses / suggestions 各 3 条`

    try {
      const completion = await openai.chat.completions.create({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `面试难度：${ctx.difficulty}\n\n${allQaText}` },
        ],
        model: credentials.modelId,
        response_format: { type: 'json_object' },
        temperature: 0.3,
        stream: false,
      })

      const raw = completion.choices[0]?.message?.content || '{}'
      const parsed = JSON.parse(raw) as Partial<InterviewScoreDetail>

      // 全字段兜底（契约冻结）
      const dimensions =
        Array.isArray(parsed.dimensions) && parsed.dimensions.length
          ? (parsed.dimensions as InterviewScoreDetail['dimensions'])
          : [
              { name: '技术能力', score: 50, comment: '暂无评价' },
              { name: '项目深度', score: 50, comment: '暂无评价' },
              { name: '沟通表达', score: 50, comment: '暂无评价' },
              { name: '问题解决', score: 50, comment: '暂无评价' },
            ]

      const scoreDetail: InterviewScoreDetail = {
        overallScore: Math.max(0, Math.min(100, Math.round(parsed.overallScore ?? 50))),
        dimensions: dimensions.map((d) => ({
          name: d.name ?? '综合能力',
          score: Math.max(0, Math.min(100, Math.round(d.score ?? 50))),
          comment: d.comment ?? '暂无评价',
        })),
        strengths:
          Array.isArray(parsed.strengths) && parsed.strengths.length
            ? (parsed.strengths as string[]).slice(0, 3)
            : ['候选人态度积极'],
        weaknesses:
          Array.isArray(parsed.weaknesses) && parsed.weaknesses.length
            ? (parsed.weaknesses as string[]).slice(0, 3)
            : ['部分问题回答不够深入'],
        suggestions:
          Array.isArray(parsed.suggestions) && parsed.suggestions.length
            ? (parsed.suggestions as string[]).slice(0, 5)
            : ['建议多做模拟面试练习'],
        finalVerdict:
          parsed.finalVerdict && typeof parsed.finalVerdict === 'string'
            ? parsed.finalVerdict
            : '暂不推荐',
      }

      // 自然语言总结文本（流式总结失败时的兜底内容）
      const summaryText = this.buildSummaryText(scoreDetail)

      const usage: LlmUsage = {
        promptTokens: completion.usage?.prompt_tokens ?? 0,
        completionTokens: completion.usage?.completion_tokens ?? 0,
      }

      return { scoreDetail, summaryText, usage }
    } catch (error) {
      console.error('[InterviewLlm] 总结生成失败（key=%s）', this.maskKey(credentials.apiKey))
      throw new BadRequestException(this.formatError(error))
    }
  }

  /**
   * 生成面试总结文本的流式 Observable（非 JSON 模式，直接流式自然语言）
   * 返回 LlmStreamHandle：订阅 observable 拿 content 增量，流结束后 getUsage() 拿 token
   */
  streamSummaryText(ctx: SummaryPromptContext, credentials: AiCredentials): LlmStreamHandle {
    const openai = this.createClient(credentials)

    const jobHint = ctx.jobTitle ? `，面向岗位「${ctx.jobTitle}」` : ''
    const jdHint = ctx.jobDescription
      ? `\n\n**岗位描述**（总结时需参考候选人整体表现与岗位要求的匹配度）：\n${ctx.jobDescription}`
      : ''
    const allQaText = ctx.questions
      .map(
        (q) =>
          `--- 第 ${q.roundIndex} 题 ---\n` +
          `问题：${q.question}\n` +
          `候选人回答：${q.userAnswer}`,
      )
      .join('\n\n')

    const systemPrompt = `你是一位资深技术面试官${jobHint}${jdHint}，正在根据候选人的所有问答生成面试总结报告。
请用 Markdown 格式输出一份 200-400 字的总结，结构：
1. **整体印象**（1-2 句）
2. **优势亮点**（3 条以内，用 - 列表）
3. **待改进点**（3 条以内，用 - 列表）
4. **最终结论**（推荐程度 + 简要理由）

请你独立判断候选人表现，不要依赖任何外部评价。用第一人称，语气专业但友好。直接开始输出，不要写标题。`

    let promptTokens = 0
    let completionTokens = 0

    const observable = new Observable<{ content: string }>((subscriber) => {
      ;(async () => {
        try {
          // 优先带 stream_options 统计 token；厂商不支持时降级重试一次
          const buildBody = (includeUsage: boolean) => ({
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: allQaText },
            ],
            model: credentials.modelId,
            temperature: 0.5,
            stream: true as const,
            ...(includeUsage ? { stream_options: { include_usage: true } } : {}),
          })
          let stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
          try {
            stream = (await openai.chat.completions.create(
              buildBody(true) as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
              { signal: ctx.signal },
            )) as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
          } catch {
            console.warn('[InterviewLlm] 厂商不支持 stream_options，降级为无 usage 统计重试')
            stream = (await openai.chat.completions.create(
              buildBody(false) as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
              { signal: ctx.signal },
            )) as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
          }

          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content || ''
            if (delta) subscriber.next({ content: delta })
            if (chunk.usage) {
              promptTokens = chunk.usage.prompt_tokens ?? 0
              completionTokens = chunk.usage.completion_tokens ?? 0
            }
          }
          subscriber.complete()
        } catch (error) {
          console.error('[InterviewLlm] 流式总结失败', error)
          subscriber.error(new BadRequestException(this.formatError(error)))
        }
      })()
      return () => {}
    })

    return {
      observable,
      getUsage: () => ({ promptTokens, completionTokens }),
    }
  }

  // ======================================================================
  // 辅助：把结构化评分拼成自然语言总结（流式总结失败时的兜底）
  // ======================================================================

  /**
   * 兜底总结文本
   */
  private buildSummaryText(score: InterviewScoreDetail): string {
    const verdict = score.finalVerdict || '暂不推荐'
    return [
      `**整体印象**：本次面试综合得分 ${score.overallScore} 分，${verdict}。`,
      '',
      '**优势亮点**：',
      ...score.strengths.map((s) => `- ${s}`),
      '',
      '**待改进点**：',
      ...score.weaknesses.map((w) => `- ${w}`),
      '',
      '**改进建议**：',
      ...score.suggestions.map((s) => `- ${s}`),
    ].join('\n')
  }
}
