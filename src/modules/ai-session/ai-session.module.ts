import { Module } from '@nestjs/common'
import { AiSessionService } from './ai-session.service'
import { AiSessionController } from './ai-session.controller'
import { UserModule } from '../user/user.module'

/**
 * AI 会话模块
 * 提供有状态的 AI 对话能力（会话持久化 + 消息落库 + 流式对话），
 * 与 AI 代理模块（modules/ai，无状态转发）互补：
 * - 会话类接口的数据由后端落库（ai_session / ai_session_message）
 * - LLM 凭证复用 UserModule 的 UserAiConfigService（加密存取 + 解密）
 * - PrismaModule 全局，无需显式导入
 */
@Module({
  imports: [UserModule],
  providers: [AiSessionService],
  controllers: [AiSessionController],
  exports: [AiSessionService],
})
export class AiSessionModule {}
