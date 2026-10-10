import { IsEnum, IsOptional, IsString, Length, MaxLength } from 'class-validator'

/** 创建会话 DTO */
export class CreateSessionDto {
  @IsString({ message: 'resumeId必须为字符串' })
  resumeId!: string

  /** 会话类型：暂时只开放对话类型（面试会话由后续面试流程接口创建） */
  @IsEnum(['chat'], { message: 'type 暂时只支持 chat' })
  type!: 'chat'

  /** 会话标题（可选，不传默认"新对话"，首条用户消息发出后自动截取覆盖） */
  @IsOptional()
  @IsString({ message: 'title 必须为字符串' })
  @Length(1, 128, { message: 'title 长度需在 1-128 之间' })
  title?: string

  /** 指定使用的厂商标识（可选，不传则用用户当前选中的服务商） */
  @IsOptional()
  @IsString({ message: 'providerId 必须为字符串' })
  @MaxLength(64, { message: 'providerId 最长 64 字符' })
  providerId?: string

  /** 指定使用的模型 ID（可选，仅作记录展示，实际以厂商配置为准） */
  @IsOptional()
  @IsString({ message: 'modelId 必须为字符串' })
  @MaxLength(128, { message: 'modelId 最长 128 字符' })
  modelId?: string
}
