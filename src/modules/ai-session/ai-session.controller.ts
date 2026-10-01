import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import type { Response } from 'express'
import { setSseHeaders } from '@/common/utils/sse.util'
import { AiSessionService } from './ai-session.service'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { JwtPayload } from '../../common/types/jwt-payload'
import { CreateSessionDto } from './dto/create-session.dto'
import { UpdateSessionDto } from './dto/update-session.dto'
import { ListSessionsDto } from './dto/list-sessions.dto'
import { ListMessagesDto } from './dto/list-messages.dto'
import { SendMessageDto } from './dto/send-message.dto'

/**
 * AI 会话控制器
 * 路由前缀：ai-sessions（/api/ai-sessions/*）
 * 提供有状态的 AI 对话能力：会话 CRUD + 消息游标分页 + 会话内流式对话（落库）
 * 与无状态的 /api/ai/* 代理接口互补：会话类接口由后端负责消息持久化
 * 所有接口必须登录（JWT 守卫），且只能访问自己的会话（服务层校验归属）
 */
@ApiTags('💬 AI 会话 AI-Session')
@ApiBearerAuth('bearer')
@Controller('ai-sessions')
@UseGuards(JwtAuthGuard)
export class AiSessionController {
  constructor(private readonly aiSessionService: AiSessionService) {}

  /**
   * 创建会话
   * POST /api/ai-sessions
   */
  @ApiOperation({ summary: '创建会话（当前仅支持 chat 类型）' })
  @ApiBody({ type: CreateSessionDto })
  @ApiResponse({ status: 201, description: '返回新创建的会话' })
  @Post()
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateSessionDto) {
    return this.aiSessionService.createSession(user.userId, dto)
  }

  /**
   * 会话列表（offset 分页，按最近活跃倒序，排除已删除）
   * GET /api/ai-sessions?type=chat&page=1&pageSize=20
   */
  @ApiOperation({ summary: '会话列表（分页，按最近活跃倒序）' })
  @ApiResponse({ status: 200, description: '返回 { list, total, page, pageSize }' })
  @Get()
  async list(@CurrentUser() user: JwtPayload, @Query() dto: ListSessionsDto) {
    return this.aiSessionService.listSessions(user.userId, dto)
  }

  /**
   * 查询当前用户的全部会话(chat 类型)（按最近活跃倒序，排除已软删除）
   * @param userId 当前登录用户 ID
   */
  @ApiOperation({ summary: '查询当前用户的全部会话(chat 类型)（分页，按最近活跃倒序）' })
  @ApiResponse({ status: 200, description: '返回 { list, total, page, pageSize }' })
  @Get('chat')
  async listChatSessions(@CurrentUser() user: JwtPayload) {
    return this.aiSessionService.listAllChatSessions(user.userId)
  }

  /**
   * 会话详情
   * GET /api/ai-sessions/:id
   */
  @ApiOperation({ summary: '会话详情（含面试扩展信息，若为面试会话）' })
  @Get(':id')
  async detail(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.aiSessionService.getSession(user.userId, id)
  }

  /**
   * 更新会话（重命名 / 归档恢复）
   * PATCH /api/ai-sessions/:id
   */
  @ApiOperation({ summary: '更新会话（重命名 / 归档恢复）' })
  @ApiBody({ type: UpdateSessionDto })
  @Patch(':id')
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateSessionDto,
  ) {
    return this.aiSessionService.updateSession(user.userId, id, dto)
  }

  /**
   * 删除会话（软删除）
   * DELETE /api/ai-sessions/:id
   */
  @ApiOperation({ summary: '删除会话（软删除，仅标记不物理清除）' })
  @Delete(':id')
  async remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.aiSessionService.deleteSession(user.userId, id)
  }

  /**
   * 会话消息列表（游标分页，id 倒序，最新在前）
   * GET /api/ai-sessions/:id/messages?beforeId=42&limit=30
   */
  @ApiOperation({
    summary: '会话消息列表（游标分页）',
    description:
      '按 id 倒序返回（最新在前），首次请求不传 beforeId；翻页传上一页返回的 nextCursor。hasMore=true 表示还有更早的消息。',
  })
  @Get(':id/messages')
  async messages(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Query() dto: ListMessagesDto,
  ) {
    return this.aiSessionService.listMessages(user.userId, id, dto)
  }

  /**
   * 会话内流式对话（消息自动落库）
   * POST /api/ai-sessions/:id/chat/stream
   * @returns SSE 事件流：data 为 JSON 字符串 { content? } / { done, messageId, promptTokens, completionTokens }
   */
  @ApiOperation({
    summary: '（SSE 流式）会话内对话',
    description:
      '与 /api/ai/chat/stream 的区别：本接口由后端负责消息持久化——用户消息即时落库，AI 回复流式返回并回填全文与 token 用量。前端只需传 content，无需携带历史 messages。⚠️ Swagger UI 无法实时显示 SSE 推送，请用 curl -N 或前端测试。',
  })
  @ApiBody({ type: SendMessageDto })
  @Post(':id/chat/stream')
  async chatStream(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
    @Res() res: Response,
  ): Promise<void> {
    // 先完成校验/落库/凭证解析再写 SSE 响应头：失败时直接走异常过滤器返回 JSON
    const source = await this.aiSessionService.chatInSession(user.userId, id, dto)

    // 手动设置 SSE 响应头（与 /api/ai/chat/stream 保持一致）
    setSseHeaders(res)

    const subscription = source.subscribe({
      // 把 Observable 的每次发射写成标准 SSE 帧：data: xxx\n\n
      next: (msg) => res.write(`data: ${msg.data}\n\n`),
      error: (err) => {
        const msg = err instanceof HttpException ? err.message : '生成失败，请重试'
        res.write(`data: ${JSON.stringify({ error: msg })}\n\n`)
        res.end()
      },
      complete: () => res.end(),
    })

    // 客户端断开（关页面/取消生成）时退订：中止上游请求并把已收内容标记为 failed
    res.on('close', () => {
      subscription.unsubscribe()
    })
  }
}
