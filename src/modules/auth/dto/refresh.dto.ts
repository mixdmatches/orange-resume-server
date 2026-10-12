import { IsNotEmpty, IsString } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

/**
 * 刷新令牌 DTO
 */
export class RefreshTokenDto {
  /**
   * 刷新令牌（登录或上次刷新时返回的长寿命令牌）
   */
  @ApiProperty({
    description: '刷新令牌（登录接口返回的 refreshToken，用于静默换新 accessToken）',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  @IsNotEmpty({ message: 'refreshToken 不能为空' })
  @IsString({ message: 'refreshToken 必须为字符串' })
  refreshToken!: string
}
