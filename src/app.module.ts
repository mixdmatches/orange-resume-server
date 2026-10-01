import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { PrismaModule } from './prisma/prisma.module'
import { AuthModule } from './modules/auth/auth.module'
import { UserModule } from './modules/user/user.module'
import { ResumeModule } from './modules/resume/resume.module'
import { AiModule } from './modules/ai/ai.module'
import { AiSessionModule } from './modules/ai-session/ai-session.module'
import { InterviewModule } from './modules/interview/interview.module'
import { AgentModule } from './modules/agent/agent.module'

@Module({
  imports: [
    // Config 全局化：isGlobal=true 之后无需在各模块重复导入 ConfigModule
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
    }),
    PrismaModule,
    UserModule,
    AuthModule,
    ResumeModule,
    AiModule,
    AiSessionModule,
    InterviewModule,
    AgentModule,
  ],
})
export class AppModule {}
