import { z } from 'zod'

/** 单条语法问题（severity 非法时兜底为 warning） */
const GrammarIssueSchema = z.object({
  section: z.string().catch(''),
  original: z.string().catch(''),
  suggestion: z.string().catch(''),
  reason: z.string().catch(''),
  severity: z.enum(['error', 'warning']).catch('warning'),
})

/** 语法检查结果 */
export const GrammarCheckSchema = z.object({
  issues: z.array(GrammarIssueSchema).default([]),
})

/** 单个评分维度 */
const ResumeScoreDimensionSchema = z.object({
  name: z.string().catch(''),
  score: z.coerce.number().catch(0),
  comment: z.string().catch(''),
})

/**
 * 简历评分结果
 * grade 允许缺省，由服务层按 totalScore 推导
 */
export const ResumeScoreSchema = z.object({
  totalScore: z.coerce.number().catch(0),
  grade: z.enum(['S', 'A', 'B', 'C', 'D']).optional(),
  dimensions: z.array(ResumeScoreDimensionSchema).default([]),
  overallComment: z.string().catch(''),
  top3Issues: z.array(z.string()).default([]),
  top3Highlights: z.array(z.string()).default([]),
})

/** 亮点/薄弱点条目 */
const JobMatchPointSchema = z.object({
  section: z.string().catch(''),
  point: z.string().catch(''),
})

/** 岗位匹配分析结果 */
export const JobMatchSchema = z.object({
  matchScore: z.coerce.number().catch(0),
  matchedSkills: z.array(z.string()).default([]),
  missingSkills: z.array(z.string()).default([]),
  highlights: z.array(JobMatchPointSchema).default([]),
  weaknesses: z.array(JobMatchPointSchema).default([]),
  suggestions: z.array(z.string()).default([]),
})

export type GrammarIssue = z.output<typeof GrammarIssueSchema>
export type GrammarSeverity = GrammarIssue['severity']
export type GrammarCheckResult = z.output<typeof GrammarCheckSchema>

export type ResumeScoreDimension = z.output<typeof ResumeScoreDimensionSchema>
export type ResumeScoreResult = z.output<typeof ResumeScoreSchema>

export type JobMatchPoint = z.output<typeof JobMatchPointSchema>
export type JobMatchResult = z.output<typeof JobMatchSchema>
