import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Observable } from 'rxjs'
import OpenAI from 'openai'
import type {
  AiSession,
  AiSessionMessage,
  Difficulty,
  InterviewSession,
  Prisma,
  SessionStatus,
  SessionType,
} from '@prisma/client'
import { AiCommonService } from '../shared/ai-common.service'
import { CredentialService } from '../shared/credential.service'
import { SessionGuardService } from '../shared/session-guard.service'
import {
  DEFAULT_SESSION_TITLE,
  TITLE_MAX_LENGTH,
  MAX_HISTORY_MESSAGES,
} from '../shared/shared.constants'
import { PrismaService } from '@/prisma/prisma.service'
import type { CreateSessionDto } from './dto/create-session.dto'
import type { UpdateSessionDto } from './dto/update-session.dto'
import type { ListSessionsDto } from './dto/list-sessions.dto'
import type { ListMessagesDto } from './dto/list-messages.dto'
import type { SendMessageDto } from './dto/send-message.dto'

/** SSE 推送的事件格式（与 ai.service 的 SseEventPayload 兼容，额外扩展了统计字段） */
interface SessionSseEventPayload {
  content?: string
  done?: boolean
  messageId?: string
  promptTokens?: number
  completionTokens?: number
}

/**
 * 会话接口响应结构（serializeSession 的返回值类型）
 * 所有 BigInt 字段已转为 string，可安全 JSON 序列化
 */
export interface SerializedSession {
  /** 会话 ID（BigInt 序列化为字符串） */
  id: string
  /** 简历id */
  resumeId: string
  /** 所属用户 ID */
  userId: number
  /** 会话类型：interview = AI 面试 / chat = AI 对话 */
  type: SessionType
  /** 会话标题 */
  title: string
  /** 当时使用的厂商标识（软引用 ai_provider.provider_id，厂商删除后历史会话仍可查） */
  providerId: string | null
  /** 当时使用的模型 ID */
  modelId: string | null
  /** 会话状态（active 正常 / archived 归档 / deleted 软删除） */
  status: SessionStatus
  /** 会话消息数（列表接口经 _count 统计携带；详情接口不含此字段） */
  messageCount?: number
  /** 面试扩展信息（仅 interview 类型会话存在，chat 会话为 null） */
  interviewSession: SerializedInterviewSession | null
  /** 创建时间 */
  createdAt: Date
  /** 更新时间（用于会话列表按活跃度排序） */
  updatedAt: Date
}

/**
 * 面试扩展信息的序列化结构（SerializedSession.interviewSession 的元素类型）
 */
export interface SerializedInterviewSession {
  /** 关联的简历 ID（面试以简历为出题种子） */
  resumeId: string
  /** 目标岗位（如"前端工程师"） */
  jobTitle: string | null
  /** 面试难度档位 */
  difficulty: Difficulty
  /** 题目类型（技术 / 行为 / 项目深挖等，null 表示混合出题） */
  category: string | null
  /** 面试总分（Prisma Decimal 转 number，面试结束评分前为 null） */
  totalScore: number | null
  /** AI 生成的面试总结报告（面试结束后回填） */
  summary: string | null
  /** 面试总耗时（秒） */
  durationSec: number | null
}

/**
 * AI 会话服务
 */
