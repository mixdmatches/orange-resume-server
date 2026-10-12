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
 */
export class MaskedManufacturer {
  @IsNotEmpty({ message: '服务商 providerId 不能为空' })
  @IsString({ message: '服务商 providerId 必须为字符串' })
  @MaxLength(32, { message: '服务商 providerId 长度不能超过 32 位' })
  providerId!: string

  @IsOptional()
  @IsString({ message: '服务商名必须为字符串' })
  @MaxLength(64, { message: '服务商名长度不能超过 64 位' })
  providerName?: string

  @IsString({ message: 'API Key 必须为字符串' })
  @MaxLength(1024, { message: 'API Key 长度不能超过 1024 位' })
  apiKeyCipher!: string

  @IsOptional()
  @IsString({ message: 'API Key 最后4位 必须为字符串' })
  @MaxLength(4, { message: 'API Key 最后4位 长度不能超过 4 位' })
  apiKeyLast4?: string

  @IsOptional()
  @IsString({ message: '模型 ID 必须为字符串' })
  @MaxLength(128, { message: '模型 ID 长度不能超过 128 位' })
  modelId?: string

  @IsString({ message: 'API 地址必须为字符串' })
  @MaxLength(512, { message: 'API 地址长度不能超过 512 位' })
  apiEndpoint!: string
}

/**
 * AI 配置（请求 + 响应共用）
 */
export class AiConfigDto {
  @IsOptional()
  @IsString({ message: '选中服务商 ID 必须为字符串' })
  @MaxLength(32, { message: '选中服务商 ID 长度不能超过 32 位' })
  selectedProviderId!: string | null

  @IsOptional()
  @IsString({ message: '润色提示词必须为字符串' })
  @MaxLength(5000, { message: '润色提示词长度不能超过 5000 位' })
  polishPrompt!: string | null

  @IsArray({ message: '服务商配置必须为数组' })
  @ValidateNested({ each: true })
  @Type(() => MaskedManufacturer)
  states!: MaskedManufacturer[]
}

/***
 * 创建用户AI配置
 */
export class createAiConfigDto {
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
