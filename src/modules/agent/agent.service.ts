import { BadRequestException, Injectable } from '@nestjs/common'
import { Observable } from 'rxjs'
import type { AiSession, AiSessionMessage } from '@prisma/client'
import type { BaseMessage, BaseMessageLike } from '@langchain/core/messages'
import type { AiCredentials } from '../user/user-ai-config.service'
import { AiCommonService } from '../shared/ai-common.service'
import { CredentialService } from '../shared/credential.service'
import { SessionGuardService } from '../shared/session-guard.service'
import {
  DEFAULT_SESSION_TITLE,
  TITLE_MAX_LENGTH,
  MAX_HISTORY_MESSAGES,
} from '../shared/shared.constants'
import { PrismaService } from '@/prisma/prisma.service'
import { createAgent, ReactAgent } from 'langchain'

/** Agent SSE 事件（基础阶段：start/content/done/error，后续接入工具时扩展 tool_call/tool_result） */
type AgentSseEvent =
  | { type: 'start' }
  | { type: 'content'; content: string }
  | { type: 'reasoning'; content: string }
  | { type: 'done'; messageId: string }
  | { type: 'error'; error: string }

/** 流式执行上下文 */
interface StreamContext {
  session: AiSession
  assistantMsg: AiSessionMessage
  credentials: AiCredentials
  providerId: string | undefined
  agent: ReactAgent
  messages: BaseMessageLike[]
}

/**
 * Agent 控制回路服务
 */
