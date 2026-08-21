import { IsNotEmpty, IsString } from 'class-validator'

/** 简历评分 DTO */
export class ResumeScoreDto {
  /** 简历纯文本内容 */
  @IsNotEmpty({ message: 'resumeText 不能为空' })
  @IsString({ message: 'resumeText 必须为字符串' })
  resumeText!: string
}
