import * as crypto from 'node:crypto'
import { ConfigService } from '@nestjs/config'

/**
 * AI 配置加密工具
 * 使用 AES-256-GCM 对称加密算法，保护用户 API Key 等敏感信息
 *
 * 存储格式：base64(iv):base64(authTag):base64(ciphertext)
 * - iv: 12 字节随机初始化向量（每次加密不同）
 * - authTag: 16 字节认证标签（GCM 模式特有，防篡改）
 * - ciphertext: 加密后的密文
 */

/** IV 长度：GCM 推荐使用 12 字节 */
const IV_LENGTH = 12

/**
 * 从环境变量读取加密密钥并派生为 32 字节 Buffer
 * @param configService NestJS ConfigService 实例
 * @returns 32 字节密钥 Buffer
 * @throws Error 如果环境变量未配置或长度不合法
 */
function getKey(configService: ConfigService): Buffer {
  const hex = configService.get<string>('AI_CONFIG_ENCRYPTION_KEY')
  if (!hex || hex.length !== 64) {
    throw new Error('AI_CONFIG_ENCRYPTION_KEY 未配置或长度不正确（需要 64 位十六进制字符串）')
  }
  return Buffer.from(hex, 'hex')
}

/**
 * 加密一个字符串
 * @param plaintext 明文
 * @param configService NestJS ConfigService
 * @returns 格式为 base64(iv):base64(authTag):base64(ciphertext) 的密文字符串
 */
export function encrypt(plaintext: string, configService: ConfigService): string {
  const key = getKey(configService)
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [iv, authTag, ciphertext].map((b) => b.toString('base64')).join(':')
}

/**
 * 解密一个由 encrypt() 生成的密文字符串
 * @param encrypted 密文字符串
 * @param configService NestJS ConfigService
 * @returns 明文字符串
 * @throws Error 如果密文格式错误、密钥不匹配或数据被篡改
 */
export function decrypt(encrypted: string, configService: ConfigService): string {
  const parts = encrypted.split(':')
  if (parts.length !== 3) {
    throw new Error('密文格式错误')
  }
  const [ivB64, authTagB64, ciphertextB64] = parts
  const key = getKey(configService)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64'))
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, 'base64')),
    decipher.final(),
  ])
  return plaintext.toString('utf8')
}

/**
 * 对 API Key 做掩码处理，仅用于返回给前端展示
 * 规则：保留前 4 位和后 4 位，中间用 **** 代替
 * @param apiKey 明文 API Key
 * @returns 掩码后的字符串，如 'sk-d****xG2k'
 */
export function maskApiKey(apiKey: string): string {
  if (!apiKey || apiKey.length <= 8) return '****'
  return `${apiKey.slice(0, 4)}****${apiKey.slice(-4)}`
}
