import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard'
import { CurrentUser } from '@/common/decorators/current-user.decorator'
import type { JwtPayload } from '@/common/types/jwt-payload'
import { UserAiConfigService } from './user-ai-config.service'
import { createAiConfigDto } from './dto/ai-config.dto'
import { UserService } from '@/modules/user/user.service'

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
    private readonly userAiConfigService: UserAiConfigService,
    private readonly userService: UserService,
  ) {}

  /**
   * 注销用户账号
   */
  @Post('delete')
  @ApiOperation({
    summary:
      '注销用户账号（含所有关联数据），并清除本地 Token。注意：注销后用户无法登录，需重新注册。',
  })
  @Post('delete')
  async deleteAccount(@CurrentUser() user: JwtPayload) {
    await this.userService.deleteAccount(user.userId)
  }

  /**
   * 新增用户 AI 配置
   */
  @Post('ai-config')
  @ApiOperation({ summary: '新增用户 AI 配置（选中模型、润色提示词、服务商列表等）' })
  async addAiConfig(@CurrentUser() user: JwtPayload, @Body() config: createAiConfigDto) {
    return this.userAiConfigService.addOrUpdateAiConfig(user.userId, config)
  }

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
   * 删除用户 AI 配置
   * @param user JWT 解析出的当前用户信息
   * @param id 服务商 ID
   * @returns 删除结果
   */
  @Delete('ai-config/:id')
  @ApiOperation({ summary: '删除用户 AI 配置（选中模型、润色提示词、服务商列表等）' })
  async deleteAiConfig(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.userAiConfigService.deleteAiConfig(user.userId, id)
  }

  /**
   * 获取用户选中模型和润色提示词
   * @param user JWT 解析出的当前用户信息
   * @returns 用户选中模型和润色提示词
   */
  @Get('ai-config/sel-model-and-prompt')
  @ApiOperation({ summary: '获取用户选中模型和润色提示词' })
  async getSelModelAndPrompt(@CurrentUser() user: JwtPayload) {
    return this.userAiConfigService.getSelModelAndPrompt(user.userId)
  }

  /**
   * 更新用户选中模型和润色提示词
   * @param user JWT 解析出的当前用户信息
   * @param config 更新参数（选中模型ID、润色提示词）
   * @returns 更新结果
   */
  @Put('ai-config/sel-model-and-prompt')
  @ApiOperation({ summary: '更新用户选中模型和润色提示词' })
  async updateSelModelAndPrompt(
    @CurrentUser() user: JwtPayload,
    @Body() config: { selectedProviderId: string; polishPrompt: string },
  ) {
    return this.userAiConfigService.updateSelModelAndPrompt(
      user.userId,
      config.selectedProviderId,
      config.polishPrompt,
    )
  }
}
