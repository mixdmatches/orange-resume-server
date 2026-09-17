import * as crypto from 'node:crypto'
import { ConfigService } from '@nestjs/config'

/**
 * AI 配置加密工具
 * 使用 AES-256-GCM 对称加密算法，保护用户 API Key 等敏感信息
 *
 * 密文存储格式（全程二进制，无字符串编码往返）：
 *   iv(12 字节) ‖ authTag(16 字节) ‖ ciphertext(N 字节)
 * - iv: 12 字节随机初始化向量（每次加密不同）
 * - authTag: 16 字节认证标签（GCM 模式特有，防篡改）
 * - ciphertext: 加密后的密文（与明文等长）
 */

/** IV 长度：GCM 推荐使用 12 字节 */
const IV_LENGTH = 12

/** 认证标签长度：GCM 固定 16 字节 */
const AUTH_TAG_LENGTH = 16

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
 * 加密一个字符串（AES-256-GCM）
 * @param plaintext 明文
 * @param configService NestJS ConfigService
 * @returns 二进制密文，布局：iv(12 字节) ‖ authTag(16 字节) ‖ ciphertext
 * @returns 类型说明：返回 Uint8Array<ArrayBuffer> 而非 Buffer，
 *          因为 Prisma Bytes 生成类型为 Uint8Array<ArrayBuffer>（TS 5.7+ 泛型化），
 *          Buffer（= Uint8Array<ArrayBufferLike>）无法直接赋值，会报 ts(2322)
 */
export function encrypt(plaintext: string, configService: ConfigService): Uint8Array<ArrayBuffer> {
  const key = getKey(configService)
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  // 按固定偏移拼接三段，解密时按同样偏移切分
  const packed = Buffer.concat([iv, authTag, ciphertext])
  // new Uint8Array(ArrayLike) 会复制数据并返回底层为普通 ArrayBuffer 的精确类型，
  // 满足 Prisma Bytes 的类型要求（密文仅几十字节，拷贝开销可忽略）
  return new Uint8Array(packed)
}

/**
 * 解密一个由 encrypt() 生成的二进制密文（AES-256-GCM）
 * @param encrypted 密文二进制（Uint8Array/Buffer），布局：iv(12 字节) ‖ authTag(16 字节) ‖ ciphertext
 * @param configService NestJS ConfigService
 * @returns 明文字符串
 * @throws Error 如果密文长度不足、密钥不匹配或数据被篡改
 */
export function decrypt(encrypted: Uint8Array, configService: ConfigService): string {
  const buf = Buffer.from(encrypted)
  if (buf.length <= IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('密文长度不足')
  }
  const iv = buf.subarray(0, IV_LENGTH)
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
  const ciphertext = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH)
  const key = getKey(configService)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
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
