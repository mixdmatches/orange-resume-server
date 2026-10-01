import { IsNotEmpty, IsString } from 'class-validator'

export class AgentChatDto {
  @IsString()
  @IsNotEmpty()
  content: string

  @IsString()
  @IsNotEmpty()
  resumeText: string
}
