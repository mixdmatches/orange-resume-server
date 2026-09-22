import { Type } from 'class-transformer'
import { IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator'

/** 会话消息列表查询 DTO（游标分页：消息量大，禁止 offset 深翻页） */
export class ListMessagesDto {
  /** 游标：只返回 id 小于该值的消息（上一页最后一条的 id），不传则从最新开始 */
  @IsOptional()
  @IsString({ message: 'beforeId 必须为字符串' })
  @Matches(/^\d+$/, { message: 'beforeId 必须为纯数字字符串' })
  beforeId?: string

  /** 每页条数，默认 30，最多 100 */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit 必须为整数' })
  @Min(1, { message: 'limit 至少为 1' })
  @Max(100, { message: 'limit 最多为 100' })
  limit?: number = 30
}
