import { IsArray, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

/**
 * 创建简历 DTO
 * 接收前端完整的 Resume 对象序列化后的数据
 */
export class CreateResumeDto {
  /**
   * 简历 ID（可选）
   * 前端 Local-First 策略会先生成 8 位短 ID 写入本地，然后上传到后端。
   * 后端将优先使用前端传的 ID，保持前后端一致；若未传则兜底自行生成。
   */
  @ApiProperty({
    description:
      '简历 ID（可选，前端 Local-First 策略会先生成）。后端优先使用前端传的 ID，保持前后端一致；未传则兜底自行生成。',
    example: 'a1b2c3d4',
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'id 必须为字符串' })
  id?: string

  /**
   * 使用的模板 ID（如 'classic' / 'modern'）
   */
  @ApiProperty({
    description: '模板 ID（与前端模板名称对齐，例如 classic / modern / simple）',
    example: 'classic',
  })
  @IsNotEmpty({ message: 'templateId 不能为空' })
  @IsString({ message: 'templateId 必须为字符串' })
  templateId!: string

  /**
   * 简历标题
   */
  @ApiProperty({
    description: '简历标题（用户给这份简历起的名字，列表页展示用）',
    example: '3年前端开发-求职简历',
  })
  @IsNotEmpty({ message: '简历标题不能为空' })
  @IsString({ message: '简历标题必须为字符串' })
  title!: string

  /**
   * 完整的简历内容（对应前端 Resume 接口类型的整个对象）
   * 后端直接原样存入 MySQL JSON 字段，不做深度结构校验
   */
  @ApiProperty({
    description:
      '完整的简历内容对象（= 前端 Resume 接口类型的完整对象）。后端不做结构校验，原样存入 MySQL JSON 列。',
    type: 'object',
    additionalProperties: true,
    example: {
      basic: { name: '张三', phone: '13800138000', email: 'zhangsan@example.com' },
      educations: [
        { school: '某某大学', major: '软件工程', degree: '本科', start: '2018-09', end: '2022-06' },
      ],
      experiences: [],
    },
  })
  @IsNotEmpty({ message: '简历内容不能为空' })
  @IsObject({ message: '简历内容必须是对象' })
  content!: Record<string, any>
}

/**
 * 更新简历 DTO
 * MVP 阶段采用全量更新策略：前端把最新的完整 Resume 对象传过来，直接覆盖 content 字段
 */
export class UpdateResumeDto {
  /**
   * 新的模板 ID（可选，不传则不变）
   */
  @ApiProperty({
    required: false,
    description: '新的模板 ID（可选，不传则数据库原值保留）',
    example: 'modern',
  })
  @IsOptional()
  @IsString({ message: 'templateId 必须为字符串' })
  templateId?: string

  /**
   * 新的简历标题（可选，不传则不变）
   */
  @ApiProperty({
    required: false,
    description: '新的简历标题（可选，不传则数据库原值保留）',
    example: '字节跳动-前端工程师（内推版）',
  })
  @IsOptional()
  @IsString({ message: '简历标题必须为字符串' })
  title?: string

  /**
   * 完整的简历内容（前端完整 Resume 对象）
   * MVP 阶段建议必传，执行全量覆盖
   */
  @ApiProperty({
    description: '完整的简历对象（MVP 阶段全量覆盖，建议必传）',
    type: 'object',
    additionalProperties: true,
  })
  @IsNotEmpty({ message: '简历内容不能为空' })
  @IsObject({ message: '简历内容必须是对象' })
  content!: Record<string, any>
}

/**
 * 删除多份简历 DTO
 */
export class DeleteBatchResumeDto {
  /**
   * 要删除的简历 ID 列表
   */
  @ApiProperty({
    description: '要删除的简历 ID 列表',
    type: 'array',
    items: { type: 'string' },
  })
  @IsNotEmpty({ message: '要删除的简历 ID 列表不能为空' })
  @IsArray({ message: '要删除的简历 ID 列表必须是数组' })
  ids!: string[]
}
