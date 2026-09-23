import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator'

/**
 * 面试统一流接口 DTO
 * 开始 / 答题 / 提前结束共用一个入口，具体行为由 interview_session.status 决定：
 * - pending_questions → 开始面试（content 被忽略）
 * - in_progress + content → 答题
 * - in_progress + finishOnly=true → 提前结束（content 可不传，视为放弃当前题）
 */
export class InterviewStreamDto {
  /** 回答内容：答题时必填；开始面试时忽略；提前结束时可省略 */
  @IsOptional()
  @IsString({ message: 'content 必须为字符串' })
  @MaxLength(8000, { message: 'content 最长 8000 字符' })
  content?: string

  /** 是否提前结束面试：true = 跳过本题评价直接生成总结评分 */
  @IsOptional()
  @IsBoolean({ message: 'finishOnly 必须为布尔值' })
  finishOnly?: boolean
}
