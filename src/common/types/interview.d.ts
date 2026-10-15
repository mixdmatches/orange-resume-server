/** 面试 SSE 事件类型 */
type InterviewSseEvent =
  /** 开始出第 round 题（前端显示"面试官正在提问…"） */
  | { event: 'question_start'; round: number; totalRounds: number }
  /** 题目文本流式增量 */
  | { event: 'question'; content: string }
  /** 本题出完（完整文本已落库，前端可开始接收回答） */
  | { event: 'question_done'; round: number; totalRounds: number }
  /** 开始生成总结 */
  | { event: 'summary_start' }
  /** 总结文本流式增量 */
  | { event: 'summary'; content: string }
  /** 整个面试流程结束 */
  | {
      event: 'done'
      totalScore: number
      summary: string
      scoreDetail: InterviewScoreDetail
      interviewSession: Record<string, unknown>
    }
  /** 错误事件 */
  | { event: 'error'; message: string }

/** SSE Push 函数签名 */
type SsePush = (payload: InterviewSseEvent) => void

/** 面试会话详情（序列化后返回给前端，含所有消息 + 评分） */
export interface InterviewDetail {
  id: string
  userId: number
  resumeText: string
  jobTitle: string | null
  difficulty: string
  category: string | null
  status: InterviewStatus
  totalRounds: number
  answeredRounds: number
  totalScore: number | null
  summary: string | null
  scoreDetail: InterviewScoreDetail | null
  durationSec: number | null
  questions: Array<{
    roundIndex: number
    question: string
  }>
  answers: Array<{
    roundIndex: number
    content: string
  }>
  evaluations: Array<{
    roundIndex: number
    score: number
    feedback: string
    strengths: string[]
    weaknesses: string[]
    suggestions: string[]
  }>
  createdAt: string
  updatedAt: string
}
