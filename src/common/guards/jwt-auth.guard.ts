import { Injectable } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'

/**
 * JWT 认证守卫
 * 使用方式：在 Controller 类或方法上添加 @UseGuards(JwtAuthGuard)
 *
 * 工作原理：
 * 1. 拦截请求，从 Authorization: Bearer <token> 中取出 Token
 * 2. 交给 JwtStrategy 执行校验（secret + 过期时间 + 签名正确性）
 * 3. 校验通过后把 JwtPayload 挂到 request.user，Controller 可通过 @CurrentUser() 取
 * 4. 校验失败会抛出 UnauthorizedException，被全局过滤器转为 code=40101
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
