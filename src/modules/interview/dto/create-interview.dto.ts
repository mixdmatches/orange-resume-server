import { IsEnum, IsInt, IsOptional, IsString, Length, MaxLength, Max, Min } from 'class-validator'

/** 创建面试会话 DTO（同步创建 ai_session + interview_session，状态 pending_questions） */
export class CreateInterviewDto {
  /** 简历 ID（必须是当前用户拥有的简历） */
  @IsString({ message: 'resumeId 必须为字符串' })
  @Length(1, 10, { message: 'resumeId 长度需在 1-10 之间' })
  resumeId!: string

  /** 目标岗位（如"前端工程师"） */
  @IsOptional()
  @IsString({ message: 'jobTitle 必须为字符串' })
  @MaxLength(128, { message: 'jobTitle 最长 128 字符' })
  jobTitle?: string

  /** 面试难度（默认 medium） */
  @IsOptional()
  @IsEnum(['easy', 'medium', 'hard'], { message: 'difficulty 只能是 easy/medium/hard' })
  difficulty?: 'easy' | 'medium' | 'hard'

  /** 题目类型（技术 / 行为 / 项目深挖，可空表示混合出题） */
  @IsOptional()
  @IsString({ message: 'category 必须为字符串' })
  @MaxLength(64, { message: 'category 最长 64 字符' })
  category?: string

  /**
   * 面试总轮数（前端指定，默认 5）
   * 动态出题模式按此轮数逐轮生成，范围 3-10
   */
  @IsOptional()
  @IsInt({ message: 'questionCount 必须为整数' })
  @Min(5, { message: 'questionCount 最少 5 轮' })
  @Max(20, { message: 'questionCount 最多 20 轮' })
  questionCount?: number

  /** 面试岗位描述（可选） */
  @IsOptional()
  @IsString({ message: 'jobDescription 必须为字符串' })
  @MaxLength(256, { message: 'jobDescription 最长 256 字符' })
  jobDescription?: string

  /** 指定厂商标识（可选，不传则用用户当前选中的服务商） */
  @IsOptional()
  @IsString({ message: 'providerId 必须为字符串' })
  @MaxLength(64, { message: 'providerId 最长 64 字符' })
  providerId?: string

  /** 指定模型 ID（可选） */
  @IsOptional()
  @IsString({ message: 'modelId 必须为字符串' })
  @MaxLength(128, { message: 'modelId 最长 128 字符' })
  modelId?: string
}
