import type { AiService } from '../ai/ai.service'
import type { PrismaService } from '@/prisma/prisma.service'

/**
 * 工具参数的 JSON Schema 描述
 */
export type ToolParameters = {
  type: 'object'
  properties: Record<string, { type: string; description: string }>
  required: string[]
  [key: string]: unknown
}

export interface AgentTool {
  /** 工具名称（唯一标识，LLM 通过此字段调用） */
  name: string
  /** 工具描述（LLM 据此判断何时调用，写得越精准越好） */
  description: string
  /** 入参 JSON Schema */
  parameters: ToolParameters
  /**
   * 工具执行逻辑
   * @param ctx 执行上下文（含 userId、AiService、Prisma 等）
   * @param args LLM 解析出的入参（已从 JSON 字符串转为对象）
   * @returns 工具执行结果（会被 JSON.stringify 后回喂给 LLM）
   */
  execute(ctx: ToolContext, args: Record<string, unknown>): Promise<unknown>
}

/**
 * 工具执行上下文
 * 注入工具执行时所需的服务依赖，避免工具直接 import 具体实现
 */
export interface ToolContext {
  /** 当前登录用户 ID */
  userId: number
  /** AI 服务（封装了各能力的 LLM 调用） */
  aiService: AiService
  /** Prisma 服务（如需直接读写数据库） */
  prisma: PrismaService
}

/**
 * Agent SSE 事件协议（扩展自原有 {content}/{done} 帧）
 * 前端按 type 字段分发渲染：
 * - content：AI 文本增量（打字机效果）
 * - tool_call：Agent 决定调用某个工具
 * - tool_result：工具执行完成，附结果摘要
 * - done：整轮 Agent 执行结束
 * - error：执行出错
 */
export type AgentSseEvent =
  | { type: 'start' }
  | { type: 'content'; content: string }
  | { type: 'tool_call'; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; name: string; output: string }
  | { type: 'done'; messageId?: string; promptTokens?: number; completionTokens?: number }
  | { type: 'error'; error: string }

/**
 * OpenAI 工具调用片段（流式返回时 tool_calls 会被拆成多个 chunk，需按 index 聚合）
 */
export interface ToolCallDelta {
  index: number
  id?: string
  type?: 'function'
  function?: {
    name?: string
    arguments?: string
  }
}

/** 聚合后的完整工具调用 */
export interface ToolCall {
  id: string
  name: string
  arguments: string
}

/**
 * 工具调用持久化记录
 */
export interface PersistedToolCall {
  /** 工具名称 */
  name: string
  /** 工具入参（safeParseArgs 解析后的对象） */
  args: Record<string, unknown>
  /** 执行状态：calling 执行中被中断 / done 完成 / error 出错 */
  status: 'calling' | 'done' | 'error'
  /** 工具返回结果（JSON 字符串），calling 状态下可能缺失 */
  output?: string
}
