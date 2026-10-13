import { BadRequestException, Injectable } from '@nestjs/common'
import { Observable } from 'rxjs'
import type { BaseMessageLike } from '@langchain/core/messages'
import type { z } from 'zod'
import type { GrammarCheckDto } from './dto/grammar-check.dto'
import type { ResumeScoreDto } from './dto/resume-score.dto'
import type { JobMatchDto } from './dto/job-match.dto'
import type { InterviewQuestionsDto } from './dto/interview-questions.dto'
import type { PdfToJsonDto } from './dto/pdf-to-json.dto'
import type { SelfIntroDto } from './dto/self-intro.dto'
import type { AiCredentials } from '../user/user-ai-config.service'
import { AiCommonService } from '../shared/ai-common.service'
import { CredentialService } from '../shared/credential.service'
import { scoreToGrade } from '@/common/utils/score.util'
import { INITIAL_GLOBAL_CONFIGURATION } from './constants/resume-defaults'
import {
  GrammarCheckSchema,
  JobMatchSchema,
  ResumeScoreSchema,
  type GrammarCheckResult,
  type JobMatchResult,
  type ResumeScoreResult,
} from './ai.schemas'
import {
  CONNECTION_TEST_SYSTEM,
  checkGrammarPrompt,
  interviewQuestionsPrompt,
  jobMatchPrompt,
  pdfToJsonPrompt,
  scoreResumePrompt,
  selfIntroPrompt,
} from '@/modules/ai/prompt/ai.prompts'

export type { GrammarCheckResult, JobMatchResult, ResumeScoreResult }

@Injectable()
export class AiService {
  constructor(
    private readonly aiCommon: AiCommonService,
    private readonly credentialService: CredentialService,
  ) {}

  /** 解析用户 AI 凭证（带偏好校验） */
  private async resolveCredentials(userId: number, providerId?: string): Promise<AiCredentials> {
    return this.credentialService.resolveCredentialsWithPreferenceCheck(userId, providerId)
  }

  /**
   * 结构化输出统一入口：jsonMode（response_format=json_object）+ Zod 校验
   * 模型坏字段/缺失字段由 schema 的 catch/default 兜底，保证返回结构完整
   */
  private async invokeStructured<S extends z.ZodObject>(
    credentials: AiCredentials,
    schema: S,
    messages: BaseMessageLike[],
  ): Promise<z.output<S>> {
    const structured = this.aiCommon
      .createChatModel(credentials)
      .withStructuredOutput(schema, { method: 'jsonMode' })
    try {
      return (await structured.invoke(messages)) as z.output<S>
    } catch (error) {
      throw new BadRequestException(this.aiCommon.formatError(error))
    }
  }

  /**
   * 测试用户 API 连接是否可用
   * 发送最小请求（maxTokens=1）验证参数正确性
   * @param userId 当前登录用户 ID
   * @param providerId 服务商唯一标识
   * @returns { success: true }
   */
  async testConnection(userId: number, providerId: string): Promise<{ success: true }> {
    // 按优先级解析凭证
    const credentials: AiCredentials = await this.credentialService.resolveCredentials(
      userId,
      providerId,
    )

    const model = this.aiCommon.createChatModel(credentials, { maxTokens: 1 })

    try {
      await model.invoke([
        { role: 'system', content: CONNECTION_TEST_SYSTEM },
        { role: 'user', content: 'ping' },
      ])
    } catch (error) {
      throw new BadRequestException(this.aiCommon.formatError(error))
    }

    return { success: true }
  }

  /**
   * AI 语法纠错（错别字、语病、标点）
   * @param userId 当前登录用户 ID
   * @param dto resumeText
   * @returns 包含语法问题列表的对象
   */
  async checkGrammar(userId: number, dto: GrammarCheckDto): Promise<GrammarCheckResult> {
    const credentials = await this.resolveCredentials(userId)

    const messages = await checkGrammarPrompt.formatMessages({ resumeText: dto.resumeText })

    return this.invokeStructured(credentials, GrammarCheckSchema, messages)
  }

