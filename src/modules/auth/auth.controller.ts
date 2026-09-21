import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { AuthService } from './auth.service'
import { RegisterDto } from './dto/register.dto'
import { LoginDto } from './dto/login.dto'
import { RefreshTokenDto } from './dto/refresh.dto'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { JwtPayload } from '../../common/types/jwt-payload'

/**
 * 认证相关路由控制器
 * 路由前缀：auth（配合全局 setGlobalPrefix('api') → /api/auth/*）
 */
@ApiTags('🔐 认证 Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * 用户注册接口
   * POST /api/auth/register
   * 无需登录
   * @param dto 注册参数
   * @returns 新建用户 ID、用户名、邮箱
   */
  @ApiOperation({
    summary: '用户注册',
    description:
      '创建新用户账号。用户名 4-20 位（字母数字下划线），密码 6-20 位，邮箱需合法。注册成功不会自动登录，请继续调用 /login。',
  })
  @ApiBody({
    type: RegisterDto,
    description: '注册参数（用户名/邮箱/密码/确认密码）',
  })
  @ApiResponse({
    status: 200,
    description: '注册成功，code=0。data = { userId, username, email }',
  })
  @ApiResponse({
    status: 200,
    description: '参数校验失败，code=40001。常见：用户名太短、邮箱不合法、两次密码不一致。',
  })
  @ApiResponse({ status: 200, description: '用户名或邮箱已被注册，code=40003' })
  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto)
  }

  /**
   * 用户登录接口
   * POST /api/auth/login
   * 无需登录
   * @param dto 登录参数（username/email + password）
   * @returns { token, userInfo } JWT 与用户公开资料
   */
  @ApiOperation({
    summary: '用户登录（获取双 Token）',
    description:
      'username 字段支持「用户名」或「邮箱」两种形式，后端自动识别。登录成功返回 accessToken（默认 2h，业务请求放 Authorization: Bearer <accessToken>）与 refreshToken（默认 7d，仅用于 /auth/refresh 静默续期）。',
  })
  @ApiBody({ type: LoginDto })
  @ApiResponse({
    status: 200,
    description:
      '登录成功，code=0。data = { accessToken: "eyJ...", refreshToken: "eyJ...", userInfo: {id,username,nickname,avatar} }',
  })
  @ApiResponse({
    status: 200,
    description:
      '用户名/密码错误，code=40002。（为防枚举，统一返回相同错误消息，不区分账号是否存在）',
  })
  @Post('login')
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto)
  }

  /**
   * 刷新令牌接口（双 Token 静默续期）
   * POST /api/auth/refresh
   * 无需登录（accessToken 过期时前端才会调用，携带 refreshToken 换新令牌对）
   * @param dto { refreshToken }
   * @returns 全新的 { accessToken, refreshToken, userInfo }（refresh 轮换，前端整体覆盖保存）
   */
  @ApiOperation({
    summary: '刷新令牌（静默续期）',
    description:
      '前端拦截器收到业务接口 40101 时调用本接口：携带 refreshToken 换取全新 accessToken + refreshToken 并重试原请求。注意 refreshToken 一次一换（轮换），换新成功后旧 refreshToken 立即作废，需整体覆盖保存。并发 401 时前端应合并为一次刷新（共享同一个刷新 Promise）。',
  })
  @ApiBody({ type: RefreshTokenDto })
  @ApiResponse({
    status: 200,
    description:
      '刷新成功，code=0。data = { accessToken, refreshToken, userInfo }。accessToken 默认 2h，refreshToken 默认 7d。',
  })
  @ApiResponse({
    status: 200,
    description: 'refreshToken 无效/过期/类型错误，code=40101。前端应清空本地令牌并跳转登录页。',
  })
  @Post('refresh')
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken)
  }

  /**
   * 用户登出接口
   * POST /api/auth/logout
   * 需要登录（说明用户处于登录态主动退出）
   * @returns 成功标识
   */
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: '用户登出',
    description:
      'MVP 阶段无服务端会话，登出是前端行为：前端删除本地 Token 即可；本接口返回 { success: true } 仅作占位，方便后续接入黑名单机制。',
  })
  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout() {
    return this.authService.logout()
  }

  /**
   * 获取当前登录用户资料
   * GET /api/auth/profile
   * 需要登录
   * @param user 当前登录用户信息（从 Token 解析）
   * @returns 用户公开资料
   */
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: '获取当前登录用户资料',
    description:
      '通过 Bearer Token 自动解析当前 userId，返回用户公开资料（不含 passwordHash、email 等敏感信息）。可用于前端进入需要登录页面时做「Token 有效性自检 + 拉用户信息」。',
  })
  @ApiResponse({
    status: 200,
    description: 'code=0，data = { id, username, nickname, avatar }',
  })
  @ApiResponse({ status: 200, description: 'Token 无效或已过期，code=40101' })
  @UseGuards(JwtAuthGuard)
  @Get('profile')
  async getProfile(@CurrentUser() user: JwtPayload) {
    return this.authService.getProfile(user.userId)
  }
}
