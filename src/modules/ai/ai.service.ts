import { BadRequestException, Injectable } from '@nestjs/common'
import { Observable } from 'rxjs'
import OpenAI from 'openai'
import type { GrammarCheckDto } from './dto/grammar-check.dto'
import type { ResumeScoreDto } from './dto/resume-score.dto'
import type { JobMatchDto } from './dto/job-match.dto'
import type { InterviewQuestionsDto } from './dto/interview-questions.dto'
import type { PdfToJsonDto } from './dto/pdf-to-json.dto'
import type { ChatStreamDto } from './dto/chat-stream.dto'
import type { SelfIntroDto } from './dto/self-intro.dto'
import type { AiCredentials } from '../user/user-ai-config.service'
import { AiCommonService } from '../shared/ai-common.service'
import { CredentialService } from '../shared/credential.service'
import { generateShortId } from '@/common/utils/short-id.util'
import { scoreToGrade } from '@/common/utils/score.util'
import {
  DEFAULT_MENU_SECTIONS,
  DEFAULT_PHOTO_CONFIG,
  DEFAULT_TEMPLATE_ID,
  DEFAULT_TITLE_PREFIX,
  INITIAL_GLOBAL_CONFIGURATION,
} from './constants/resume-defaults'

export type GrammarSeverity = 'error' | 'warning'
export interface GrammarIssue {
  section: string
  original: string
  suggestion: string
  reason: string
  severity: GrammarSeverity
}

export interface GrammarCheckResult {
  issues: GrammarIssue[]
}

export interface ResumeScoreDimension {
  name: string
  score: number
  comment: string
}
export interface ResumeScoreResult {
  totalScore: number
  grade: 'S' | 'A' | 'B' | 'C' | 'D'
  dimensions: ResumeScoreDimension[]
  overallComment: string
  top3Issues: string[]
  top3Highlights: string[]
}

export interface JobMatchPoint {
  section: string
  point: string
}
export interface JobMatchResult {
  matchScore: number
  matchedSkills: string[]
  missingSkills: string[]
  highlights: JobMatchPoint[]
  weaknesses: JobMatchPoint[]
  suggestions: string[]
}

