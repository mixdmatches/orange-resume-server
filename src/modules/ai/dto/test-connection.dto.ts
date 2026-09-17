import { ApiProperty } from '@nestjs/swagger'
import { IsString, MaxLength } from 'class-validator'

/**
 * 测试 AI 连接请求体
 */
export class TestConnectionDto {
  @ApiProperty({
    description: '服务商唯一标识（ai_provider.providerId）。传入则测试该条已保存配置',
    example: 'deepseek',
    required: false,
  })
  @IsString({ message: '服务商 providerId 必须为字符串' })
  @MaxLength(64, { message: '服务商 providerId 长度不能超过 64 位' })
  providerId: string
}
