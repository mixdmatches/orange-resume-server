import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard'
import { CurrentUser } from '@/common/decorators/current-user.decorator'
import type { JwtPayload } from '@/common/types/jwt-payload'
import { UserService } from './user.service'
import { UserAiConfigService } from './user-ai-config.service'

/**
 * 用户控制器
 * 路由前缀：user（/api/user/*）
 * 所有接口均需登录（JWT 守卫），通过 @CurrentUser() 获取当前用户身份
 */
@ApiTags('👤 用户 User')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard)
@Controller('user')
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly userAiConfigService: UserAiConfigService,
  ) {}

  /**
   * 获取当前用户的 AI 配置
   * apiKey 已脱敏（只保留前后几位），不会返回加密原文
   *
   * @param user JWT 解析出的当前用户信息
   * @returns AI 配置（选中模型、润色提示词、服务商列表等）
   */
  @Get('ai-config')
  @ApiOperation({ summary: '获取用户 AI 配置（apiKey 已脱敏）' })
  async getAiConfig(@CurrentUser() user: JwtPayload) {
    return this.userAiConfigService.getAiConfig(user.userId)
  }

  /**
   * 获取当前用户的偏好设置
   * preferences 为 JSON 字段，未设置过时返回 null
   *
   * @param user JWT 解析出的当前用户信息
   * @returns 偏好设置对象（如 { theme, defaultTemplate, autoSync }）
   */
  @Get('preferences')
  @ApiOperation({ summary: '获取用户偏好设置' })
  async getPreferences(@CurrentUser() user: JwtPayload) {
    return this.userService.getPreferences(user.userId)
  }

  /**
   * 更新当前用户的偏好设置（整体替换）
   * 前端需提交完整的偏好对象，后端不做字段级合并
   *
   * @param user JWT 解析出的当前用户信息
   * @param preferences 完整的偏好设置对象
   * @returns 更新后的偏好设置对象
   */
  @Put('preferences')
  @ApiOperation({ summary: '更新用户偏好设置（整体替换）' })
  async updatePreferences(
    @CurrentUser() user: JwtPayload,
    @Body() preferences: Record<string, unknown>,
  ) {
    return this.userService.updatePreferences(user.userId, preferences)
  }
}
