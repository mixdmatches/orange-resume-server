import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator'

/**
 * 面试统一流接口 DTO
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