/** SSE 推送的事件格式（每次 event-stream 的 data 字段） */
export interface SseEventPayload {
  content?: string
  done?: boolean
}
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
   * 通用：调用 OpenAI 非流式接口并做统一错误处理
   * @param openai 已创建的 OpenAI 客户端
   * @param params chat.completions.create 非流式参数（不含 stream）
   * @param errorLabel 错误日志标签，如 '语法检查'
   * @param apiKey 用于日志掩码的明文 key
   * @param postProcess 对模型返回 content 的后处理函数
   */
  private async callCompletion<T = string>(
    openai: OpenAI,
    params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
    errorLabel: string,
    apiKey: string,
    postProcess?: (content: string) => T,
  ): Promise<T> {
    try {
      const completion = await openai.chat.completions.create({ ...params, stream: false })
      const content = completion.choices[0]?.message?.content || ''
      return postProcess ? postProcess(content) : (content as unknown as T)
    } catch (error) {
      console.error('[AI] %s失败（key=%s）', errorLabel, this.aiCommon.maskKey(apiKey))
      throw new BadRequestException(this.aiCommon.formatError(error))
    }
  }

  /**
   * 通用：创建流式 Observable，封装 SSE 推送的完整生命周期
   * 自动处理 for-await 遍历、content 增量推送、done 结束信号、错误捕获
   * @param openai 已创建的 OpenAI 客户端
   * @param params chat.completions.create 参数（不含 stream，会自动加 true）
   * @param errorLabel 错误日志标签，如 '流式对话'
   * @param apiKey 用于日志掩码的明文 key
   */
  private createStreamObservable(
    openai: OpenAI,
    params: Omit<OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming, 'stream'>,
    errorLabel: string,
    apiKey: string,
  ): Observable<{ data: string }> {
    return new Observable((subscriber) => {
      ;(async () => {
        try {
          const stream = await openai.chat.completions.create({ ...params, stream: true })

          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content || ''
            if (delta) {
              subscriber.next({
                data: JSON.stringify({ content: delta } as SseEventPayload),
              })
            }
          }

          // 推送结束信号
          subscriber.next({
            data: JSON.stringify({ done: true } as SseEventPayload),
          })
          subscriber.complete()
        } catch (error) {
          console.error('[AI] %s失败（key=%s）', errorLabel, this.aiCommon.maskKey(apiKey))
          subscriber.error(new BadRequestException(this.aiCommon.formatError(error)))
        }
      })()

      return () => {}
    })
  }

  /**
   * 构造 pdfToJson 的提示词（非流式和流式共用）
   * @param pdfText PDF 提取的纯文本
   */
  private buildPdfToJsonPrompt(pdfText: string): string {
    return `请将以下简历内容解析为JSON格式，包含以下字段：
    - templateId:'classic'
    - createdAt: 此时此刻的时间Date.now()格式,
    - updatedAt: null,
    - basic: { name, phone, email, address, position, photo ,photoConfig:{aspectRatio: string
      width: number
      height: number
      visible: false
      borderRadius: number
      customBorderRadius: number} }
    - educations: [{id, school, major, degree, dateRange, description,visible:true }]
    - internships: [{id, companyName, position, dateRange, description,visible:true }]
    - projects: [{id, name, role, gitAddress, dateRange, description,visible:true }]
    - skills: string
    id暂时先不给
    整体JSON格式参考：字段与 Resume 类型完全一致。
    globalConfiguration 使用：${JSON.stringify(INITIAL_GLOBAL_CONFIGURATION)}
    简历内容：
    ${pdfText}`
  }

  /**
   * 测试用户 API 连接是否可用
   * 发送最小请求（max_tokens=1）验证参数正确性
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

    const openai = this.aiCommon.createOpenAIClient(credentials)

    try {
      await openai.chat.completions.create({
        model: credentials.modelId,
        messages: [
          {
            role: 'system',
            content: '你正在进行连接测试，请忽略此内容。只需回复一个字',
          },
          { role: 'user', content: 'ping' },
        ],
        max_tokens: 1,
      })
    } catch (error) {
      console.error('[AI] 测试连接失败（key=%s）', this.aiCommon.maskKey(credentials.apiKey))
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
    const openai = this.aiCommon.createOpenAIClient(credentials)

    const systemPrompt = `你是专业的中文文案校对专家。请检查简历文本中的：错别字、语病、标点错误、中英文混用问题、冗余表达。

严格输出以下 JSON 格式（不要输出任何其他内容）：
{
  "issues": [
    {
      "section": "项目经历-XX项目",
      "original": "原句片段",
      "suggestion": "修改后的句子",
      "reason": "错别字：'在'应为'再'",
      "severity": "error"
    }
  ]
}

要求：
1. 如果没有任何问题，返回 {"issues": []}
2. severity 只能是 "error"（错别字、语病）或 "warning"（标点、冗余）
3. original 必须是简历中真实存在的原文片段
4. reason 要简短说明问题原因`

    return this.callCompletion<GrammarCheckResult>(
      openai,
      {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: dto.resumeText },
        ],
        model: credentials.modelId,
        response_format: { type: 'json_object' },
      },
      '语法检查',
      credentials.apiKey,
      (content) => {
        const parsed = JSON.parse(content || '{"issues":[]}') as { issues?: unknown }
        const issues = Array.isArray(parsed.issues) ? (parsed.issues as GrammarIssue[]) : []
        return { issues }
      },
    )
  }

  /**
   * AI 简历质量深度评分（6 维度 + 等级 + 改进建议）
   * 结果 JSON 结构严格对应前端 ResumeScoreResult
   * @param userId 当前登录用户 ID
   * @param dto resumeText
   */
  async scoreResume(userId: number, dto: ResumeScoreDto): Promise<ResumeScoreResult> {
    const credentials = await this.resolveCredentials(userId)
    const openai = this.aiCommon.createOpenAIClient(credentials)

    const systemPrompt = `你是资深 HR 简历审核官，请从以下 6 个维度给简历打分（每项 0-100）：
1. 内容详实度：是否有量化数据、具体成果、明确职责
2. 结构清晰度：模块顺序、逻辑、排版是否合理易读
3. 技能匹配度：技能描述是否准确、分类是否清晰、是否体现竞争力
4. 项目深度：项目描述是否体现技术难点、个人贡献、业务价值
5. 语言表达：是否简洁、专业、无冗余无语病
6. 差异化亮点：是否有脱颖而出的经历、成就或特色

严格输出以下 JSON 格式（不要输出任何其他内容）：
{
  "totalScore": 78,
  "dimensions": [
    { "name": "内容详实度", "score": 80, "comment": "..." },
    { "name": "结构清晰度", "score": 70, "comment": "..." },
    { "name": "技能匹配度", "score": 85, "comment": "..." },
    { "name": "项目深度", "score": 75, "comment": "..." },
    { "name": "语言表达", "score": 82, "comment": "..." },
    { "name": "差异化亮点", "score": 72, "comment": "..." }
  ],
  "overallComment": "总体评价，100-200字，用口语化但专业的语气。",
  "top3Issues": ["改进1", "改进2", "改进3"],
  "top3Highlights": ["亮点1", "亮点2", "亮点3"]
}`

    return this.callCompletion<ResumeScoreResult>(
      openai,
      {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: dto.resumeText },
        ],
        model: credentials.modelId,
        response_format: { type: 'json_object' },
      },
      '简历评分',
      credentials.apiKey,
      (content) => {
        const parsed = JSON.parse(content || '{}') as ResumeScoreResult
        parsed.grade = parsed.grade || scoreToGrade(parsed.totalScore || 0)
        parsed.dimensions = parsed.dimensions || []
        parsed.overallComment = parsed.overallComment || ''
        parsed.top3Issues = parsed.top3Issues || []
        parsed.top3Highlights = parsed.top3Highlights || []
        return parsed
      },
    )
  }

  /**
   * 分析简历与 JD 的匹配度，输出匹配度、技能缺口、亮点/薄弱点和改进建议
   * @param userId 当前登录用户 ID
   * @param dto resumeText + jobDescription
   */
  async analyzeJobMatch(userId: number, dto: JobMatchDto): Promise<JobMatchResult> {
    const credentials = await this.resolveCredentials(userId)
    const openai = this.aiCommon.createOpenAIClient(credentials)

    const systemPrompt = `你是一位资深技术招聘官，需要评估候选人简历与岗位描述（JD）的匹配度。

请严格按以下 JSON 格式输出（不要输出任何其他内容）：
{
  "matchScore": 78,
  "matchedSkills": ["React", "TypeScript"],
  "missingSkills": ["Webpack", "Node.js"],
  "highlights": [
    { "section": "项目经历", "point": "有完整的从0到1项目落地经验" }
  ],
  "weaknesses": [
    { "section": "技能", "point": "缺少岗位要求的后端经验" }
  ],
  "suggestions": [
    "建议在项目描述中补充性能优化数据",
    "建议增加一个体现团队协作的经历"
  ]
}

评估要求：
1. matchScore 为 0-100 的整数，综合反映匹配程度
2. matchedSkills / missingSkills 只放技能关键词，不要长句
3. highlights / weaknesses 的 section 要对应简历模块名
4. suggestions 要具体可执行，3-5 条

简历内容：
${dto.resumeText}`

    return this.callCompletion<JobMatchResult>(
      openai,
      {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `岗位描述（JD）：\n${dto.jobDescription}` },
        ],
        model: credentials.modelId,
        response_format: { type: 'json_object' },
      },
      '岗位匹配分析',
      credentials.apiKey,
      (content) => {
        const parsed = JSON.parse(content || '{}') as JobMatchResult
        parsed.matchedSkills = parsed.matchedSkills || []
        parsed.missingSkills = parsed.missingSkills || []
        parsed.highlights = parsed.highlights || []
        parsed.weaknesses = parsed.weaknesses || []
        parsed.suggestions = parsed.suggestions || []
        return parsed
      },
    )
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
    const openai = this.aiCommon.createOpenAIClient(credentials)

    const count = dto.questionCount ?? 5

    const systemPrompt = `你是一个专业的技术面试官，擅长根据候选人的简历提出针对性的面试问题。
请根据提供的简历内容，生成${count}个高质量的面试问题，涵盖以下方面：
1. 技术能力和技能验证
2. 项目经验和深度
3. 解决问题的能力

每个问题后请提供一个参考回答，用"回答："开头。
输出格式要求：
Q1: [问题1]
回答：[参考回答1]

Q2: [问题2]
回答：[参考回答2]

...以此类推`

    return this.callCompletion<{ content: string }>(
      openai,
      {
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: `根据以下简历生成面试问题：\n\n${dto.resumeContent}`,
          },
        ],
        model: credentials.modelId,
        max_tokens: 2000,
      },
      '生成面试问题',
      credentials.apiKey,
      (content) => ({ content }),
    )
  }

  /**
   * 根据 PDF 纯文本让 AI 生成完整 Resume 结构
   * 返回结构与前端 Resume 类型完全一致（缺少字段用常量兜底）
   * @param userId 当前登录用户 ID
   * @param dto pdfText
   */
  async pdfToJson(userId: number, dto: PdfToJsonDto): Promise<Record<string, any>> {
    const credentials = await this.resolveCredentials(userId)
    const openai = this.aiCommon.createOpenAIClient(credentials)

    const prompt = this.buildPdfToJsonPrompt(dto.pdfText)

    return this.callCompletion<Record<string, any>>(
      openai,
      {
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: dto.pdfText },
        ],
        model: credentials.modelId,
        response_format: { type: 'json_object' },
      },
      'PDF 转 JSON',
      credentials.apiKey,
      (content) => {
        const parsed = JSON.parse(content || '{}') as Record<string, any>
        // 同前端 pdfToJsonWithAI 后处理逻辑
        const id = generateShortId()
        parsed.id = id
        parsed.title = parsed.title ?? `${DEFAULT_TITLE_PREFIX}${id}`
        parsed.templateId = parsed.templateId || DEFAULT_TEMPLATE_ID
        parsed.globalConfiguration = parsed.globalConfiguration || INITIAL_GLOBAL_CONFIGURATION
        parsed.menuSections = parsed.menuSections || DEFAULT_MENU_SECTIONS
        parsed.customData = parsed.customData || {}
        if (parsed.basic) {
          parsed.basic.photo = parsed.basic.photo || ''
          parsed.basic.photoConfig = parsed.basic.photoConfig || DEFAULT_PHOTO_CONFIG
        }
        parsed.createdAt = Date.now()
        parsed.updatedAt = null
        return parsed
      },
    )
  }

  /**
   * 流式 pdf 转 json（修复了之前缺失 stream:true 的 bug）
   */
  async pdfToJsonStream(userId: number, dto: PdfToJsonDto): Promise<Observable<{ data: string }>> {
    const credentials = await this.resolveCredentials(userId)
    const openai = this.aiCommon.createOpenAIClient(credentials)

    const prompt = this.buildPdfToJsonPrompt(dto.pdfText)

    return this.createStreamObservable(
      openai,
      {
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: dto.pdfText },
        ],
        model: credentials.modelId,
        response_format: { type: 'json_object' },
      },
      '流式PDF转JSON',
      credentials.apiKey,
    )
  }

  /**
   * 流式调用 LLM，逐字通过 SSE 返回内容（对应前端 chatWithStream）
   * 先同步解析凭证（未配置时直接抛 400，由异常过滤器返回 JSON），再创建流
   * @param userId 当前登录用户 ID
   * @param dto messages 数组
   * @returns NestJS SSE 要求的 Observable<{ data: string }>，每次 data 为 JSON 字符串
   */
  async chatStream(userId: number, dto: ChatStreamDto): Promise<Observable<{ data: string }>> {
    const credentials = await this.resolveCredentials(userId)
    const openai = this.aiCommon.createOpenAIClient(credentials)

    return this.createStreamObservable(
      openai,
      {
        messages: dto.messages.map((m) => ({
          role: m.role as 'system' | 'user' | 'assistant',
          content: m.content,
        })),
        model: credentials.modelId,
      },
      '流式对话',
      credentials.apiKey,
    )
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
    const openai = this.aiCommon.createOpenAIClient(credentials)

    const { scene, duration, tone } = dto.options
    const wordCount = duration * 220 // 中文语速估算

    const systemPrompt = `你是一位帮助求职者撰写自我介绍的专家。请根据简历生成一段自我介绍。

要求：
- 场景：${scene}
- 时长：${duration} 分钟（约 ${wordCount} 字）
- 语气：${tone}
- 结构：开场问候 → 个人亮点 → 核心项目/经历（用 STAR 法则） → 技能匹配岗位 → 结尾期待
- 用第一人称，口语化但专业，可以直接念出来
- 用 Markdown 输出，段落间用空行分隔，重点加粗
- 不要输出标题（如"自我介绍"），直接从问候语开始

简历内容：
${dto.resumeText}`

    return this.createStreamObservable(
      openai,
      {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: '请生成自我介绍' },
        ],
        model: credentials.modelId,
      },
      '自我介绍生成',
      credentials.apiKey,
    )
  }
}
