import {
  Body,
  Controller,
  Header,
  Headers,
  HttpException,
  Post,
  Res,
  Sse,
  UseGuards,
} from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiBody,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'
import type { Response } from 'express'
import { Observable } from 'rxjs'
import { AiService } from './ai.service'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { GrammarCheckDto } from './dto/grammar-check.dto'
import { ResumeScoreDto } from './dto/resume-score.dto'
import { JobMatchDto } from './dto/job-match.dto'
import { InterviewQuestionsDto } from './dto/interview-questions.dto'
import { PdfToJsonDto } from './dto/pdf-to-json.dto'
import { ChatStreamDto } from './dto/chat-stream.dto'
import { SelfIntroDto } from './dto/self-intro.dto'

/**
 * 自定义请求头 Key（小写形式，NestJS Headers 会把 HTTP Header Key 转成小写）
 */
const HEADER_API_KEY = 'x-user-api-key'
const HEADER_BASE_URL = 'x-user-base-url'
const HEADER_MODEL_ID = 'x-user-model-id'

/**
 * AI 代理控制器
 * 路由前缀：ai（/api/ai/*）
 * 所有接口必须登录（JWT 守卫），防止未登录用户滥用
 * 非流式接口：返回普通 JSON（经 TransformInterceptor 包裹为统一格式）
 * 流式接口：@Sse() 返回 Observable<{data:string}>，每次 data 是 JSON 字符串，客户端逐字拼接
 */
