/**
 * 会话接口响应结构
 */
export interface SerializedSession {
  id: string
  resumeId: string
  userId: number
  type: SessionType
  title: string
  providerId: string | null
  modelId: string | null
  /** 会话状态（active 正常 / archived 归档 / deleted 软删除） */
  status: SessionStatus
  messageCount?: number
  /** 面试扩展信息（仅 interview 类型会话存在，chat 会话为 null） */
  interviewSession: SerializedInterviewSession | null
  createdAt: Date
  updatedAt: Date
}

/**
 * 面试扩展信息的序列化结构
 */
export interface SerializedInterviewSession {
  resumeId: string
  jobTitle: string | null
  difficulty: Difficulty
  /** 题目类型（技术 / 行为 / 项目深挖等，null 表示混合出题） */
  category: string | null
  /** 面试总分 */
  totalScore: number | null
  /** AI 生成的面试总结报告 */
  summary: string | null
  /** 面试总耗时（秒） */
  durationSec: number | null
}
