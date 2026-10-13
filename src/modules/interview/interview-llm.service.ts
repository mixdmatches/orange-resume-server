import { BadRequestException, Injectable } from '@nestjs/common'
import { Observable } from 'rxjs'
import type { AiCredentials } from '../user/user-ai-config.service'
import { AiCommonService } from '../shared/ai-common.service'
import {
  EVALUATION_JSON_FORMAT,
  SUMMARY_JSON_FORMAT,
  evaluateAnswerPrompt,
  firstQuestionPrompt,
  followupQuestionPrompt,
  generateSummaryPrompt,
  streamSummaryTextPrompt,
} from './prompts/interview.prompts'

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
 * 核心职责：把 OpenAI SDK 适配到面试业务的提示词 + JSON 契约 + 流式输出
 * 所有方法都是"纯粹的 LLM 调用"——不碰 DB、不做状态机，由 interview.service 编排调用
 */
@Injectable()
export class InterviewLlmService {
  constructor(private readonly aiCommon: AiCommonService) {}

  /**
   * 流式生成第 roundIndex 轮的面试题
   * - 第 1 轮：基于简历出开场题
   * - 后续轮：基于历史问答，优先对上一回答中值得深挖的点追问，否则切换考察维度
   * 输出为纯文本问题（流式 token），无 JSON 结构
   */
  streamQuestion(ctx: QuestionPromptContext, credentials: AiCredentials): LlmStreamHandle {
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

    const isFirst = ctx.history.length === 0
    const historyText = ctx.history
      .map((h) => `【第 ${h.round} 题】${h.question}\n【候选人回答】${h.answer}`)
      .join('\n\n')

    // 首轮 / 后续轮使用不同模板
    const prompt = isFirst ? firstQuestionPrompt : followupQuestionPrompt
    const formatVars = isFirst
      ? {
          jobHint,
          jdHint,
          totalRounds: ctx.totalRounds,
          difficulty: ctx.difficulty,
          difficultyHint,
          resumeText: ctx.resumeText,
        }
      : {
          jobHint,
          jdHint,
          totalRounds: ctx.totalRounds,
          difficulty: ctx.difficulty,
          difficultyHint,
          roundIndex: ctx.roundIndex,
          historyLength: ctx.history.length,
          historyText,
          resumeText: ctx.resumeText,
        }

    const observable = new Observable<{ content: string }>((subscriber) => {
      ;(async () => {
        try {
          const messages = await prompt.formatMessages(formatVars)
          const stream = await this.aiCommon
            .createChatModel(credentials)
            .stream(messages, { signal: ctx.signal })
          for await (const chunk of stream) {
            const delta = typeof chunk.content === 'string' ? chunk.content : ''
            if (delta) subscriber.next({ content: delta })
          }
          subscriber.complete()
        } catch (error) {
          subscriber.error(new BadRequestException(this.aiCommon.formatError(error)))
        }
      })()
      return () => {}
    })

    return {
      observable,
      getUsage: () => ({ promptTokens: 0, completionTokens: 0 }),
    }
  }

  /**
   * 对用户的单题回答进行评分 + 反馈
   * 动态出题模式没有预生成的参考答案，由 LLM 基于问题本身直接评判
   */
  async evaluateAnswer(
    ctx: EvaluationPromptContext,
    credentials: AiCredentials,
  ): Promise<{ evaluation: QuestionEvaluation; usage: LlmUsage }> {
    const jdHint = ctx.jobDescription
      ? `\n\n**岗位描述**（评价时需参考候选人回答与岗位要求的匹配度）：\n${ctx.jobDescription}`
      : ''

    const model = this.aiCommon
      .createChatModel(credentials)
      .withConfig({ response_format: { type: 'json_object' } })

    try {
      const messages = await evaluateAnswerPrompt.formatMessages({
        jdHint,
        roundIndex: ctx.roundIndex,
        totalRounds: ctx.totalRounds,
        question: ctx.question,
        userAnswer: ctx.userAnswer,
        jsonFormat: EVALUATION_JSON_FORMAT,
      })
      const result = await model.invoke(messages)
      const raw = (result.content as string) || '{}'
      const parsed = JSON.parse(raw) as Partial<QuestionEvaluation>

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
        usage: { promptTokens: 0, completionTokens: 0 },
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

  /**
   * 生成结构化总结评分（非流式 JSON，用于回填 interview_session.total_score + score_detail）
   * 同时返回基于评分拼接的自然语言总结文本（作为流式总结失败时的兜底）
   */
  async generateSummary(
    ctx: SummaryPromptContext,
    credentials: AiCredentials,
  ): Promise<{ scoreDetail: InterviewScoreDetail; summaryText: string; usage: LlmUsage }> {
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

    const model = this.aiCommon
      .createChatModel(credentials)
      .withConfig({ response_format: { type: 'json_object' } })

    try {
      const messages = await generateSummaryPrompt.formatMessages({
        jobHint,
        jdHint,
        difficulty: ctx.difficulty,
        allQaText,
        jsonFormat: SUMMARY_JSON_FORMAT,
      })
      const result = await model.invoke(messages)
      const raw = (result.content as string) || '{}'
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

      return { scoreDetail, summaryText, usage: { promptTokens: 0, completionTokens: 0 } }
    } catch (error) {
      throw new BadRequestException(this.aiCommon.formatError(error))
    }
  }

  /**
   * 生成面试总结文本的流式 Observable（非 JSON 模式，直接流式自然语言）
   * 返回 LlmStreamHandle：订阅 observable 拿 content 增量
   */
  streamSummaryText(ctx: SummaryPromptContext, credentials: AiCredentials): LlmStreamHandle {
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

    const observable = new Observable<{ content: string }>((subscriber) => {
      ;(async () => {
        try {
          const messages = await streamSummaryTextPrompt.formatMessages({
            jobHint,
            jdHint,
            allQaText,
          })
          const stream = await this.aiCommon
            .createChatModel(credentials)
            .stream(messages, { signal: ctx.signal })
          for await (const chunk of stream) {
            const delta = typeof chunk.content === 'string' ? chunk.content : ''
            if (delta) subscriber.next({ content: delta })
          }
          subscriber.complete()
        } catch (error) {
          console.error('[InterviewLlm] 流式总结失败', error)
          subscriber.error(new BadRequestException(this.aiCommon.formatError(error)))
        }
      })()
      return () => {}
    })

    return {
      observable,
      getUsage: () => ({ promptTokens: 0, completionTokens: 0 }),
    }
  }

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
