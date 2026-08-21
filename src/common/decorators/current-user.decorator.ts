import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import type { JwtPayload } from '../types/jwt-payload'

/**
 * 获取当前登录用户信息的参数装饰器
 * 配合 @UseGuards(JwtAuthGuard) 使用，直接从 request.user 中取到 JwtPayload
 *
 * 使用示例：
 * @Get('profile')
 * @UseGuards(JwtAuthGuard)
 * getProfile(@CurrentUser() user: JwtPayload) { ... }
 *
 * @param data 装饰器参数（未使用）
 * @param ctx 执行上下文
 * @returns JwtPayload { userId, username }，若无认证则为 undefined
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload => {
    const request = ctx.switchToHttp().getRequest()
    return request.user as JwtPayload
  },
)
