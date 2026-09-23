import { Module } from '@nestjs/common'
import { InterviewController } from './interview.controller'
import { InterviewService } from './interview.service'
import { InterviewLlmService } from './interview-llm.service'
import { UserModule } from '../user/user.module'

/**
 * AI 面试模块
 * 提供面试全生命周期：创建 → 生成题库 → 逐题答题（评价流式）→ 总结评分
 * 复用 UserModule 的 UserAiConfigService（凭证解析），PrismaService 全局注入
 */
@Module({
  imports: [UserModule],
  controllers: [InterviewController],
  providers: [InterviewService, InterviewLlmService],
  exports: [InterviewService],
})
export class InterviewModule {}
