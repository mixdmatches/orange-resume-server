import { Module } from '@nestjs/common'
import { UserService } from './user.service'
import { UserAiConfigService } from './user-ai-config.service'
import { UserController } from './user.controller'

/**
 * 用户模块
 * - 对外暴露 UserService 供 AuthModule 等模块注入
 * - 注册 UserController，提供 /user/ai-config、/user/preferences 等路由
 * - UserAiConfigService 处理 AI 配置的加密存取，仅在模块内使用
 */
@Module({
  providers: [UserService, UserAiConfigService],
  controllers: [UserController],
  exports: [UserService],
})
export class UserModule {}