@ApiTags('🤖 AI 代理 AI-Proxy')
@ApiBearerAuth('bearer')
// 为整个控制器声明 AI 自定义 Header：Swagger UI 每个接口都会显示这 3 个输入框
@ApiHeader({
  name: 'X-User-Api-Key',
  required: true,
  description: '【必填】用户个人的大模型 API Key（服务器临时使用，不存储）',
})
@ApiHeader({
  name: 'X-User-Base-Url',
  required: false,
  description:
    '【选填】兼容 OpenAI 协议的 baseURL（例如兼容 DeepSeek / 硅基流动 / 本地 Ollama 网关）。留空默认 https://api.openai.com/v1',
})
@ApiHeader({
  name: 'X-User-Model-Id',
  required: false,
  description: '【选填】模型 ID（例如 gpt-4o-mini / deepseek-chat）。留空默认 gpt-3.5-turbo',
})
@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  // =====================================================================
  // JSON 类接口
  // =====================================================================

  /**
   * 测试用户 AI 连接
   * POST /api/ai/test-connection
   */
  @ApiOperation({
    summary: '测试 AI 连接（配置页面 Ping）',
    description:
      "用户在前端 AI 设置页填完 Key + BaseUrl + Model 后点「测试」时调用。给模型发送 'ping'，max_tokens=1；能正常返回即说明 Key/BaseUrl/网络都通。不会消耗太多 Token。",
  })
  @ApiResponse({ status: 200, description: 'code=0，data = { success: true }' })
  @ApiResponse({
    status: 200,
    description:
      '连接失败，code!=0，message 会透传上游真实错误消息（Key 错误/模型不存在/网络超时 等）',
  })
  @Post('test-connection')
  async testConnection(@Headers() headers: Record<string, string>) {
    return this.aiService.testConnection(
      headers[HEADER_API_KEY],
      headers[HEADER_BASE_URL],
      headers[HEADER_MODEL_ID],
    )
  }

  /**
   * 简历语法检查
   * POST /api/ai/grammar-check
   */
  @ApiOperation({
    summary: '简历语法检查',
    description:
      "输入简历纯文本（前端将各 section 拼好后传入），返回 { issues: [...] }：每项含 { section, original, suggestion, reason, severity('error'|'warning') }。",
  })
  @ApiBody({ type: GrammarCheckDto })
  @Post('grammar-check')
  async grammarCheck(@Headers() headers: Record<string, string>, @Body() dto: GrammarCheckDto) {
    return this.aiService.checkGrammar(
      dto,
      headers[HEADER_API_KEY],
      headers[HEADER_BASE_URL],
      headers[HEADER_MODEL_ID],
    )
  }

  /**
   * 简历质量评分
   * POST /api/ai/resume-score
   */
  @ApiOperation({
    summary: '简历质量评分（整体 + 分维度）',
    description:
      '输出：{ overallScore: 0-100, dimensions: [{name,score,comment}], strengths: string[], improvements: string[], overallComment: string }。可用于简历详情页右侧「AI 体检」面板。',
  })
  @ApiBody({ type: ResumeScoreDto })
  @Post('resume-score')
  async resumeScore(@Headers() headers: Record<string, string>, @Body() dto: ResumeScoreDto) {
    return this.aiService.scoreResume(
      dto,
      headers[HEADER_API_KEY],
      headers[HEADER_BASE_URL],
      headers[HEADER_MODEL_ID],
    )
  }

  /**
   * 简历 & JD 匹配度分析
   * POST /api/ai/job-match
   */
  @ApiOperation({
    summary: '简历 vs 岗位 JD 匹配度分析',
    description:
      '输出：{ matchScore: 0-100, matchedSkills: string[], missingSkills: string[], suggestions: string[] }。JD 越长越准确，建议用户直接粘贴招聘网页原文。',
  })
  @ApiBody({ type: JobMatchDto })
  @Post('job-match')
  async jobMatch(@Headers() headers: Record<string, string>, @Body() dto: JobMatchDto) {
    return this.aiService.analyzeJobMatch(
      dto,
      headers[HEADER_API_KEY],
      headers[HEADER_BASE_URL],
      headers[HEADER_MODEL_ID],
    )
  }

  /**
   * 生成面试问题及参考答案
   * POST /api/ai/interview-questions
   */
  @ApiOperation({
    summary: '生成面试问题 + 参考答案',
    description:
      "基于目标岗位 + 用户简历，生成若干面试题目。输出：{ questions: [{ id, question, category, difficulty('easy'|'medium'|'hard'), suggestedAnswer, keyPoints: string[] }] }。可用于「面试模拟」功能。",
  })
  @ApiBody({ type: InterviewQuestionsDto })
  @Post('interview-questions')
  async interviewQuestions(
    @Headers() headers: Record<string, string>,
    @Body() dto: InterviewQuestionsDto,
  ) {
    return this.aiService.generateInterviewQuestions(
      dto,
      headers[HEADER_API_KEY],
      headers[HEADER_BASE_URL],
      headers[HEADER_MODEL_ID],
    )
  }

  /**
   * PDF 文本 → 结构化 Resume JSON
   * POST /api/ai/pdf-to-json
   */
  @ApiOperation({
    summary: 'PDF 文本 → 结构化 Resume JSON（AI 识别）',
    description:
      '前端把 PDF 本地解析成纯文本后传入，AI 输出与前端 Resume 接口类型完全对齐的 JSON，可直接用于一键导入简历。MVP 阶段 PDF 文件解析在前端完成（可用 pdfjs-dist）。',
  })
  @ApiBody({ type: PdfToJsonDto })
  @Post('pdf-to-json')
  async pdfToJson(@Headers() headers: Record<string, string>, @Body() dto: PdfToJsonDto) {
    return this.aiService.pdfToJson(
      dto,
      headers[HEADER_API_KEY],
      headers[HEADER_BASE_URL],
      headers[HEADER_MODEL_ID],
    )
  }

  // =====================================================================
  // SSE 流式接口
  // 注意：以下接口返回 Observable，TransformInterceptor 会通过路径跳过 JSON 包裹
  // 必须显式设置 text/event-stream 和 no-cache
  // 注：NestJS @Sse 可同时支持 POST/GET；这里使用 POST 以便携带 body（对话消息/简历参数）
  // =====================================================================

  /**
   * 智能助手流式对话
   * POST /api/ai/chat/stream
   * @returns SSE 事件流，每次 data 是字符串化的 `{ content?: string; done?: boolean }`
   */
  @ApiOperation({
    summary: '（SSE 流式）AI 智能助手对话',
    description:
      '流式对话接口，类似 ChatGPT 打字机效果。⚠️ Swagger UI 本身无法实时显示 SSE 推送（会等全部结束才显示），建议用 curl -N 或前端 EventSource/axios 测试。每个事件 data: JSON.stringify({ content: "..." })；最后一个事件带 done: true 表示结束。',
  })
  @ApiBody({
    type: ChatStreamDto,
    description: '对话上下文 messages 数组（按 system/user/assistant 排序）',
  })
  @Post('chat/stream')
  @Header('Content-Type', 'text/event-stream')
  @Header('Cache-Control', 'no-cache')
  @Header('Connection', 'keep-alive')
  chatStream(
    @Headers() headers: Record<string, string>,
    @Body() dto: ChatStreamDto,
    @Res() res: Response,
  ): void {
    // 手动设置 SSE 响应头（@Post 不像 @Sse 会自动处理）
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no') // 防 Nginx 反代缓冲
    res.flushHeaders()

    const subscription = this.aiService
      .chatStream(dto, headers[HEADER_API_KEY], headers[HEADER_BASE_URL], headers[HEADER_MODEL_ID])
      .subscribe({
        // 把 Observable 的每次发射写成标准 SSE 帧：data: xxx\n\n
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
   * 自我介绍生成流式
   * POST /api/ai/self-intro/stream
   * @returns SSE 事件流，data 结构同 chatStream
   */
  @ApiOperation({
    summary: '（SSE 流式）一键生成自我介绍',
    description:
      '根据目标岗位 + 简历内容，流式生成一段 1-3 分钟的自我介绍话术。⚠️ Swagger UI 不适合预览 SSE 效果，请用 curl -N 或前端页面测试。',
  })
  @ApiBody({ type: SelfIntroDto })
  @Post('self-intro/stream')
  selfIntroStream(
    @Headers() headers: Record<string, string>,
    @Body() dto: SelfIntroDto,
    @Res() res: Response,
  ): void {
    // 手动设置 SSE 响应头（@Post 不像 @Sse 会自动处理）
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no') // 防 Nginx 反代缓冲
    res.flushHeaders()

    const subscription = this.aiService
      .selfIntroStream(
        dto,
        headers[HEADER_API_KEY],
        headers[HEADER_BASE_URL],
        headers[HEADER_MODEL_ID],
      )
      .subscribe({
        // 把 Observable 的每次发射写成标准 SSE 帧：data: xxx\n\n
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
}
