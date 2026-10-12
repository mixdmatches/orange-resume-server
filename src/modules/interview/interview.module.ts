import { Module } from '@nestjs/common'
import { InterviewController } from './interview.controller'
import { InterviewService } from './interview.service'
import { InterviewLlmService } from './interview-llm.service'
import { UserModule } from '../user/user.module'
import { SharedModule } from '../shared/shared.module'

/**
 * AI 面试模块
 */
@Module({
  imports: [UserModule, SharedModule],
  controllers: [InterviewController],
  providers: [InterviewService, InterviewLlmService],
  exports: [InterviewService],
})
export class InterviewModule {}
