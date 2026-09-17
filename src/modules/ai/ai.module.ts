import { Module } from '@nestjs/common'
import { AiService } from './ai.service'
import { AiController } from './ai.controller'
import { UserModule } from '../user/user.module'

/**
 * AI 代理模块
 * 负责所有 AI 能力的服务端代理（转发请求到大模型）
 * 用户 AI 凭证（API Key/BaseURL/Model）从后端数据库读取：
 * - 导入 UserModule 复用 UserAiConfigService（加密存取 + 凭证解密）
 * - PrismaModule 全局，无需显式导入
 */
@Module({
  imports: [UserModule],
  providers: [AiService],
  controllers: [AiController],
  exports: [AiService],
})
export class AiModule {}
