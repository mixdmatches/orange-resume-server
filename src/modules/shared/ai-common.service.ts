import { BadRequestException, Injectable } from '@nestjs/common'
import { Observable } from 'rxjs'
import { ChatOpenAI } from '@langchain/openai'
import type { AIMessageChunk } from '@langchain/core/messages'
import type { AiCredentials } from '../user/user-ai-config.service'

/** SSE 流式转换钩子：供调用方做增量累积、落库回填、断开清理 */
interface SseStreamHooks {
  /** 错误日志标签 */
  errorLabel: string
  /** 用于日志掩码的明文 key */
  apiKey: string
  /** 每个内容增量的回调（如累积全文用于落库） */
  onDelta?: (delta: string) => void
  /** done 事件的附加字段（如 messageId） */
  doneExtra?: Record<string, unknown>
  /** 推送 done 前的异步钩子（如回填落库），抛错会转为错误帧 */
  beforeDone?: () => Promise<void> | void
  /** 上游失败时、发送错误帧前的异步钩子（如标记失败），自身异常会被吞掉 */
  onError?: (error: unknown) => Promise<void> | void
  /** 订阅取消时的清理钩子（完成/出错/客户端断开都会触发） */
  onUnsubscribe?: () => void
}

/**
 * AI 调用公共服务
 */
@Injectable()
export class AiCommonService {
  /**
   * 创建 LangChain ChatOpenAI 模型
   */
  createChatModel(credentials: AiCredentials, overrides?: { maxTokens?: number }): ChatOpenAI {
    return new ChatOpenAI({
      model: credentials.modelId,
      apiKey: credentials.apiKey,
      configuration: { baseURL: credentials.baseUrl },
      // 关闭后流式请求不携带 stream_options（部分兼容端点不支持该参数）
      streamUsage: false,
      ...overrides,
    })
  }

  /**
   * 将 LangChain 流式调用转换为 SSE Observable（content 增量 + done 结束信号）
   * 流创建在订阅后才执行，失败走 SSE error 帧；钩子用于会话落库等场景
   */
  sseFromStream(
    streamFactory: () => Promise<AsyncIterable<AIMessageChunk>>,
    { errorLabel, apiKey, onDelta, doneExtra, beforeDone, onError, onUnsubscribe }: SseStreamHooks,
  ): Observable<{ data: string }> {
    return new Observable((subscriber) => {
      ;(async () => {
        try {
          const stream = await streamFactory()
          for await (const chunk of stream) {
            // outputVersion 默认 v0，content 为纯字符串增量
            const delta = typeof chunk.content === 'string' ? chunk.content : ''
            if (delta) {
              onDelta?.(delta)
              subscriber.next({ data: JSON.stringify({ content: delta }) })
            }
          }
          await beforeDone?.()
          subscriber.next({ data: JSON.stringify({ done: true, ...doneExtra }) })
          subscriber.complete()
        } catch (error) {
          try {
            await onError?.(error)
          } catch {
            // 钩子失败不阻断错误帧推送
          }
          subscriber.error(new BadRequestException(this.formatError(error)))
        }
      })()

      return () => onUnsubscribe?.()
    })
  }

  /**
   * 把 AI SDK 抛出的错误格式化为可读中文消息
   * @param error 任意错误对象
   * @returns 已格式化的用户友好提示
   */
  formatError(error: unknown): string {
    const err = error as { message?: string }
    if (err?.message) return err.message
    return '生成失败，请重试'
  }
}
