import { Injectable, UnauthorizedException } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { ConfigService } from '@nestjs/config'
import type { JwtPayload, JwtTokenType } from '../../../common/types/jwt-payload'
import { UserService } from '@/modules/user/user.service'

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
  constructor(
    private readonly configService: ConfigService,
    private readonly userService: UserService,
  ) {
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
   * 签名与有效期已由 passport-jwt 自动完成，这里补充业务层校验：
   * 1. 拒绝 refresh 类型令牌 —— refreshToken 长寿命，一旦允许访问业务接口，
   *    泄露后的危害等同于长期 accessToken，违背双 Token 的设计初衷
   * 2. 将解码后的 payload 精简为 JwtPayload 返回，挂载到 request.user
   * @param payload JWT 解码后的对象 { userId, username, type?, iat, exp }
   * @returns { userId, username }
   * @throws UnauthorizedException 当令牌为 refresh 类型时（code=40101）
   */
  async validate(
    payload: JwtPayload & { type?: JwtTokenType; iat?: number; exp?: number },
  ): Promise<JwtPayload> {
    // 纵深防御：refreshToken 只能调 /auth/refresh，不允许访问任何业务接口
    if (payload.type === 'refresh') {
      throw new UnauthorizedException('无效的令牌类型')
    }

    await this.userService.findById(payload.userId).catch(() => new UnauthorizedException('用户不存在或已被删除'))

    return {
      userId: payload.userId,
      username: payload.username,
    }
  }
}
