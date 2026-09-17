import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator'
import { Type } from 'class-transformer'
import { ApiProperty } from '@nestjs/swagger'

/**
 * 服务商配置（请求 + 响应共用）
 *
 * 【响应】apiKeyCipher 为脱敏值（如 sk-d****xG2k）
 * 【请求】apiKeyCipher 可能是脱敏值（未修改，后端保留原密文）或新明文（后端加密存储）
 */
export class MaskedManufacturer {
  @ApiProperty({ description: '服务商唯一标识（如 deepseek / custom-xxx）', example: 'deepseek' })
  @IsNotEmpty({ message: '服务商 providerId 不能为空' })
  @IsString({ message: '服务商 providerId 必须为字符串' })
  @MaxLength(32, { message: '服务商 providerId 长度不能超过 32 位' })
  providerId!: string

  @ApiProperty({
    description: '服务商底层厂商名（用于路由 AI 请求）',
    example: 'deepseek',
    required: false,
  })
  @IsOptional()
  @IsString({ message: '服务商名必须为字符串' })
  @MaxLength(64, { message: '服务商名长度不能超过 64 位' })
  providerName?: string

  @ApiProperty({
    description:
      'API Key。响应时为脱敏值（sk-d****xG2k）；请求时传新明文则后端加密存储，传含 **** 的脱敏值则保留原密文',
    example: 'sk-****************************xG2k',
  })
  @IsString({ message: 'API Key 必须为字符串' })
  @MaxLength(1024, { message: 'API Key 长度不能超过 1024 位' })
  apiKeyCipher!: string

  @ApiProperty({ description: 'API Key 最后4位', example: 'xG2k', required: false })
  @IsOptional()
  @IsString({ message: 'API Key 最后4位 必须为字符串' })
  @MaxLength(4, { message: 'API Key 最后4位 长度不能超过 4 位' })
  apiKeyLast4?: string

  @ApiProperty({ description: '模型 ID', example: 'deepseek-chat', required: false })
  @IsOptional()
  @IsString({ message: '模型 ID 必须为字符串' })
  @MaxLength(128, { message: '模型 ID 长度不能超过 128 位' })
  modelId?: string

  @ApiProperty({
    description: 'API 请求地址',
    example: 'https://api.deepseek.com',
    required: false,
  })
  @IsString({ message: 'API 地址必须为字符串' })
  @MaxLength(512, { message: 'API 地址长度不能超过 512 位' })
  apiEndpoint!: string
}

/**
 * AI 配置（请求 + 响应共用）
 */
export class AiConfigDto {
  @ApiProperty({
    description: '选中的服务商 ID（对应 states[].providerId）。传 null 表示取消选中',
    example: 'deepseek',
    nullable: true,
  })
  @IsOptional()
  @IsString({ message: '选中服务商 ID 必须为字符串' })
  @MaxLength(32, { message: '选中服务商 ID 长度不能超过 32 位' })
  selectedProviderId!: string | null

  @ApiProperty({ description: '自定义润色提示词', nullable: true, required: false })
  @IsOptional()
  @IsString({ message: '润色提示词必须为字符串' })
  @MaxLength(5000, { message: '润色提示词长度不能超过 5000 位' })
  polishPrompt!: string | null

  @ApiProperty({
    description: '服务商配置列表（全量覆盖）',
    type: [MaskedManufacturer],
  })
  @IsArray({ message: '服务商配置必须为数组' })
  @ValidateNested({ each: true })
  @Type(() => MaskedManufacturer)
  states!: MaskedManufacturer[]
}

/***
 * 创建用户AI配置
 */
export class createAiConfigDto {
  @ApiProperty({
    description: '服务商唯一标识（如 deepseek / custom-xxx），不传时后端自动生成',
    example: 'deepseek',
    required: false,
  })
  @IsOptional()
  @IsString({ message: '服务商 providerId 必须为字符串' })
  @MaxLength(32, { message: '服务商 providerId 长度不能超过 32 位' })
  providerId?: string

  @IsString({ message: '服务商名必须为字符串' })
  @MaxLength(20, { message: '服务商名长度不能超过 20 位' })
  providerName: string // 厂商名字

  @IsString({ message: '前端加密后的apiKey必须为字符串' })
  @MaxLength(1024, { message: '前端加密后的apiKey长度不能超过 1024 位' })
  apiKeyEnc: string //前端加密后的apiKey

  @IsString({ message: '模型ID必须为字符串' })
  @MaxLength(50, { message: '模型ID长度不能超过 50 位' })
  modelId: string //模型ID

  @IsString({ message: 'API地址必须为字符串' })
  @MaxLength(512, { message: 'API地址长度不能超过 512 位' })
  apiEndpoint: string //API地址
}
