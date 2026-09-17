import { Module } from '@nestjs/common'
import { UserService } from './user.service'
import { UserAiConfigService } from './user-ai-config.service'
import { UserController } from './user.controller'

/**
 * 用户模块
 * - 对外暴露 UserService 供 AuthModule 等模块注入
 * - 对外暴露 UserAiConfigService 供 AiModule 读取用户 AI 凭证（AI 代理转发请求用）
 * - 注册 UserController，提供 /user/ai-config、/user/preferences 等路由
 */
@Module({
  providers: [UserService, UserAiConfigService],
  controllers: [UserController],
  exports: [UserService, UserAiConfigService],
})
export class UserModule {}
