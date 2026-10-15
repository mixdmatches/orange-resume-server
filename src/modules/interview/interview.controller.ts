import { Body, Controller, Delete, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Response } from 'express'
import { setSseHeaders } from '@/common/utils/sse.util'
import { InterviewService } from './interview.service'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { JwtPayload } from '../../common/types/jwt-payload'
import { CreateInterviewDto } from './dto/create-interview.dto'
import { InterviewStreamDto } from './dto/interview-stream.dto'

@ApiTags('🎯 AI 面试 AI-Interview')
@ApiBearerAuth('bearer')
@Controller('interviews')
@UseGuards(JwtAuthGuard)
export class InterviewController {
  constructor(private readonly interviewService: InterviewService) {}

  /**
   * 创建面试会话
   * POST /api/interviews
   */
  @ApiOperation({ summary: '创建面试会话（状态：待开始）' })
  @ApiBody({ type: CreateInterviewDto })
  @Post()
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateInterviewDto) {
    return this.interviewService.createInterview(user.userId, dto)
  }

  /**
   * 面试统一 SSE 流（唯一写入口）
   */
  @ApiOperation({
    summary: '（SSE 流式）面试统一入口：开始 / 答题 / 提前结束',
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
    @Query('page') page: string,
    @Query('pageSize') pageSize: string,
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
