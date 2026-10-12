import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcrypt'
import { ConfigService } from '@nestjs/config'
import { UserService, UserProfile } from '../user/user.service'
import type { JwtPayload, JwtTokenType } from '../../common/types/jwt-payload'
import type { RegisterDto } from './dto/register.dto'
import type { LoginDto } from './dto/login.dto'

/**
 * 登录成功返回结构（双 Token 版本）
 */
export interface LoginResult {
  /** 访问令牌（默认 2h 过期）：所有业务接口的通行证 */
  accessToken: string
  /** 刷新令牌（默认 7d 过期）：accessToken 过期后用它换新，平时不参与业务请求 */
  refreshToken: string
  /** 当前用户公开资料（不含 passwordHash） */
  userInfo: UserProfile
}

/**
 * JWT 签发载荷：在用户标识基础上附加 token 类型（access/refresh）
 */
type SignPayload = JwtPayload & { type: JwtTokenType }

/**
 * 认证模块 Service
 * 处理注册、登录、刷新令牌、登出、获取资料等认证相关业务逻辑
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 用户注册
   * 调用 UserService.createUser 完成入库
   *
   * @param dto 注册参数 { username, email, password, confirmPassword }
   * @returns { userId, username, email } 新建用户信息（不含敏感字段）
   */
  async register(dto: RegisterDto): Promise<{
    userId: number
    username: string
    email: string
  }> {
    return this.userService.createUser({
      username: dto.username,
      email: dto.email,
      password: dto.password,
    })
  }

  /**
   * 用户登录
   *
   * @param dto 登录参数 { username(或email), password }
   * @returns LoginResult { accessToken, refreshToken, userInfo }
   */
  async login(dto: LoginDto): Promise<LoginResult> {
    const user = await this.userService.findByUsernameOrEmail(dto.username)
    if (!user) {
      throw new BadRequestException('用户不存在或密码错误')
    }

    const ok = await bcrypt.compare(dto.password, user.passwordHash)
    if (!ok) {
      // 与用户不存在返回同一条 message，避免"枚举"攻击（攻击者无法通过响应判断哪些用户名存在）
      throw new BadRequestException('用户不存在或密码错误')
    }

    return this.issueTokens(user)
  }

  /**
   * 刷新令牌（双 Token 静默续期的核心方法）
   * 1. verifyAsync 验证 refreshToken 的签名与有效期（过期/篡改统一按登录失效处理）
   * 2. 校验 payload.type 必须为 refresh（防止有人拿 accessToken 来换新）
   * 3. 签发全新令牌对（refresh 轮换：旧 refreshToken 随即作废，前端需整体覆盖保存）
   *
   * @param refreshToken 登录（或上次刷新）返回的刷新令牌
   * @returns LoginResult 全新的 { accessToken, refreshToken, userInfo }
   * @throws UnauthorizedException (40101) 令牌无效/过期/类型错误 —— 前端应跳转登录页
   */
  async refresh(refreshToken: string): Promise<LoginResult> {
    let payload: SignPayload
    try {
      // 验签密钥取自 JwtModule.registerAsync 注入的模块级 secret，无需显式传入
      payload = await this.jwtService.verifyAsync<SignPayload>(refreshToken)
    } catch {
      // 覆盖三类失败：TokenExpiredError（过期）、JsonWebTokenError（签名/格式错误）
      // 前端对 40101 的处理一致：清空本地令牌并跳转登录页
      throw new UnauthorizedException('登录状态已失效，请重新登录')
    }

    // 类型校验：refresh 令牌只能用于换新，不能反向冒充 accessToken；反之 accessToken 也不能拿来刷新
    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('无效的令牌类型')
    }

    // 确认用户仍存在（幂等：即使令牌有效，用户被删后也不允许续期）
    const user = await this.userService.findById(payload.userId)
    return this.issueTokens(user)
  }

  /**
   * 用户登出
   * 后端无状态 JWT，无需做清理操作（前端清除本地双 Token 即可）。
   * 预留位置：后续如需做黑名单/主动失效可在此实现。
   * @returns 固定 { success: true }
   */
  async logout(): Promise<{ success: true }> {
    return { success: true }
  }

  /**
   * 获取当前登录用户的公开资料
   * @param userId 当前用户 ID（从 accessToken JWT 获取）
   * @returns 用户资料对象（不含 passwordHash —— profile 接口与登录一致）
   */
  async getProfile(userId: number): Promise<LoginResult['userInfo']> {
    const user = await this.userService.findById(userId)
    return this.toProfile(user)
  }

  /**
   * 签发 accessToken + refreshToken 令牌对，并组装登录/刷新的统一返回结构
   * 两个 Token 共用同一 secret，靠 payload.type 区分，各自有效期独立可配：
   * - access：JWT_ACCESS_EXPIRES_IN，默认 2h（短寿命降低泄露风险）
   * - refresh：JWT_REFRESH_EXPIRES_IN，回退兼容旧配置 JWT_EXPIRES_IN，默认 7d
   *
   * @param user 用户完整信息（findByUsernameOrEmail / findById 的返回值）
   * @returns LoginResult { accessToken, refreshToken, userInfo }
   */
  private issueTokens(user: UserProfile): LoginResult {
    // access 令牌有效期：默认 2 小时
    const accessExpiresIn: any = this.configService.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '2h'
    // refresh 令牌有效期：优先读专用配置，回退到旧配置 JWT_EXPIRES_IN（保持 .env 兼容），最终默认 7 天
    const refreshExpiresIn: any =
      this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') ??
      this.configService.get<string>('JWT_EXPIRES_IN') ??
      '7d'

    const basePayload: Omit<SignPayload, 'type'> = {
      userId: user.id,
      username: user.username,
    }

    const accessToken = this.jwtService.sign(
      { ...basePayload, type: 'access' },
      { expiresIn: accessExpiresIn },
    )
    const refreshToken = this.jwtService.sign(
      { ...basePayload, type: 'refresh' },
      { expiresIn: refreshExpiresIn },
    )

    return {
      accessToken,
      refreshToken,
      userInfo: this.toProfile(user),
    }
  }

  /**
   * 将用户数据映射为对外公开的资料结构（剔除 passwordHash 等敏感字段）
   * @param user 用户数据（含完整字段）
   * @returns 公开资料 { id, username, email, nickname, avatar }
   */
  private toProfile(user: UserProfile): UserProfile {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      nickname: user.nickname,
      avatar: user.avatar,
    }
  }
}
