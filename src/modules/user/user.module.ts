import { Module } from '@nestjs/common'
import { UserService } from './user.service'

/**
 * 用户模块
 * 仅暴露 UserService 供其他模块（如 AuthModule）注入使用
 */
@Module({
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
