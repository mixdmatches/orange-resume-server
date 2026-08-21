import { IsNotEmpty, IsString } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

/** 语法检查 DTO */
export class GrammarCheckDto {
  /** 简历纯文本内容（已经过拼接的字符串，不是 JSON） */
  @ApiProperty({
    description:
      '简历纯文本（前端把各 section：基本信息+教育+工作经历+项目经历等用换行拼好后的字符串，不是 JSON）',
    example: '张三，13800138000。2018-2022 某某大学软件工程本科。2022至今 XX公司 前端工程师...',
  })
  @IsNotEmpty({ message: 'resumeText 不能为空' })
  @IsString({ message: 'resumeText 必须为字符串' })
  resumeText!: string
}
