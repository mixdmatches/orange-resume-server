import { IsNotEmpty, IsString } from 'class-validator'

/** 岗位匹配分析 DTO */
export class JobMatchDto {
  /** 简历纯文本内容 */
  @IsNotEmpty({ message: 'resumeText 不能为空' })
  @IsString({ message: 'resumeText 必须为字符串' })
  resumeText!: string

  /** 岗位描述（JD）纯文本 */
  @IsNotEmpty({ message: 'jobDescription 不能为空' })
  @IsString({ message: 'jobDescription 必须为字符串' })
  jobDescription!: string
}
