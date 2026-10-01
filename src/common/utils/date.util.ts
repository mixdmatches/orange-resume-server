/**
 * 将 Date 对象转换为毫秒时间戳
 * 用于把 Prisma 返回的 Date 类型统一转为前端期望的 number 时间戳
 * @param dt Prisma 返回的 Date 对象（可能为 undefined）
 * @returns 毫秒时间戳，或 null（当 dt 为空时）
 */
export function toTimestamp(dt?: Date): number | null {
  return dt?.getTime() ?? null
}