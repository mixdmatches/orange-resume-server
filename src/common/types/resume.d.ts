/**
 * 简历列表单条摘要结构（不含 content，省流量）
 */
export interface ResumeSummary {
  id: string
  title: string
  templateId: string
  createdAt: number
  updatedAt: number | null
}

/**
 * 简历列表响应结构
 */
export interface ResumeListResult {
  list: ResumeSummary[]
  total: number
}
