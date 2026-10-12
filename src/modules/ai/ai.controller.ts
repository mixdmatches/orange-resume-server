import { Body, Controller, HttpException, Post, Res, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import type { Response } from 'express'
import { Observable } from 'rxjs'
import { AiService } from './ai.service'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { JwtPayload } from '../../common/types/jwt-payload'
import { setSseHeaders } from '@/common/utils/sse.util'
import { GrammarCheckDto } from './dto/grammar-check.dto'
import { ResumeScoreDto } from './dto/resume-score.dto'
import { JobMatchDto } from './dto/job-match.dto'
import { InterviewQuestionsDto } from './dto/interview-questions.dto'
import { PdfToJsonDto } from './dto/pdf-to-json.dto'
import { ChatStreamDto } from './dto/chat-stream.dto'
import { SelfIntroDto } from './dto/self-intro.dto'
import { TestConnectionDto } from './dto/test-connection.dto'

/**
 * AI 代理控制器
 */
@ApiTags('🤖 AI 代理 AI-Proxy')
@ApiBearerAuth('bearer')
@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  /**
   * 通用：将 Observable 流式源转发为标准 SSE 响应
   * 统一处理 SSE 头、订阅转发、错误兜底、客户端断开清理
   * @param source AiService 返回的流式 Observable
   * @param res Express Response 对象
   */
  private handleSseObservable(source: Observable<{ data: string }>, res: Response): void {
    setSseHeaders(res)

    const subscription = source.subscribe({
      next: (msg) => res.write(`data: ${msg.data}\n\n`),
      error: (err) => {
        const msg = err instanceof HttpException ? err.message : '生成失败，请重试'
        res.write(`data: ${JSON.stringify({ error: msg })}\n\n`)
        res.end()
      },
      complete: () => res.end(),
    })

    // 客户端断开（关页面/取消生成）时退订上游，避免资源泄漏
    res.on('close', () => {
      subscription.unsubscribe()
    })
  }

  /**
   * 测试用户 AI 连接
   * POST /api/ai/test-connection
   */
  @ApiOperation({
    summary: '测试 AI 连接（配置页面 Ping）',
  })
  @ApiResponse({ status: 200, description: 'code=0，data = { success: true }' })
  @ApiBody({ type: TestConnectionDto, required: false })
  @Post('test-connection')
  async testConnection(@CurrentUser() user: JwtPayload, @Body() dto: TestConnectionDto) {
    return this.aiService.testConnection(user.userId, dto.providerId)
  }

  /**
   * 简历语法检查
   * POST /api/ai/grammar-check
   */
  @ApiOperation({
    summary: '简历语法检查',
  })
  @ApiBody({ type: GrammarCheckDto })
  @Post('grammar-check')
  async grammarCheck(@CurrentUser() user: JwtPayload, @Body() dto: GrammarCheckDto) {
    return this.aiService.checkGrammar(user.userId, dto)
  }

  /**
   * 简历质量评分
   * POST /api/ai/resume-score
   */
  @ApiOperation({
    summary: '简历质量评分（整体 + 分维度）',
  })
  @ApiBody({ type: ResumeScoreDto })
  @Post('resume-score')
  async resumeScore(@CurrentUser() user: JwtPayload, @Body() dto: ResumeScoreDto) {
    return this.aiService.scoreResume(user.userId, dto)
  }

  /**
   * 简历 & JD 匹配度分析
   * POST /api/ai/job-match
   */
  @ApiOperation({
    summary: '简历 vs 岗位 JD 匹配度分析',
  })
  @ApiBody({ type: JobMatchDto })
  @Post('job-match')
  async jobMatch(@CurrentUser() user: JwtPayload, @Body() dto: JobMatchDto) {
    return this.aiService.analyzeJobMatch(user.userId, dto)
  }

  /**
   * 生成面试问题及参考答案
   * POST /api/ai/interview-questions
   */
  @ApiOperation({
    summary: '生成面试问题 + 参考答案',
  })
  @ApiBody({ type: InterviewQuestionsDto })
  @Post('interview-questions')
  async interviewQuestions(@CurrentUser() user: JwtPayload, @Body() dto: InterviewQuestionsDto) {
    return this.aiService.generateInterviewQuestions(user.userId, dto)
  }

  /**
   * PDF 文本 → 结构化 Resume JSON
   * POST /api/ai/pdf-to-json
   */
  @ApiOperation({
    summary: 'PDF 文本 → 结构化 Resume JSON（AI 识别）',
  })
  @ApiBody({ type: PdfToJsonDto })
  @Post('pdf-to-json')
  async pdfToJson(@CurrentUser() user: JwtPayload, @Body() dto: PdfToJsonDto) {
    return this.aiService.pdfToJson(user.userId, dto)
  }

  @Post('pdf-to-json/stream')
  async pdfToJsonStream(
    @CurrentUser() user: JwtPayload,
    @Body() dto: PdfToJsonDto,
    @Res() res: Response,
  ): Promise<void> {
    const source = await this.aiService.pdfToJsonStream(user.userId, dto)
    this.handleSseObservable(source, res)
  }

  /**
   * 智能助手流式对话
   * POST /api/ai/chat/stream
   * @returns SSE 事件流，每次 data 是字符串化的 `{ content?: string; done?: boolean }`
   */
  @ApiOperation({
    summary: '（SSE 流式）AI 智能助手对话',
  })
  @ApiBody({
    type: ChatStreamDto,
    description: '对话上下文 messages 数组（按 system/user/assistant 排序）',
  })
  @Post('chat/stream')
  async chatStream(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ChatStreamDto,
    @Res() res: Response,
  ): Promise<void> {
    const source = await this.aiService.chatStream(user.userId, dto)
    this.handleSseObservable(source, res)
  }

  /**
   * 自我介绍生成流式
   * POST /api/ai/self-intro/stream
   * @returns SSE 事件流，data 结构同 chatStream
   */
  @ApiOperation({
    summary: '（SSE 流式）一键生成自我介绍',
  })
  @ApiBody({ type: SelfIntroDto })
  @Post('self-intro/stream')
  async selfIntroStream(
    @CurrentUser() user: JwtPayload,
    @Body() dto: SelfIntroDto,
    @Res() res: Response,
  ): Promise<void> {
    const source = await this.aiService.selfIntroStream(user.userId, dto)
    this.handleSseObservable(source, res)
  }
}