@Injectable()
export class AgentRunnerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiCommon: AiCommonService,
    private readonly credentialService: CredentialService,
    private readonly sessionGuard: SessionGuardService,
  ) {}

  /**
   * Agent 会话内流式对话
   * @param userId 当前用户 ID
   * @param sessionIdStr 会话 ID 字符串
   * @param content 用户输入
   * @param resumeText 当前简历纯文本（注入 system prompt）
   * @param providerId 可选厂商 ID
   */
  async agentChat(
    userId: number,
    sessionIdStr: string,
    content: string,
    resumeText?: string,
    providerId?: string,
  ): Promise<Observable<{ data: string }>> {
    // 1. 会话前准备
    const { session, credentials, agent } = await this.prepareChat(userId, sessionIdStr, providerId)

    // 2. 事务落库用户消息
    const isFirstMessage = session.title === DEFAULT_SESSION_TITLE
    await this.prisma.$transaction([
      this.prisma.aiSessionMessage.create({
        data: { sessionId: session.id, role: 'user', kind: 'normal', content },
      }),
      this.prisma.aiSession.update({
        where: { id: session.id },
        data: {
          providerId,
          modelId: credentials.modelId,
          ...(isFirstMessage ? { title: content.trim().slice(0, TITLE_MAX_LENGTH) } : {}),
        },
      }),
    ])

    // 3. 组装 LLM 上下文
    const messages = await this.buildContext(session.id, resumeText)

    // 4. 创建 assistant 占位消息
    const assistantMsg = await this.prisma.aiSessionMessage.create({
      data: {
        sessionId: Number(sessionIdStr),
        role: 'assistant',
        kind: 'normal',
        content: '',
        streamStatus: 'streaming',
      },
    })

    // 5. 流式调用
    return this.runStream({ session, credentials, providerId, agent, messages, assistantMsg })
  }

  /** 校验会话归属/类型 + 解析凭证 + 创建 LangChain 模型 */
  private async prepareChat(userId: number, sessionIdStr: string, providerId?: string) {
    const session = await this.sessionGuard.findOwnedSession(userId, sessionIdStr)
    if (session.type !== 'chat') {
      throw new BadRequestException('该会话不是对话类型，无法发送消息')
    }
    const credentials = await this.credentialService.resolveCredentials(userId, providerId)
    const model = this.aiCommon.createChatModel(credentials)
    const agent = createAgent({ model })
    return { session, credentials, agent }
  }

  /** 组装 LLM 上下文 */
  private async buildContext(sessionId: bigint, resumeText?: string): Promise<BaseMessageLike[]> {
    const historyRows = await this.prisma.aiSessionMessage.findMany({
      // 排除 failed 状态 + 空 content 的 assistant 消息，避免发给 AI 时触发 400
      where: {
        sessionId,
        streamStatus: { not: 'failed' },
        NOT: { role: 'assistant', content: '' },
      },
      orderBy: { id: 'desc' },
      take: MAX_HISTORY_MESSAGES,
    })
    const historyMessages = historyRows.reverse().map((row) => ({
      role: row.role as 'system' | 'user' | 'assistant',
      content: row.content,
    }))
    return [{ role: 'system', content: this.buildSystemPrompt(resumeText) }, ...historyMessages]
  }

  /** 执行流式调用并转换为 SSE Observable */
  private runStream(ctx: StreamContext): Observable<{ data: string }> {
    const { agent, messages, assistantMsg } = ctx
    return new Observable((subscriber) => {
      let fullContent = ''
      let settled = false
      const abort = new AbortController()

      /** 发送一帧 SSE 事件 */
      const emit = (event: AgentSseEvent): void => {
        subscriber.next({ data: JSON.stringify(event) })
      }

      ;(async () => {
        try {
          // start 帧让前端尽早确认 SSE 链路已通
          emit({ type: 'start' })

          // messages 模式产出 token 级增量：chunk 为 [BaseMessage, metadata] 二元组
          const stream = (await agent.stream(
            { messages },
            { streamMode: 'messages', signal: abort.signal },
          )) as unknown as AsyncIterable<[BaseMessage, Record<string, unknown>]>

          for await (const [token, metadata] of stream) {
            // 思考增量
            const reasoningDelta = token.additional_kwargs?.reasoning_content
            if (typeof reasoningDelta === 'string' && reasoningDelta) {
              emit({ type: 'reasoning', content: reasoningDelta })
            }
            // 正文增量
            const delta = typeof token.content === 'string' ? token.content : ''
            if (delta) {
              fullContent += delta
              emit({ type: 'content', content: delta })
            }
          }

          // 正常完成：回填全文 + done 事件
          if (!settled) {
            settled = true
            await this.finalize(ctx, fullContent, 'done')
          }
          emit({ type: 'done', messageId: String(assistantMsg.id) })
          subscriber.complete()
        } catch (error) {
          // 失败：保留已收到的部分内容，标记 failed 并记录错误原因，再向前端发错误帧
          const errMsg = this.aiCommon.formatError(error)
          if (!settled) {
            settled = true
            await this.finalize(ctx, fullContent, 'failed', errMsg)
          }
          emit({ type: 'error', error: errMsg })
          subscriber.complete()
        }
      })()

      // 客户端断开：中止上游请求 + 已收内容标记失败
      return () => {
        if (!settled) {
          settled = true
          abort.abort()
          this.finalize(ctx, fullContent, 'failed', '客户端断开连接')
        }
      }
    })
  }

  /** 收尾落库 */
  private async finalize(
    ctx: StreamContext,
    fullContent: string,
    status: 'done' | 'failed',
    errorMessage?: string,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.aiSessionMessage.update({
        where: { id: ctx.assistantMsg.id },
        data: {
          content: fullContent,
          streamStatus: status,
          errorMessage: status === 'failed' ? errorMessage : null,
        },
      }),
      // 触发updatedAt自动刷新
      this.prisma.aiSession.update({
        where: { id: ctx.session.id },
        data: { providerId: ctx.providerId, modelId: ctx.credentials.modelId },
      }),
    ])
  }

  /**
   * 构建 Agent 的 system prompt
   * 注入简历文本 + 助手能力说明
   * @param resumeText 用户当前简历纯文本（可选）
   */
  private buildSystemPrompt(resumeText?: string): string {
    const resumeSection = resumeText
      ? `\n用户的当前简历内容如下：\n<resume>\n${resumeText}\n</resume>\n`
      : '\n用户尚未提供简历内容。如果需要分析简历，请先询问用户提供简历文本。\n'

    return `你是一位专业的简历优化助手，擅长帮助求职者提升简历质量。${resumeSection}
回答风格：专业、友好、具体可执行，用中文回复。`
  }
}
