import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, Max, Min, IsString } from 'class-validator'

/** 会话列表查询 DTO（offset 分页：会话数量少，无需游标） */
export class ListSessionsDto {
  /** 简历id */
  @IsString()
  resumeId!: string
  /** 按类型筛选（可选：chat / interview，不传返回全部） */
  @IsOptional()
  @IsIn(['chat', 'interview'], { message: 'type 只能是 chat / interview' })
  type: 'chat' | 'interview'

  /** 页码，默认 1 */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page 必须为整数' })
  @Min(1, { message: 'page 至少为 1' })
  page?: number = 1

  /** 每页条数，默认 20，最多 50 */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'pageSize 必须为整数' })
  @Min(1, { message: 'pageSize 至少为 1' })
  @Max(50, { message: 'pageSize 最多为 50' })
  pageSize?: number = 20
}
