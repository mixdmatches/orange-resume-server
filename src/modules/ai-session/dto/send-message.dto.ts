import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator'

/** 会话内发送消息 DTO（流式对话） */
export class SendMessageDto {
  /** 用户输入的消息内容 */
  @IsNotEmpty({ message: 'content 不能为空' })
  @IsString({ message: 'content 必须为字符串' })
  @MaxLength(16000, { message: 'content 最长 16000 字符' })
  content!: string

  /** 指定本次使用的厂商标识（可选，不传则用用户当前选中的服务商） */
  @IsOptional()
  @IsString({ message: 'providerId 必须为字符串' })
  @MaxLength(64, { message: 'providerId 最长 64 字符' })
  providerId?: string
}
