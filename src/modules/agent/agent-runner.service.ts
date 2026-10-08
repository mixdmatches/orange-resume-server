import { BadRequestException, Injectable } from '@nestjs/common'
import { Observable } from 'rxjs'
import OpenAI from 'openai'
import type { AiSession, Prisma } from '@prisma/client'
import { AiService } from '../ai/ai.service'
import { AiCommonService } from '../shared/ai-common.service'
import { CredentialService } from '../shared/credential.service'
import { SessionGuardService } from '../shared/session-guard.service'
import {
  DEFAULT_SESSION_TITLE,
  TITLE_MAX_LENGTH,
  MAX_HISTORY_MESSAGES,
} from '../shared/shared.constants'
import { PrismaService } from '@/prisma/prisma.service'
import { ToolRegistryService } from './tool-registry.service'
import type { AgentSseEvent, PersistedToolCall, ToolCall, ToolCallDelta } from './types'

/** Agent 最大循环轮次（防止无限工具调用导致 token 爆炸） */
const MAX_AGENT_LOOPS = 5

/**
 * Agent 控制回路服务
 * 核心职责：实现「LLM 决策 → 工具调用 → 结果回喂 → 继续决策」的循环
 */
@Injectable()
export class AgentRunnerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
    private readonly toolRegistry: ToolRegistryService,
    private readonly aiCommon: AiCommonService,
    private readonly credentialService: CredentialService,
    private readonly sessionGuard: SessionGuardService,
  ) {}

  /**
   * Agent 会话内流式对话（支持 Function Calling）
   *
   * 流程：
   * 1. 校验会话归属 + 解析凭证
   * 2. 事务落库用户消息 + 更新会话（含首条消息自动标题）
   * 3. 读取最近 N 条历史 + 构建 system prompt（注入简历文本 + 工具说明）
   * 4. 创建 assistant 占位消息
   * 5. Agent 循环：调用 LLM(带 tools) → 流式输出文本 → 收集工具调用 → 执行工具 → 结果回喂
   * 6. 循环结束（无工具调用 / 达最大轮次）后回填 assistant 消息
   *
   * @param userId 当前用户 ID
   * @param sessionIdStr 会话 ID 字符串
   * @param content 用户输入
   * @param resumeText 当前简历纯文本（注入 system prompt 供工具使用）
   * @param providerId 可选厂商 ID
   * @returns SSE Observable
   */
  async agentChat(
    userId: number,
    sessionIdStr: string,
    content: string,
    resumeText?: string,
    providerId?: string,
  ): Promise<Observable<{ data: string }>> {
    // 1. 校验会话归属
    const session = await this.findOwnedSession(userId, sessionIdStr)
    if (session.type !== 'chat') {
      throw new BadRequestException('该会话不是对话类型，无法发送消息')
    }

    // 2. 解析凭证
    const credentials = await this.credentialService.resolveCredentials(userId, providerId)
    const openai = this.aiCommon.createOpenAIClient(credentials)

    // 3. 事务落库用户消息 + 更新会话
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

    // 4. 读取历史上下文 + 构建 system prompt
    const historyRows = await this.prisma.aiSessionMessage.findMany({
      where: { sessionId: session.id, streamStatus: { not: 'failed' } },
      orderBy: { id: 'desc' },
      take: MAX_HISTORY_MESSAGES,
    })
    const historyMessages = historyRows.reverse().map((row) => ({
      role: row.role as 'system' | 'user' | 'assistant',
      content: row.content,
    }))

    const systemPrompt = this.buildSystemPrompt(resumeText)

    // 5. 创建 assistant 占位消息
    const assistantMsg = await this.prisma.aiSessionMessage.create({
      data: {
        sessionId: session.id,
        role: 'assistant',
        kind: 'normal',
        content: '',
        streamStatus: 'streaming',
      },
    })

    // 6. Agent 循环（Observable 模式）
    return new Observable((subscriber) => {
      let fullContent = ''
      let promptTokens = 0
      let completionTokens = 0
      let settled = false
      const abort = new AbortController()

      // 本轮工具调用记录
      const toolCallRecords: PersistedToolCall[] = []

      /** 发送一帧 SSE 事件 */
      const emit = (event: AgentSseEvent): void => {
        subscriber.next({ data: JSON.stringify(event) })
      }

      /** 回填 assistant 消息 */
      const finalize = async (status: 'done' | 'failed'): Promise<void> => {
        await this.prisma.$transaction([
          this.prisma.aiSessionMessage.update({
            where: { id: assistantMsg.id },
            data: {
              content: fullContent,
              streamStatus: status,
              promptTokens,
              completionTokens,
              // 有工具调用时持久化到独立 toolCalls 字段，刷新后前端据此还原工具调用卡片
              ...(toolCallRecords.length > 0
                ? {
                    toolCalls: toolCallRecords as unknown as Prisma.InputJsonValue,
                  }
                : {}),
            },
          }),
          this.prisma.aiSession.update({
            where: { id: session.id },
            data: { providerId, modelId: credentials.modelId },
          }),
        ])
      }

      ;(async () => {
        try {
          // 立即推送 start 事件：首轮 LLM 决策可能长达数十秒且无任何帧可发，
          // start 帧让前端尽早确认 SSE 链路已通，消除"静默黑盒"
          emit({ type: 'start' })
          console.log(
            '[Agent] 开始执行（sessionId=%s, model=%s）',
            String(session.id),
            credentials.modelId,
          )

          // 组装完整消息列表：system + 历史 + 当前用户输入
          const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
            { role: 'system', content: systemPrompt },
            ...historyMessages,
            { role: 'user', content },
          ]

          const tools = this.toolRegistry.getToolSchemas()
          let loopCount = 0

          // Agent 主循环：LLM 决策 → 工具调用 → 结果回喂
          while (loopCount < MAX_AGENT_LOOPS) {
            loopCount++
            console.log('[Agent] 第 %d 轮 LLM 调用开始', loopCount)

            // 调用 LLM（带 tools 参数，支持流式）
            const stream = await openai.chat.completions.create(
              {
                messages,
                model: credentials.modelId,
                temperature: 0.7,
                stream: true,
                tools,
              },
              { signal: abort.signal },
            )

            let contentDelta = ''
            const toolCallMap = new Map<number, ToolCall>()

            // 逐 chunk 处理：文本增量直接推送，工具调用片段按 index 聚合
            for await (const chunk of stream) {
              if (chunk.usage) {
                promptTokens = chunk.usage.prompt_tokens ?? 0
                completionTokens = chunk.usage.completion_tokens ?? 0
              }

              const delta = chunk.choices[0]?.delta
              if (!delta) continue

              // 文本增量
              if (delta.content) {
                contentDelta += delta.content
                emit({ type: 'content', content: delta.content })
              }

              // 工具调用片段（流式时 tool_calls 会被拆成多个 chunk，需按 index 聚合）
              if (delta.tool_calls) {
                this.mergeToolCalls(toolCallMap, delta.tool_calls as ToolCallDelta[])
              }
            }

            fullContent += contentDelta
            const toolCalls = Array.from(toolCallMap.values())

            // 把本轮 assistant 消息（含 tool_calls）加入上下文
            messages.push({
              role: 'assistant',
              content: contentDelta || null,
              tool_calls: toolCalls.map((tc) => ({
                id: tc.id,
                type: 'function',
                function: { name: tc.name, arguments: tc.arguments },
              })),
            })

            // 没有工具调用 = Agent 认为任务完成，退出循环
            if (toolCalls.length === 0) break
            console.log('[Agent] 本轮决策调用工具: %s', toolCalls.map((tc) => tc.name).join(', '))

            // 执行每个工具，把结果作为 tool 角色消息回喂给 LLM
            for (const tc of toolCalls) {
              const args = this.safeParseArgs(tc.arguments)
              emit({ type: 'tool_call', name: tc.name, args })
              // 同步登记持久化记录：先记 calling，执行结束后回填状态与结果
              const record: PersistedToolCall = { name: tc.name, args, status: 'calling' }
              toolCallRecords.push(record)

              try {
                console.log('[Agent] 工具 %s 开始执行', tc.name)
                const result = await this.toolRegistry.execute(tc.name, tc.arguments, {
                  userId,
                  aiService: this.aiService,
                  prisma: this.prisma,
                })
                const output = JSON.stringify(result)
                console.log('[Agent] 工具 %s 执行完成', tc.name)
                emit({ type: 'tool_result', name: tc.name, output })
                record.status = 'done'
                record.output = output
                messages.push({
                  role: 'tool',
                  tool_call_id: tc.id,
                  content: output,
                })
              } catch (err) {
                // 工具执行失败：把错误信息回喂给 LLM，让它决定是否重试或换方案
                const errorMsg = (err as Error)?.message || '工具执行失败'
                emit({ type: 'tool_result', name: tc.name, output: `错误: ${errorMsg}` })
                record.status = 'error'
                record.output = `错误: ${errorMsg}`
                messages.push({
                  role: 'tool',
                  tool_call_id: tc.id,
                  content: `工具执行失败: ${errorMsg}`,
                })
              }
            }
          }

          // 正常完成：回填 + done 事件
          if (!settled) {
            settled = true
            await finalize('done')
          }
          emit({
            type: 'done',
            messageId: String(assistantMsg.id),
            promptTokens,
            completionTokens,
          })
          subscriber.complete()
        } catch (error) {
          if (!settled) {
            settled = true
            await finalize('failed').catch(() => {})
          }
          console.error('[Agent] Agent 对话失败（sessionId=%s）', String(session.id), error)
          emit({ type: 'error', error: this.formatError(error) })
          subscriber.complete()
        }
      })()

      // 客户端断开：中止上游 + 标记失败
      return () => {
        if (!settled) {
          settled = true
          abort.abort()
          finalize('failed').catch(() => {})
        }
      }
    })
  }

  // ======================================================================
  // 内部辅助方法
  // ======================================================================

  /**
   * 构建 Agent 的 system prompt
   * 注入简历文本 + 工具使用指引，让 LLM 知道自己能做什么、何时用工具
   * @param resumeText 用户当前简历纯文本（可选）
   */
  private buildSystemPrompt(resumeText?: string): string {
    const resumeSection = resumeText
      ? `\n用户的当前简历内容如下（调用工具时请直接使用此内容作为 resumeText 参数）：\n<resume>\n${resumeText}\n</resume>\n`
      : '\n用户尚未提供简历内容。如果需要分析简历，请先询问用户提供简历文本。\n'

    return `你是一位专业的简历优化助手，擅长帮助求职者提升简历质量。${resumeSection}
你可以使用以下工具来获取更精准的分析结果：
- resume_score: 对简历进行多维度质量评分（0-100分 + 等级 + 改进建议）
- grammar_check: 检查简历中的错别字、语病、标点错误等问题
- job_match: 分析简历与目标岗位 JD 的匹配度（需要用户提供 JD）

使用工具的原则：
1. 当用户询问简历质量、需要优化建议时，主动调用 resume_score
2. 当用户要求检查语法、纠错时，调用 grammar_check
3. 当用户提供了 JD 并询问匹配度时，调用 job_match
4. 调用工具时，resumeText 参数请使用上面提供的简历内容
5. 工具返回结果后，基于结果用通俗易懂的语言给出总结和建议，不要直接照搬工具输出的 JSON
6. 如果不需要工具就能回答的简单问题，可以直接回答

回答风格：专业、友好、具体可执行，用中文回复。`
  }

  /**
   * 聚合流式返回的工具调用片段
   * OpenAI 流式返回时，tool_calls 会被拆成多个 chunk，每个 chunk 带 index，
   * 需要按 index 把 id、name、arguments 拼接成完整的工具调用
   * @param map 已聚合的工具调用映射（index -> ToolCall）
   * @param deltas 当前 chunk 的工具调用片段数组
   */
  private mergeToolCalls(map: Map<number, ToolCall>, deltas: ToolCallDelta[]): void {
    for (const d of deltas) {
      const existing = map.get(d.index)
      if (!existing) {
        map.set(d.index, {
          id: d.id || '',
          name: d.function?.name || '',
          arguments: d.function?.arguments || '',
        })
      } else {
        if (d.id) existing.id = d.id
        if (d.function?.name) existing.name = d.function.name
        if (d.function?.arguments) existing.arguments += d.function.arguments
      }
    }
  }

  /** 安全解析工具参数 JSON */
  private safeParseArgs(argsStr: string): Record<string, unknown> {
    try {
      return JSON.parse(argsStr)
    } catch {
      return {}
    }
  }

  /** 校验会话归属并返回会话记录（委托 SessionGuardService） */
  private async findOwnedSession(userId: number, sessionIdStr: string): Promise<AiSession> {
    return this.sessionGuard.findOwnedSession(userId, sessionIdStr)
  }

  /** 格式化错误信息为用户友好的中文提示（委托 AiCommonService） */
  private formatError(error: unknown): string {
    return this.aiCommon.formatError(error)
  }
}
