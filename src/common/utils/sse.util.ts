import type { Response } from 'express'

/**
 * 设置 SSE（Server-Sent Events）响应头
 * 用于 Controller 中手动管理 SSE 流的场景（@Post + @Res，而非 @Sse）
 *
 * 设置的头：
 * - Content-Type: text/event-stream; charset=utf-8
 * - Cache-Control: no-cache（禁止代理/浏览器缓存）
 * - Connection: keep-alive（长连接）
 * - X-Accel-Buffering: no（防 Nginx 反代缓冲，保证实时推送）
 *
 * @param res Express Response 对象
 */
export function setSseHeaders(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()
}