  /**
   * AI 简历质量深度评分（6 维度 + 等级 + 改进建议）
   * 结果 JSON 结构严格对应前端 ResumeScoreResult
   * @param userId 当前登录用户 ID
   * @param dto resumeText
   */
  async scoreResume(userId: number, dto: ResumeScoreDto): Promise<ResumeScoreResult> {
    const credentials = await this.resolveCredentials(userId)

    const messages = await scoreResumePrompt.formatMessages({ resumeText: dto.resumeText })

    const result = await this.invokeStructured(credentials, ResumeScoreSchema, messages)
    // grade 允许模型缺省，按总分推导等级
    result.grade = result.grade || scoreToGrade(result.totalScore || 0)
    return result
  }

  /**
   * 分析简历与 JD 的匹配度，输出匹配度、技能缺口、亮点/薄弱点和改进建议
   * @param userId 当前登录用户 ID
   * @param dto resumeText + jobDescription
   */
  async analyzeJobMatch(userId: number, dto: JobMatchDto): Promise<JobMatchResult> {
    const credentials = await this.resolveCredentials(userId)

    const messages = await jobMatchPrompt.formatMessages({
      resumeText: dto.resumeText,
      jobDescription: dto.jobDescription,
    })

    return this.invokeStructured(credentials, JobMatchSchema, messages)
  }

  /**
   * 根据简历生成指定数量面试题及参考答案，输出 Markdown 格式字符串
   * @param userId 当前登录用户 ID
   * @param dto resumeContent + questionCount
   */
  async generateInterviewQuestions(
    userId: number,
    dto: InterviewQuestionsDto,
  ): Promise<{ content: string }> {
    const credentials = await this.resolveCredentials(userId)

    const messages = await interviewQuestionsPrompt.formatMessages({
      count: dto.questionCount ?? 5,
      resumeContent: dto.resumeContent,
    })

    const model = this.aiCommon.createChatModel(credentials, { maxTokens: 2000 })

    try {
      const result = await model.invoke(messages)
      return { content: result.text }
    } catch (error) {
      throw new BadRequestException(this.aiCommon.formatError(error))
    }
  }

  /** 流式 pdf 转 json */
  async pdfToJsonStream(userId: number, dto: PdfToJsonDto): Promise<Observable<{ data: string }>> {
    const credentials = await this.resolveCredentials(userId)

    const message = await pdfToJsonPrompt.formatMessages({
      globalConfiguration: JSON.stringify(INITIAL_GLOBAL_CONFIGURATION),
      pdfText: dto.pdfText,
    })

    const model = this.aiCommon
      .createChatModel(credentials)
      .withConfig({ response_format: { type: 'json_object' } })

    return this.aiCommon.sseFromStream(() => model.stream(message), {
      errorLabel: '流式PDF转JSON',
      apiKey: credentials.apiKey,
    })
  }

  /**
   * 基于简历内容流式生成自我介绍文案（对应前端 generateSelfIntro）
   * 先同步解析凭证（未配置时直接抛 400，由异常过滤器返回 JSON），再创建流
   * @param userId 当前登录用户 ID
   * @param dto resumeText + options（scene/duration/tone）
   * @returns SSE Observable
   */
  async selfIntroStream(userId: number, dto: SelfIntroDto): Promise<Observable<{ data: string }>> {
    const credentials = await this.resolveCredentials(userId)

    const { scene, duration, tone } = dto.options

    const messages = await selfIntroPrompt.formatMessages({
      scene,
      duration,
      wordCount: duration * 220, // 中文语速估算
      tone,
      resumeText: dto.resumeText,
    })

    const model = this.aiCommon.createChatModel(credentials)

    return this.aiCommon.sseFromStream(() => model.stream(messages), {
      errorLabel: '自我介绍生成',
      apiKey: credentials.apiKey,
    })
  }
}
