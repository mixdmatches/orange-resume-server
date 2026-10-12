import { Injectable } from '@nestjs/common'
import OpenAI from 'openai'
import type { AiCredentials } from '../user/user-ai-config.service'

/**
 * AI 调用公共服务
 */
@Injectable()
export class AiCommonService {
  /**
   * @param credentials 解密后的用户凭证 { apiKey, baseUrl, modelId }
   * @returns OpenAI 客户端实例
   */
  createOpenAIClient(credentials: AiCredentials): OpenAI {
    return new OpenAI({ apiKey: credentials.apiKey, baseURL: credentials.baseUrl })
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

  /**
   * 对 API Key 做掩码处理（仅保留前 8 位），用于错误日志打印
   * 避免完整 Key 泄漏到日志或控制台
   * @param key 明文 API Key
   * @returns 掩码后的字符串，如 'sk-abcdef***'
   */
  maskKey(key: string): string {
    if (!key || key.length <= 8) return '***'
    return `${key.slice(0, 8)}***`
  }
}
