import { Module } from '@nestjs/common'
import { ResumeService } from './resume.service'
import { ResumeController } from './resume.controller'

/**
 * 简历模块
 * 提供简历 CRUD 相关接口（全部需登录认证）
 * 依赖全局 PrismaModule（不需要显式导入）
 */
@Module({
  providers: [ResumeService],
  controllers: [ResumeController],
  exports: [ResumeService],
})
export class ResumeModule {}
