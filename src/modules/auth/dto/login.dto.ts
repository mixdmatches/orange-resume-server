import { IsNotEmpty, IsString } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

/**
 * 用户登录 DTO
 * 定义登录接口请求体结构及其校验规则
 */
export class LoginDto {
  /**
   * 登录标识（可以是用户名或邮箱）
   * 后端通过 findByUsernameOrEmail 自动识别是哪一种
   */
  @ApiProperty({
    description: '登录账号（支持填「用户名」或「邮箱」任意一种，后端自动识别）',
    example: 'zhangsan2026',
  })
  @IsNotEmpty({ message: '用户名或邮箱不能为空' })
  @IsString({ message: '用户名或邮箱必须为字符串' })
  username!: string

  /**
   * 密码（明文）
   */
  @ApiProperty({
    description: '登录密码（明文传入）',
    example: 'Mima123456',
    format: 'password',
  })
  @IsNotEmpty({ message: '密码不能为空' })
  @IsString({ message: '密码必须为字符串' })
  password!: string
}
