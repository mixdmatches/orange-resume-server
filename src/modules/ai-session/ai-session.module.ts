import { Module } from '@nestjs/common'
import { AiSessionService } from './ai-session.service'
import { AiSessionController } from './ai-session.controller'
import { UserModule } from '../user/user.module'
import { SharedModule } from '../shared/shared.module'

/**
 * AI 会话模块
 */
@Module({
  imports: [UserModule, SharedModule],
  providers: [AiSessionService],
  controllers: [AiSessionController],
  exports: [AiSessionService],
})
export class AiSessionModule {}
