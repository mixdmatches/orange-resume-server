import { BadRequestException, Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcrypt'
import { ConfigService } from '@nestjs/config'
import { UserService, UserProfile } from '../user/user.service'
import type { JwtPayload } from '../../common/types/jwt-payload'
import type { RegisterDto } from './dto/register.dto'
import type { LoginDto } from './dto/login.dto'

/**
 * 登录成功返回结构
 */
export interface LoginResult {
  /** JWT Token，前端保存在 localStorage 或内存中，请求时放 Authorization Header */
  token: string
  /** 当前用户公开资料（不含 passwordHash） */
  userInfo: UserProfile
}

/**
 * 认证模块 Service
 * 处理注册、登录、登出、获取资料等认证相关业务逻辑
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
   * 1. 根据 identifier 找到用户（支持 username 或 email）
   * 2. bcrypt.compare 校验密码哈希
   * 3. 校验通过后签发 JWT，payload = { userId, username }
   *
   * @param dto 登录参数 { username(或email), password }
   * @returns LoginResult { token, userInfo }
   * @throws BadRequestException (40002) 用户不存在或密码错误（避免与 40101 Token 失效混淆）
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

    // 构造 JWT 载荷
    const payload: JwtPayload = {
      userId: user.id,
      username: user.username,
    }

    // 从配置读取过期时间（默认 7 天）
    const expiresIn: any = this.configService.get<string>('JWT_EXPIRES_IN') ?? '7d'

    // 签发 Token（expiresIn 用 any 兼容字符串形式如 '7d'）
    const token = this.jwtService.sign(payload, { expiresIn })

    return {
      token,
      userInfo: {
        id: user.id,
        username: user.username,
        nickname: user.nickname,
        avatar: user.avatar,
        email: user.email,
      },
    }
  }

  /**
   * 用户登出
   * 后端无状态 JWT，无需做清理操作（前端清除 Token 即可）。
   * 预留位置：后续如需做黑名单/主动失效可在此实现。
   * @returns 固定 { success: true }
   */
  async logout(): Promise<{ success: true }> {
    return { success: true }
  }

  /**
   * 获取当前登录用户的公开资料
   * @param userId 当前用户 ID（从 JWT 获取）
   * @returns 用户资料对象（不含 passwordHash —— profile 接口与登录一致）
   */
  async getProfile(userId: number): Promise<LoginResult['userInfo']> {
    const p = await this.userService.findById(userId)
    return {
      id: p.id,
      username: p.username,
      email: p.email,
      nickname: p.nickname,
      avatar: p.avatar,
    }
  }
}
