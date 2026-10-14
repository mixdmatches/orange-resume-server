import { Body, Controller, HttpException, Param, Post, Res, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Response } from 'express'
import { AgentRunnerService } from './agent.service'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { JwtPayload } from '../../common/types/jwt-payload'
import { setSseHeaders } from '@/common/utils/sse.util'
import { AgentChatDto } from './dto/agent-chat.dto'
import { PrismaService } from '@/prisma/prisma.service'

@ApiTags('🧠 Agent 智能体')
@ApiBearerAuth('bearer')
@Controller('agent')
@UseGuards(JwtAuthGuard)
export class AgentController {
  constructor(
    private readonly agentRunner: AgentRunnerService,
    private readonly prismaService: PrismaService,
  ) {}

  /**
   * Agent 会话内流式对话（支持工具调用）
   * POST /api/agent/:sessionId/chat/stream
   *
   * SSE 事件协议：
   * - { type: 'content', content: '...' }：AI 文本增量
   * - { type: 'tool_call', name, args }：Agent 调用了某个工具
   * - { type: 'tool_result', name, output }：工具执行完成
   * - { type: 'done', messageId, promptTokens, completionTokens }：整轮结束
   * - { type: 'error', error }：出错
   */
  @ApiOperation({
    summary: '（SSE 流式）Agent 对话（支持工具调用）',
    description:
      '与普通对话的区别：Agent 会自主调用 resume_score/grammar_check/job_match 等工具，再基于工具结果给出回答。⚠️ Swagger UI 无法实时显示 SSE，请用前端或 curl -N 测试。',
  })
  @ApiBody({ type: AgentChatDto })
  @Post(':sessionId/chat/stream')
  async chatStream(
    @CurrentUser() user: JwtPayload,
    @Param('sessionId') sessionId: string,
    @Body() dto: AgentChatDto,
    @Res() res: Response,
  ): Promise<void> {
    // 从数据库中查找providerId
    const preference = await this.prismaService.aiPreference.findUnique({
      where: { userId: user.userId },
    })
    const providerId = preference?.selectedProviderId

    // 先完成校验/落库/凭证解析，失败时走异常过滤器返回 JSON
    const source = await this.agentRunner.agentChat(
      user.userId,
      sessionId,
      dto.content,
      dto.resumeText,
      providerId,
    )

    setSseHeaders(res)

    const subscription = source.subscribe({
      next: (msg) => res.write(`data: ${msg.data}\n\n`),
      error: (err) => {
        const msg = err instanceof HttpException ? err.message : '生成失败，请重试'
        res.write(`data: ${JSON.stringify({ type: 'error', error: msg })}\n\n`)
        res.end()
      },
      complete: () => res.end(),
    })

    res.on('close', () => subscription.unsubscribe())
  }
}
