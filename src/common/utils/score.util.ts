/** 简历评分等级 */
export type ScoreGrade = 'S' | 'A' | 'B' | 'C' | 'D'

/**
 * 把总分映射到 S/A/B/C/D 等级（同前端 scoreToGrade 逻辑）
 * @param score 0-100 的总分
 * @returns 等级字符串 S/A/B/C/D
 */
export function scoreToGrade(score: number): ScoreGrade {
  if (score >= 90) return 'S'
  if (score >= 80) return 'A'
  if (score >= 70) return 'B'
  if (score >= 60) return 'C'
  return 'D'
}
