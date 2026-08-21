import { Module } from '@nestjs/common'
import { AiService } from './ai.service'
import { AiController } from './ai.controller'

/**
 * AI 代理模块
 * 负责所有 AI 能力的服务端代理（转发用户个人 API Key 请求到大模型）
 * 无数据库操作，不依赖 PrismaModule（已全局）
 */
@Module({
  providers: [AiService],
  controllers: [AiController],
  exports: [AiService],
})
export class AiModule {}
