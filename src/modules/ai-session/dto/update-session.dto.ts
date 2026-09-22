import { IsIn, IsOptional, IsString, Length } from 'class-validator'

/** 更新会话 DTO（重命名 / 归档恢复；软删除走 DELETE 接口，不允许从这里提交） */
export class UpdateSessionDto {
  /** 会话标题 */
  @IsOptional()
  @IsString({ message: 'title 必须为字符串' })
  @Length(1, 128, { message: 'title 长度需在 1-128 之间' })
  title?: string

  /** 会话状态（仅允许 归档/恢复，deleted 由 DELETE 接口负责） */
  @IsOptional()
  @IsIn(['active', 'archived'], { message: 'status 只能是 active / archived' })
  status?: 'active' | 'archived'
}
