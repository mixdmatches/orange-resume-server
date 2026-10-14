import { Module } from '@nestjs/common'
import { AgentRunnerService } from './agent.service'
import { AgentController } from './agent.controller'
import { UserModule } from '../user/user.module'
import { AiModule } from '../ai/ai.module'
import { SharedModule } from '../shared/shared.module'

@Module({
  imports: [UserModule, AiModule, SharedModule],
  providers: [AgentRunnerService],
  controllers: [AgentController],
  exports: [AgentRunnerService],
})
export class AgentModule {}