@Injectable()
export class AiSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiCommon: AiCommonService,
    private readonly credentialService: CredentialService,
    private readonly sessionGuard: SessionGuardService,
  ) {}

  /**
   * 创建会话（当前仅支持 chat 类型；面试会话由后续面试流程接口创建）
   * @param userId 当前登录用户 ID
   * @param dto 会话类型 + 可选标题/厂商
   */
  async createSession(userId: number, dto: CreateSessionDto): Promise<SerializedSession> {
    const session = await this.prisma.aiSession.create({
      data: {
        resumeId: dto.resumeId,
        userId,
        type: dto.type,
        title: dto.title?.trim() || DEFAULT_SESSION_TITLE,
        providerId: dto.providerId,
        modelId: dto.modelId,
      },
    })
    return this.serializeSession(session)
  }

  /**
   * 分页查询当前用户的会话列表（按最近活跃倒序，排除已软删除）
   * @param userId 当前登录用户 ID
   * @param dto 类型筛选 + 页码/页大小
   */
  async listSessions(
    userId: number,
    dto: ListSessionsDto,
  ): Promise<{ list: SerializedSession[]; total: number; page: number; pageSize: number }> {
    const where: Prisma.AiSessionWhereInput = {
      userId,
      resumeId: dto.resumeId,
      status: { not: 'deleted' },
      ...(dto.type ? { type: dto.type } : {}),
    }
    const [rows, total] = await Promise.all([
      this.prisma.aiSession.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (dto.page! - 1) * dto.pageSize!,
        take: dto.pageSize!,
        include: { _count: { select: { messages: true } } },
      }),
      this.prisma.aiSession.count({ where }),
    ])
    return {
      list: rows.map((row) => this.serializeSession(row)),
      total,
      page: dto.page!,
      pageSize: dto.pageSize!,
    }
  }

  /**
   * 查询当前用户的全部会话(chat 类型)（按最近活跃倒序，排除已软删除）
   * @param userId 当前登录用户 ID
   */
  async listAllChatSessions(userId: number, resumeId: string): Promise<SerializedSession[]> {
    const sessions = await this.prisma.aiSession.findMany({
      where: { userId, resumeId, status: { not: 'deleted' }, type: 'chat' },
      include: { _count: { select: { messages: true } } },
      orderBy: { updatedAt: 'desc' },
    })
    return sessions.map((row) => this.serializeSession(row))
  }

  /**
   * 查询会话详情（含面试扩展信息，若为面试会话）
   * @param userId 当前登录用户 ID
   * @param sessionIdStr 会话 ID 字符串（URL 参数）
   */
  async getSession(userId: number, sessionIdStr: string): Promise<SerializedSession> {
    const session = await this.sessionGuard.findOwnedSessionWithInterview(userId, sessionIdStr)
    return this.serializeSession(session)
  }

  /**
   * 更新会话（重命名 / 归档与恢复）
   * @param userId 当前登录用户 ID
   * @param sessionIdStr 会话 ID 字符串
   * @param dto title / status（至少提供一个字段）
   */
  async updateSession(
    userId: number,
    sessionIdStr: string,
    dto: UpdateSessionDto,
  ): Promise<SerializedSession> {
    if (!dto.title && !dto.status) {
      throw new BadRequestException('至少提供 title 或 status 中的一个更新字段')
    }
    const session = await this.sessionGuard.findOwnedSessionWithInterview(userId, sessionIdStr)
    const updated = await this.prisma.aiSession.update({
      where: { id: session.id },
      data: {
        ...(dto.title ? { title: dto.title.trim() } : {}),
        ...(dto.status ? { status: dto.status } : {}),
      },
    })
    return this.serializeSession(updated)
  }

  /**
   * 软删除会话（仅标记 status=deleted，消息保留在库中以便恢复/审计）
   * @param userId 当前登录用户 ID
   * @param sessionIdStr 会话 ID 字符串
   */
  async deleteSession(userId: number, sessionIdStr: string): Promise<{ success: true }> {
    const session = await this.sessionGuard.findOwnedSessionWithInterview(userId, sessionIdStr)
    await this.prisma.aiSession.update({
      where: { id: session.id },
      data: { status: 'deleted' },
    })
    return { success: true }
  }

  /**
   * 按游标分页拉取会话消息（id 倒序，最新在前；前端按需反转展示）
   * 走 (session_id, id) 复合索引，WHERE id < beforeId 实现 stable 游标翻页
   * @param userId 当前登录用户 ID
   * @param sessionIdStr 会话 ID 字符串
   * @param dto 游标 + 每页条数
   * @returns list（倒序）+ hasMore + nextCursor（下一页游标，即本页最后一条的 id）
   */
  async listMessages(
    userId: number,
    sessionIdStr: string,
    dto: ListMessagesDto,
  ): Promise<{
    list: Record<string, unknown>[]
    hasMore: boolean
    nextCursor: string | null
  }> {
    const session = await this.sessionGuard.findOwnedSessionWithInterview(userId, sessionIdStr)
    const beforeId = dto.beforeId ? BigInt(dto.beforeId) : undefined
    // 多取一条用于判断是否还有下一页
    const rows = await this.prisma.aiSessionMessage.findMany({
      where: {
        sessionId: session.id,
        ...(beforeId ? { id: { lt: beforeId } } : {}),
      },
      orderBy: { id: 'desc' },
      take: dto.limit! + 1,
    })
    const hasMore = rows.length > dto.limit!
    const page = hasMore ? rows.slice(0, dto.limit!) : rows
    return {
      list: page.map((row) => this.serializeMessage(row)),
      hasMore,
      nextCursor: hasMore ? String(page[page.length - 1].id) : null,
    }
  }

  /**
   * 会话内流式对话：先落库用户消息，再流式调用 LLM 并把 AI 回复全文 + token 用量回填
   *
   * 流程：
   * 1. 校验会话归属 / 类型（仅 chat）/ 未删除
   * 2. 解析凭证（dto.providerId 优先，否则用户偏好中选中的厂商）
   * 3. 事务：写入用户消息 + 更新会话（providerId/modelId 记录"最近使用"，顺带刷新 updatedAt）
   *    - 若标题仍为默认值，则用首条用户消息截取生成标题
   * 4. 读取最近 MAX_HISTORY_MESSAGES 条历史（排除 failed 的残缺消息）组装上下文
   * 5. 创建 assistant 占位消息（stream_status=streaming）
   * 6. 流式转发：每个增量通过 SSE 发给前端；结束后回填全文 + token；客户端断开/出错标记 failed
   *
   * @param userId 当前登录用户 ID
   * @param sessionIdStr 会话 ID 字符串
   * @param dto 消息内容 + 可选厂商
   * @returns SSE Observable（data 为 JSON 字符串：{ content } / { done, messageId, promptTokens, completionTokens }）
   */
  async chatInSession(
    userId: number,
    sessionIdStr: string,
    dto: SendMessageDto,
  ): Promise<Observable<{ data: string }>> {
    // 1. 校验会话：归属 + 类型 + 状态
    const session = await this.sessionGuard.findOwnedSessionWithInterview(userId, sessionIdStr)
    if (session.type !== 'chat') {
      throw new BadRequestException('该会话不是对话类型，无法发送消息')
    }

    // 2. 解析凭证：显式指定的厂商优先，其次用户偏好中选中的厂商
    const preference = await this.prisma.aiPreference.findUnique({ where: { userId } })
    const providerId = dto.providerId || preference?.selectedProviderId
    const credentials = await this.credentialService.resolveCredentials(userId, providerId)
    const openai = this.aiCommon.createOpenAIClient(credentials)

    // 3. 事务：落库用户消息 + 更新会话记录（含首条消息自动生成标题）
    const content = dto.content
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

    // 4. 组装历史上下文：最近 N 条（排除流式失败的消息），按时间正序排列
    const historyRows = await this.prisma.aiSessionMessage.findMany({
      where: { sessionId: session.id, streamStatus: { not: 'failed' } },
      orderBy: { id: 'desc' },
      take: MAX_HISTORY_MESSAGES,
    })
    const historyMessages = historyRows
      .reverse()
      .map((row) => ({ role: row.role as 'system' | 'user' | 'assistant', content: row.content }))

    // 5. 创建 assistant 占位消息（流式中间态，完成后回填）
    const assistantMsg = await this.prisma.aiSessionMessage.create({
      data: {
        sessionId: session.id,
        role: 'assistant',
        kind: 'normal',
        content: '',
        streamStatus: 'streaming',
      },
    })

    // 6. 流式调用 + 落库（Observable 模式与 ai.controller 的 SSE 管道对接）
    return new Observable((subscriber) => {
      let partial = '' // 已收到的全文（用于回填）
      let promptTokens = 0
      let completionTokens = 0
      let settled = false // 是否已回填落库（防止重复写）
      const abort = new AbortController() // 客户端断开时中止上游请求

      /** 回填 assistant 消息并刷新会话活跃时间 */
      const finalize = async (status: 'done' | 'failed'): Promise<void> => {
        await this.prisma.$transaction([
          this.prisma.aiSessionMessage.update({
            where: { id: assistantMsg.id },
            data: {
              content: partial,
              streamStatus: status,
              promptTokens,
              completionTokens,
            },
          }),
          // 随手更新会话（幂等字段）以刷新 updatedAt，用于会话列表排序
          this.prisma.aiSession.update({
            where: { id: session.id },
            data: { providerId, modelId: credentials.modelId },
          }),
        ])
      }

      /** 发送一帧 SSE 事件 */
      const emit = (payload: SessionSseEventPayload): void => {
        subscriber.next({ data: JSON.stringify(payload) })
      }

      ;(async () => {
        try {
          // 6.1 创建上游流：优先带 stream_options 统计 token；厂商不支持时降级重试一次
          const buildBody = (includeUsage: boolean) => ({
            messages: historyMessages,
            model: credentials.modelId,
            temperature: 0.7,
            stream: true as const,
            ...(includeUsage ? { stream_options: { include_usage: true } } : {}),
          })
          let stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
          try {
            stream = (await openai.chat.completions.create(buildBody(true), {
              signal: abort.signal,
            })) as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
          } catch (err) {
            const msg = (err as Error)?.message ?? ''
            if (!msg.includes('stream_options')) throw err
            console.warn('[AiSession] 厂商不支持 stream_options，降级为无 usage 统计重试')
            stream = (await openai.chat.completions.create(buildBody(false), {
              signal: abort.signal,
            })) as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
          }

          // 6.2 逐 chunk 转发增量；最后一个 chunk 可能携带 usage 统计
          for await (const chunk of stream) {
            if (chunk.usage) {
              promptTokens = chunk.usage.prompt_tokens ?? 0
              completionTokens = chunk.usage.completion_tokens ?? 0
            }
            const delta = chunk.choices[0]?.delta?.content || ''
            if (delta) {
              partial += delta
              emit({ content: delta })
            }
          }

          // 6.3 正常完成：回填全文 + done 事件（附消息 ID 与 token 用量）
          if (!settled) {
            settled = true
            await finalize('done')
          }
          emit({
            done: true,
            messageId: String(assistantMsg.id),
            promptTokens,
            completionTokens,
          })
          subscriber.complete()
        } catch (error) {
          // 6.4 失败：保留已收到的部分内容，标记 failed，再向前端发错误帧
          if (!settled) {
            settled = true
            await finalize('failed').catch(() => {})
          }
          console.error('[AiSession] 会话流式对话失败（sessionId=%s）', String(session.id), error)
          subscriber.error(new BadRequestException(this.aiCommon.formatError(error)))
        }
      })()

      // 6.5 客户端断开（关页面/取消生成）：中止上游请求，已收内容标记为 failed
      return () => {
        if (!settled) {
          settled = true
          abort.abort()
          finalize('failed').catch(() => {})
        }
      }
    })
  }

  /**
   * 序列化会话记录：BigInt → string，保证可安全 JSON.stringify
   * @param session 会话记录（可能带 _count / interviewSession）
   */
  private serializeSession(
    session: AiSession & {
      _count?: { messages: number }
      interviewSession?: InterviewSession | null
    },
  ): SerializedSession {
    return {
      id: String(session.id),
      resumeId: session.resumeId,
      userId: session.userId,
      type: session.type,
      title: session.title,
      providerId: session.providerId,
      modelId: session.modelId,
      status: session.status,
      messageCount: session._count?.messages,
      interviewSession: session.interviewSession
        ? {
            resumeId: session.interviewSession.resumeId,
            jobTitle: session.interviewSession.jobTitle,
            difficulty: session.interviewSession.difficulty,
            category: session.interviewSession.category,
            totalScore: session.interviewSession.totalScore
              ? Number(session.interviewSession.totalScore)
              : null,
            summary: session.interviewSession.summary,
            durationSec: session.interviewSession.durationSec,
          }
        : null,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    }
  }

  /**
   * 序列化消息记录：BigInt → string，保证可安全 JSON.stringify
   * @param message 消息记录
   */
  private serializeMessage(message: AiSessionMessage): Record<string, unknown> {
    return {
      id: String(message.id),
      sessionId: String(message.sessionId),
      role: message.role,
      kind: message.kind,
      content: message.content,
      promptTokens: message.promptTokens,
      completionTokens: message.completionTokens,
      extra: message.extra,
      toolCalls: message.toolCalls,
      streamStatus: message.streamStatus,
      createdAt: message.createdAt,
    }
  }
}
