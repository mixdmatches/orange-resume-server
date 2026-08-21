import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator'
import { Type } from 'class-transformer'

/** 对话消息角色枚举 */
export type ChatRole = 'system' | 'user' | 'assistant'

/** 单条对话消息 DTO */
export class ChatMessageDto {
  @IsEnum(['system', 'user', 'assistant'], { message: 'role 只能是 system / user / assistant' })
  role!: ChatRole

  @IsNotEmpty({ message: '消息内容不能为空' })
  @IsString({ message: '消息内容必须为字符串' })
  content!: string
}

/** 智能助手流式对话 DTO */
export class ChatStreamDto {
  /** 对话消息列表（包含历史上下文 + system + 当前用户输入） */
  @IsArray({ message: 'messages 必须是数组' })
  @ArrayNotEmpty({ message: 'messages 不能为空' })
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  messages!: ChatMessageDto[]
}
