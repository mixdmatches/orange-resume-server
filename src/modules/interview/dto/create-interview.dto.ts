import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Max, Min } from 'class-validator'
export class CreateInterviewDto {
  @IsString({ message: 'resumeText 必须为字符串' })
  @MaxLength(20000, { message: 'resumeText 最长 20000 字符' })
  resumeText!: string

  @IsOptional()
  @IsString({ message: 'jobTitle 必须为字符串' })
  @MaxLength(128, { message: 'jobTitle 最长 128 字符' })
  jobTitle?: string

  @IsOptional()
  @IsEnum(['easy', 'medium', 'hard'], { message: 'difficulty 只能是 easy/medium/hard' })
  difficulty?: 'easy' | 'medium' | 'hard'

  @IsOptional()
  @IsString({ message: 'category 必须为字符串' })
  @MaxLength(64, { message: 'category 最长 64 字符' })
  category?: string

  @IsOptional()
  @IsInt({ message: 'questionCount 必须为整数' })
  @Min(5, { message: 'questionCount 最少 5 轮' })
  @Max(20, { message: 'questionCount 最多 20 轮' })
  questionCount?: number

  @IsOptional()
  @IsString({ message: 'jobDescription 必须为字符串' })
  @MaxLength(256, { message: 'jobDescription 最长 256 字符' })
  jobDescription?: string

  @IsOptional()
  @IsString({ message: 'providerId 必须为字符串' })
  @MaxLength(64, { message: 'providerId 最长 64 字符' })
  providerId?: string

  @IsOptional()
  @IsString({ message: 'modelId 必须为字符串' })
  @MaxLength(128, { message: 'modelId 最长 128 字符' })
  modelId?: string
}
