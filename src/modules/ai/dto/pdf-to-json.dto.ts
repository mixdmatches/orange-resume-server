import { IsNotEmpty, IsString } from 'class-validator'

/** PDF 转结构化简历 DTO */
export class PdfToJsonDto {
  /** 从 PDF 中提取出来的纯文本（前端已经完成解析，后端只负责 AI 结构化） */
  @IsNotEmpty({ message: 'pdfText 不能为空' })
  @IsString({ message: 'pdfText 必须为字符串' })
  pdfText!: string
}
