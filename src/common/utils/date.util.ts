/**
 * 将 Date 对象转换为毫秒时间戳
 */
export function toTimestamp(dt?: Date): number | null {
  return dt?.getTime() ?? null
}
