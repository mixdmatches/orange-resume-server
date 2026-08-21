import { IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator'
import { Type } from 'class-transformer'

/** 生成面试问题 DTO */
export class InterviewQuestionsDto {
  /** 简历内容（纯文本字符串） */
  @IsNotEmpty({ message: 'resumeContent 不能为空' })
  @IsString({ message: 'resumeContent 必须为字符串' })
  resumeContent!: string

  /** 生成的问题数量，默认 5，取值 1-20 */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'questionCount 必须为整数' })
  @Min(1, { message: 'questionCount 至少为 1' })
  @Max(20, { message: 'questionCount 最多为 20' })
  questionCount?: number = 5
}
