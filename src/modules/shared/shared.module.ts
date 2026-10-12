import { Module } from '@nestjs/common'
import { UserModule } from '../user/user.module'
import { AiCommonService } from './ai-common.service'
import { CredentialService } from './credential.service'
import { SessionGuardService } from './session-guard.service'

@Module({
  imports: [UserModule],
  providers: [AiCommonService, CredentialService, SessionGuardService],
  exports: [AiCommonService, CredentialService, SessionGuardService],
})
export class SharedModule {}
