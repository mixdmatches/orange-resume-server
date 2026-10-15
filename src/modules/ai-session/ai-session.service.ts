import { BadRequestException, Injectable } from '@nestjs/common'
import { Observable } from 'rxjs'
import type { AiSession, AiSessionMessage, InterviewSession, Prisma } from '@prisma/client'
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
import { SerializedSession } from '@/common/types/session'

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
   * 会话内流式对话：先落库用户消息，再流式调用 LLM 并把 AI 回复全文回填
   * @param userId 当前登录用户 ID
   * @param sessionIdStr 会话 ID 字符串
   * @param dto 消息内容 + 可选厂商
   * @returns SSE Observable（data 为 JSON 字符串：{ content } / { done, messageId }）
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

    // 6. 流式调用 + 落库
    const abort = new AbortController() // 客户端断开时中止上游请求
    let partial = '' // 已收到的全文（用于回填）
    let settled = false // 是否已回填落库（防止重复写）

    /** 回填 assistant 消息并刷新会话活跃时间 */
    const finalize = async (status: 'done' | 'failed', errorMessage?: string): Promise<void> => {
      await this.prisma.$transaction([
        this.prisma.aiSessionMessage.update({
          where: { id: assistantMsg.id },
          data: {
            content: partial,
            streamStatus: status,
            errorMessage: status === 'failed' ? errorMessage : null,
          },
        }),
        // 随手更新会话（幂等字段）以刷新 updatedAt，用于会话列表排序
        this.prisma.aiSession.update({
          where: { id: session.id },
          data: { providerId, modelId: credentials.modelId },
        }),
      ])
    }

    return this.aiCommon.sseFromStream(
      () =>
        this.aiCommon
          .createChatModel(credentials)
          .stream(historyMessages, { signal: abort.signal }),
      {
        errorLabel: '会话流式对话',
        apiKey: credentials.apiKey,
        onDelta: (delta) => {
          partial += delta
        },
        doneExtra: { messageId: String(assistantMsg.id) },
        beforeDone: async () => {
          if (!settled) {
            settled = true
            await finalize('done')
          }
        },
        onError: async (error: unknown) => {
          if (!settled) {
            settled = true
            await finalize('failed', this.aiCommon.formatError(error)).catch(() => {})
          }
        },
        onUnsubscribe: () => {
          if (!settled) {
            settled = true
            abort.abort()
            finalize('failed', '客户端断开连接').catch(() => {})
          }
        },
      },
    )
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
            resumeText: session.interviewSession.resumeText,
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
      errorMessage: message.errorMessage,
      createdAt: message.createdAt,
    }
  }
}
