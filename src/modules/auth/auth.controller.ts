import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { AuthService } from './auth.service'
import { RegisterDto } from './dto/register.dto'
import { LoginDto } from './dto/login.dto'
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
    summary: '用户登录（获取 JWT Token）',
    description:
      'username 字段支持「用户名」或「邮箱」两种形式，后端自动识别。登录成功返回 JWT Token，需要将 Token 放入后续请求的 Authorization: Bearer <token> 头中。',
  })
  @ApiBody({ type: LoginDto })
  @ApiResponse({
    status: 200,
    description:
      '登录成功，code=0。data = { token: "eyJ...", userInfo: {id,username,nickname,avatar} }。Token 默认 7 天有效。',
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
