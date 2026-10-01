import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Response } from 'express'
import { setSseHeaders } from '@/common/utils/sse.util'
import { InterviewService } from './interview.service'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { JwtPayload } from '../../common/types/jwt-payload'
import { CreateInterviewDto } from './dto/create-interview.dto'
import { InterviewStreamDto } from './dto/interview-stream.dto'

/**
 * AI 面试控制器
 * 路由前缀：interviews（/api/interviews/*）
 * 提供面试流程全生命周期：创建 → 统一 SSE 流（开始 / 答题 / 提前结束，按状态路由）
 * 所有接口必须登录（JWT 守卫），且只能操作自己的面试会话（服务层校验归属）
 *
 * 与 /api/ai-sessions 的关系：面试会话底层复用 ai_session + ai_session_message，
 * 但业务路由独立——面试有专属的 stream 统一流程，不复用 chat 接口
 */
@ApiTags('🎯 AI 面试 AI-Interview')
@ApiBearerAuth('bearer')
@Controller('interviews')
@UseGuards(JwtAuthGuard)
export class InterviewController {
  constructor(private readonly interviewService: InterviewService) {}

  /**
   * 创建面试会话
   * POST /api/interviews
   * 双写 ai_session(type=interview) + interview_session(status=pending_questions)
   */
  @ApiOperation({ summary: '创建面试会话（状态：待开始）' })
  @ApiBody({ type: CreateInterviewDto })
  @Post()
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateInterviewDto) {
    return this.interviewService.createInterview(user.userId, dto)
  }

  /**
   * 面试统一 SSE 流（唯一写入口）
   * POST /api/interviews/:id/stream
   * 行为由 interview_session.status 决定，前端无需区分调用哪个接口：
   * - pending_questions → 开始面试：question_start → question*（流式出题）→ question_done
   * - in_progress + content → 答题：落库回答后直接流式出下一题（hasNext）/ 或进入总结
   * - in_progress + finishOnly=true → 提前结束：直接进入总结
   * - finished → error 事件
   *
   * 单题评价完全不在 SSE 流中推送：面试结束后后端静默批量评价并落库，
   * 前端在 GET 面试详情时可查看所有题目的评价结果。
   * SSE 只负责：出题 + 总结（summary_start → summary* → done）。
   */
  @ApiOperation({
    summary: '（SSE 流式）面试统一入口：开始 / 答题 / 提前结束',
    description:
      '唯一写入口，行为由面试状态自动路由：\n' +
      '① 未开始 → 动态流式出第一题（question_start → question* → question_done）；\n' +
      '② 进行中传 content → 落库回答后直接流式出下一题（追问式），轮次用尽后自动进入总结；\n' +
      '③ 进行中传 finishOnly=true → 提前结束直接进入总结。\n\n' +
      '**评价策略**：SSE 流中不推送任何评价事件。所有题目答完后，后端静默批量评价每道题（落库供详情页查询），然后生成流式总结文本。前端通过 GET 面试详情接口查看单题评价。\n\n' +
      'SSE 事件序列：出题阶段 question_start → question* → question_done；总结阶段 summary_start → summary* → done。\n\n' +
      '收到 done 事件表示面试结束，请停止再调用。',
  })
  @ApiBody({ type: InterviewStreamDto })
  @Post(':id/stream')
  async interviewStream(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: InterviewStreamDto,
    @Res() res: Response,
  ): Promise<void> {
    const source = this.interviewService.interviewStream(user.userId, id, dto)

    setSseHeaders(res)

    const subscription = source.subscribe({
      next: (msg) => res.write(`data: ${msg.data}\n\n`),
      error: () => {
        // 服务层已通过 error 事件推送错误详情并 complete，此处兜底关闭
        res.end()
      },
      complete: () => res.end(),
    })

    res.on('close', () => subscription.unsubscribe())
  }

  /**
   * 面试列表（offset 分页，按最近活跃倒序）
   * GET /api/interviews?page=1&pageSize=20
   */
  @ApiOperation({ summary: '面试列表（分页，按最近活跃倒序）' })
  @Get()
  async list(
    @CurrentUser() user: JwtPayload,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.interviewService.listInterviews(
      user.userId,
      Number(page ?? 1),
      Number(pageSize ?? 20),
    )
  }

  /**
   * 面试详情（含所有消息 + 评分 + 总结）
   * GET /api/interviews/:id
   */
  @ApiOperation({ summary: '面试详情（含所有题目/回答/评价 + 总结评分）' })
  @Get(':id')
  async detail(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.interviewService.getInterview(user.userId, id)
  }

  /**
   * 软删除面试
   * DELETE /api/interviews/:id
   */
  @ApiOperation({ summary: '删除面试（软删除）' })
  @Delete(':id')
  async remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.interviewService.deleteInterview(user.userId, id)
  }
}
