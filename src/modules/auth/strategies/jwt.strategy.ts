import { Injectable } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { ConfigService } from '@nestjs/config'
import type { JwtPayload } from '../../../common/types/jwt-payload'

/**
 * Passport JWT 策略
 * 从请求头 Authorization: Bearer <token> 中提取并验证 JWT
 * 验证通过后，把 payload 转换为 JwtPayload 对象返回，
 * Passport 会自动挂到 request.user 属性上（供 @CurrentUser() 读取）
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  /**
   * 构造函数，通过 ConfigService 读取 JWT 配置
   * @param configService Nest 全局配置服务，提供 .env 中的变量
   */
  constructor(private readonly configService: ConfigService) {
    super({
      // 从 Authorization Header 中按 Bearer 方案提取 Token
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      // 开启过期校验（过期后会自动抛 401）
      ignoreExpiration: false,
      // 签名密钥：签发与校验必须一致
      secretOrKey: configService.get<string>('JWT_SECRET') ?? 'fallback-secret-change-me',
    })
  }

  /**
   * Passport 校验成功回调
   * 将 Token 解码后的原始 payload 转换为我们的 JwtPayload 类型
   * @param payload JWT 解码后的对象 { userId, username, iat, exp }
   * @returns 剔除 iat/exp 后的 { userId, username }
   */
  async validate(payload: JwtPayload & { iat?: number; exp?: number }): Promise<JwtPayload> {
    return {
      userId: payload.userId,
      username: payload.username,
    }
  }
}
