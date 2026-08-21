import {
  IsEmail,
  IsNotEmpty,
  IsString,
  Length,
  Matches,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

/**
 * 自定义校验器：确认密码必须与密码一致
 * 作用在 RegisterDto.confirmPassword 字段上
 */
@ValidatorConstraint({ name: 'MatchPassword', async: false })
export class MatchPasswordConstraint implements ValidatorConstraintInterface {
  /**
   * 校验逻辑
   * @param value confirmPassword 输入值
   * @param args 含 object = RegisterDto 实例
   * @returns true = 校验通过
   */
  validate(value: string, args: ValidationArguments): boolean {
    const dto = args.object as RegisterDto
    return typeof value === 'string' && value === dto.password
  }

  /**
   * 默认错误消息
   */
  defaultMessage(): string {
    return '两次输入的密码不一致'
  }
}

/**
 * 用户注册 DTO
 * 定义注册接口请求体结构及其校验规则
 */
export class RegisterDto {
  /**
   * 用户名
   * - 必填
   * - 长度 4-20 位
   * - 只能包含字母、数字、下划线（正则保证）
   */
  @ApiProperty({
    description: '用户名（4-20 位，字母/数字/下划线）',
    minLength: 4,
    maxLength: 20,
    example: 'zhangsan2026',
    pattern: '^[A-Za-z0-9_]+$',
  })
  @IsNotEmpty({ message: '用户名不能为空' })
  @IsString({ message: '用户名必须为字符串' })
  @Length(4, 20, { message: '用户名长度必须为 4-20 位' })
  @Matches(/^[A-Za-z0-9_]+$/, { message: '用户名只能包含字母、数字、下划线' })
  username!: string

  /**
   * 邮箱
   * - 必填
   * - 合法邮箱格式
   */
  @ApiProperty({
    description: '合法邮箱地址（注册后可用于重置密码等后续扩展）',
    example: 'zhangsan@example.com',
  })
  @IsNotEmpty({ message: '邮箱不能为空' })
  @IsEmail({}, { message: '邮箱格式不正确' })
  email!: string

  /**
   * 密码（明文）
   * - 必填
   * - 长度 6-20 位
   */
  @ApiProperty({
    description: '登录密码（6-20 位，明文传入，后端 bcrypt 10 轮哈希后存储）',
    minLength: 6,
    maxLength: 20,
    example: 'Mima123456',
    format: 'password',
  })
  @IsNotEmpty({ message: '密码不能为空' })
  @IsString({ message: '密码必须为字符串' })
  @Length(6, 20, { message: '密码长度必须为 6-20 位' })
  password!: string

  /**
   * 确认密码
   * - 必填
   * - 自定义校验：必须等于 password
   */
  @ApiProperty({
    description: '再次输入的密码（必须与 password 完全一致）',
    minLength: 6,
    maxLength: 20,
    example: 'Mima123456',
    format: 'password',
  })
  @IsNotEmpty({ message: '确认密码不能为空' })
  @IsString({ message: '确认密码必须为字符串' })
  @Validate(MatchPasswordConstraint)
  confirmPassword!: string
}
