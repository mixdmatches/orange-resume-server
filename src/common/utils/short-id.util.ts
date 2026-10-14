import * as crypto from 'node:crypto'

/**
 * 生成 8 位短 ID（与前端策略保持一致）
 * 用于简历 ID、AI 服务商 ID 等需要短标识的场景
 * @returns 8 个字符长度的随机字符串
 */
export function generateShortId(): string {
  return crypto.randomUUID().substring(0, 8)
}
