import { BadRequestException, Injectable } from '@nestjs/common'
import { Observable } from 'rxjs'
import OpenAI from 'openai'
import * as crypto from 'node:crypto'
import type { GrammarCheckDto } from './dto/grammar-check.dto'
import type { ResumeScoreDto } from './dto/resume-score.dto'
import type { JobMatchDto } from './dto/job-match.dto'
import type { InterviewQuestionsDto } from './dto/interview-questions.dto'
import type { PdfToJsonDto } from './dto/pdf-to-json.dto'
import type { ChatStreamDto } from './dto/chat-stream.dto'
import type { SelfIntroDto } from './dto/self-intro.dto'
import {
  DEFAULT_MENU_SECTIONS,
  DEFAULT_PHOTO_CONFIG,
  DEFAULT_TEMPLATE_ID,
  DEFAULT_TITLE_PREFIX,
  INITIAL_GLOBAL_CONFIGURATION,
} from './constants/resume-defaults'

// ==========================================================================
// 前端 aiAPIConnect.ts 中定义的返回类型（后端原样返回给前端，保证类型一致）
// ==========================================================================

export type GrammarSeverity = 'error' | 'warning'
export interface GrammarIssue {
  section: string
  original: string
  suggestion: string
  reason: string
  severity: GrammarSeverity
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

/**
 * AI 代理服务层
 *
 * 核心职责：
 * 1. 接收前端在请求头中透传的用户个人 API Key / Base URL / Model ID
 * 2. 每次请求动态创建 OpenAI 客户端实例（绝不保存 Key）
 * 3. 严格按前端 src/utils/aiAPIConnect.ts 的提示词调用模型，保证结果一致
 * 4. 流式接口使用 rxjs Observable 对接 NestJS 的 @Sse() 装饰器
 *
 * 安全性：
 * - API Key 不写入任何数据库、文件或永久日志
 * - 出错日志中只打印 API Key 前 8 位 + "***" 掩码
 */
@Injectable()
export class AiService {
  // ======================================================================
  // 内部辅助方法
  // ======================================================================

  /**
   * 根据请求头信息动态创建 OpenAI SDK 客户端
   * 不启用 dangerouslyAllowBrowser（后端环境不需要）
   * @param apiKey 请求头 X-User-Api-Key
   * @param baseUrl 请求头 X-User-Base-Url
   * @returns OpenAI 客户端
   */
  private createOpenAIClient(apiKey: string, baseUrl: string): OpenAI {
    return new OpenAI({ apiKey, baseURL: baseUrl })
  }

  /**
   * 格式化 AI SDK 抛出的错误为可读中文消息
   * @param error 任意错误对象
   * @returns 已格式化的用户友好提示
   */
  private formatError(error: unknown): string {
    const err = error as { message?: string; status?: number }
    if (err?.message) return err.message
    return '连接失败，请检查 API Key 和 API 端点是否正确。'
  }

  /**
   * 统一校验 3 个必需请求头参数
   * 缺少任意一个直接抛 BadRequestException（Filter 会转为 code=40001）
   * @param apiKey X-User-Api-Key
   * @param baseUrl X-User-Base-Url
   * @param modelId X-User-Model-Id
   */
  private validateHeaders(
    apiKey: string | undefined,
    baseUrl: string | undefined,
    modelId: string | undefined,
  ): void {
    if (!apiKey) throw new BadRequestException('未配置 API Key')
    if (!baseUrl) throw new BadRequestException('未配置 API 端点')
    if (!modelId) throw new BadRequestException('未配置模型 ID')
  }

  /**
   * 用于错误日志打印的 API Key 掩码（仅保留前 8 位）
   * 避免完整 Key 泄漏到日志或控制台
   */
  private maskKey(key: string): string {
    if (!key || key.length <= 8) return '***'
    return `${key.slice(0, 8)}***`
  }

  /**
   * 把总分映射到 S/A/B/C/D 等级（同前端 scoreToGrade 逻辑）
   */
  private scoreToGrade(score: number): ResumeScoreResult['grade'] {
    if (score >= 90) return 'S'
    if (score >= 80) return 'A'
    if (score >= 70) return 'B'
    if (score >= 60) return 'C'
    return 'D'
  }

  /**
   * 生成 8 位短 ID（用于 PDF 转 JSON 后的新简历 id）
   */
  private generateShortId(): string {
    return crypto.randomUUID().substring(0, 8)
  }

  // ======================================================================
  // 1. 测试连接
  // ======================================================================

  /**
   * 测试用户 API 连接是否可用
   * 发送最小请求（max_tokens=1）验证参数正确性
   * @param apiKey 用户 API Key
   * @param baseUrl 用户 API 端点
   * @param modelId 用户模型 ID
   * @returns { success: true }
   */
  async testConnection(
    apiKey: string | undefined,
    baseUrl: string | undefined,
    modelId: string | undefined,
  ): Promise<{ success: true }> {
    this.validateHeaders(apiKey, baseUrl, modelId)
    const openai = this.createOpenAIClient(apiKey!, baseUrl!)

    try {
      await openai.chat.completions.create({
        model: modelId!,
        messages: [
          {
            role: 'system',
            content: '你正在进行连接测试，请忽略此内容。只需回复一个字',
          },
          { role: 'user', content: 'ping' },
        ],
        max_tokens: 1,
        temperature: 0,
      })
    } catch (error) {
      console.error('[AI] 测试连接失败（key=%s）', this.maskKey(apiKey!))
      throw new BadRequestException(this.formatError(error))
    }

    return { success: true }
  }

  // ======================================================================
  // 2. 语法检查
  // ======================================================================

  /**
   * AI 语法纠错（错别字、语病、标点）
   * @param dto resumeText
   * @param apiKey 用户 Key
   * @param baseUrl 用户端点
   * @param modelId 用户模型
   * @returns GrammarIssue[]
   */
  async checkGrammar(
    dto: GrammarCheckDto,
    apiKey: string | undefined,
    baseUrl: string | undefined,
    modelId: string | undefined,
  ): Promise<GrammarIssue[]> {
    this.validateHeaders(apiKey, baseUrl, modelId)
    const openai = this.createOpenAIClient(apiKey!, baseUrl!)

    // 提示词严格同前端 aiAPIConnect.ts 第 318 行
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

    try {
      const completion = await openai.chat.completions.create({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: dto.resumeText },
        ],
        model: modelId!,
        response_format: { type: 'json_object' },
        temperature: 0.2,
        stream: false,
      })
      const raw = completion.choices[0]?.message?.content || '{"issues":[]}'
      const parsed = JSON.parse(raw)
      return parsed.issues || []
    } catch (error) {
      console.error('[AI] 语法检查失败（key=%s）', this.maskKey(apiKey!))
      throw new BadRequestException(this.formatError(error))
    }
  }

  // ======================================================================
  // 3. 简历评分
  // ======================================================================

  /**
   * AI 简历质量深度评分（6 维度 + 等级 + 改进建议）
   * 结果 JSON 结构严格对应前端 ResumeScoreResult
   */
  async scoreResume(
    dto: ResumeScoreDto,
    apiKey: string | undefined,
    baseUrl: string | undefined,
    modelId: string | undefined,
  ): Promise<ResumeScoreResult> {
    this.validateHeaders(apiKey, baseUrl, modelId)
    const openai = this.createOpenAIClient(apiKey!, baseUrl!)

    // 提示词严格同前端 aiAPIConnect.ts 第 411 行
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

    try {
      const completion = await openai.chat.completions.create({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: dto.resumeText },
        ],
        model: modelId!,
        response_format: { type: 'json_object' },
        temperature: 0.3,
        stream: false,
      })

      const raw = completion.choices[0]?.message?.content || '{}'
      const parsed = JSON.parse(raw) as ResumeScoreResult

      // 兜底：防止模型缺字段
      parsed.grade = parsed.grade || this.scoreToGrade(parsed.totalScore || 0)
      parsed.dimensions = parsed.dimensions || []
      parsed.overallComment = parsed.overallComment || ''
      parsed.top3Issues = parsed.top3Issues || []
      parsed.top3Highlights = parsed.top3Highlights || []

      return parsed
    } catch (error) {
      console.error('[AI] 简历评分失败（key=%s）', this.maskKey(apiKey!))
      throw new BadRequestException(this.formatError(error))
    }
  }

  // ======================================================================
  // 4. 岗位匹配分析
  // ======================================================================

  /**
   * 分析简历与 JD 的匹配度，输出匹配度、技能缺口、亮点/薄弱点和改进建议
   */
  async analyzeJobMatch(
    dto: JobMatchDto,
    apiKey: string | undefined,
    baseUrl: string | undefined,
    modelId: string | undefined,
  ): Promise<JobMatchResult> {
    this.validateHeaders(apiKey, baseUrl, modelId)
    const openai = this.createOpenAIClient(apiKey!, baseUrl!)

    // 提示词严格同前端 aiAPIConnect.ts 第 553 行（把简历文本嵌在里面）
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

    try {
      const completion = await openai.chat.completions.create({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `岗位描述（JD）：\n${dto.jobDescription}` },
        ],
        model: modelId!,
        response_format: { type: 'json_object' },
        temperature: 0.3,
        stream: false,
      })

      const raw = completion.choices[0]?.message?.content || '{}'
      const parsed = JSON.parse(raw) as JobMatchResult

      // 空值兜底
      parsed.matchedSkills = parsed.matchedSkills || []
      parsed.missingSkills = parsed.missingSkills || []
      parsed.highlights = parsed.highlights || []
      parsed.weaknesses = parsed.weaknesses || []
      parsed.suggestions = parsed.suggestions || []

      return parsed
    } catch (error) {
      console.error('[AI] 岗位匹配分析失败（key=%s）', this.maskKey(apiKey!))
      throw new BadRequestException(this.formatError(error))
    }
  }

  // ======================================================================
  // 5. 生成面试问题
  // ======================================================================

  /**
   * 根据简历生成指定数量面试题及参考答案，输出 Markdown 格式字符串
   */
  async generateInterviewQuestions(
    dto: InterviewQuestionsDto,
    apiKey: string | undefined,
    baseUrl: string | undefined,
    modelId: string | undefined,
  ): Promise<{ content: string }> {
    this.validateHeaders(apiKey, baseUrl, modelId)
    const openai = this.createOpenAIClient(apiKey!, baseUrl!)

    const count = dto.questionCount ?? 5

    // 提示词严格同前端 aiAPIConnect.ts 第 106 行
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

    try {
      const completion = await openai.chat.completions.create({
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: `根据以下简历生成面试问题：\n\n${dto.resumeContent}`,
          },
        ],
        model: modelId!,
        temperature: 0.7,
        max_tokens: 2000,
        stream: false,
      })
      return { content: completion.choices[0]?.message?.content || '' }
    } catch (error) {
      console.error('[AI] 生成面试问题失败（key=%s）', this.maskKey(apiKey!))
      throw new BadRequestException(this.formatError(error))
    }
  }

  // ======================================================================
  // 6. PDF 文本转结构化 Resume JSON
  // ======================================================================

  /**
   * 根据 PDF 纯文本让 AI 生成完整 Resume 结构
   * 返回结构与前端 Resume 类型完全一致（缺少字段用常量兜底）
   */
  async pdfToJson(
    dto: PdfToJsonDto,
    apiKey: string | undefined,
    baseUrl: string | undefined,
    modelId: string | undefined,
  ): Promise<Record<string, any>> {
    this.validateHeaders(apiKey, baseUrl, modelId)
    const openai = this.createOpenAIClient(apiKey!, baseUrl!)

    // 提示词：嵌入 globalConfiguration 默认值和结构要求
    const prompt = `
    请将以下简历内容解析为JSON格式，包含以下字段：
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
    id必须给一个唯一的字符串
    整体JSON格式参考：字段与 Resume 类型完全一致。
    globalConfiguration 使用：${JSON.stringify(INITIAL_GLOBAL_CONFIGURATION)}
    简历内容：
    ${dto.pdfText}
  `

    try {
      const completion = await openai.chat.completions.create({
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: dto.pdfText },
        ],
        model: modelId!,
        response_format: { type: 'json_object' },
        temperature: 0.7,
        stream: false,
      })

      const parsed = JSON.parse(completion.choices[0]?.message?.content || '{}')
      // 同前端 pdfToJsonWithAI 后处理逻辑
      const id = this.generateShortId()
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
    } catch (error) {
      console.error('[AI] PDF 转 JSON 失败（key=%s）', this.maskKey(apiKey!))
      throw new BadRequestException(this.formatError(error))
    }
  }

  // ======================================================================
  // 7. 智能助手流式对话 (SSE)
  // ======================================================================

  /**
   * 流式调用 LLM，逐字通过 SSE 返回内容（对应前端 chatWithStream）
   * @param dto messages 数组
   * @returns NestJS SSE 要求的 Observable<{ data: string }>，每次 data 为 JSON 字符串
   */
  chatStream(
    dto: ChatStreamDto,
    apiKey: string | undefined,
    baseUrl: string | undefined,
    modelId: string | undefined,
  ): Observable<{ data: string }> {
    this.validateHeaders(apiKey, baseUrl, modelId)
    const openai = this.createOpenAIClient(apiKey!, baseUrl!)

    return new Observable((subscriber) => {
      ;(async () => {
        try {
          const stream = await openai.chat.completions.create({
            messages: dto.messages.map((m) => ({
              role: m.role as 'system' | 'user' | 'assistant',
              content: m.content,
            })),
            model: modelId!,
            temperature: 0.7,
            stream: true,
          })

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
          console.error('[AI] 流式对话失败（key=%s）', this.maskKey(apiKey!))
          subscriber.error(new BadRequestException(this.formatError(error)))
        }
      })()

      // 客户端断开时的清理逻辑（可选：取消流式请求）
      return () => {}
    })
  }

  // ======================================================================
  // 8. 自我介绍生成 (SSE)
  // ======================================================================

  /**
   * 基于简历内容流式生成自我介绍文案（对应前端 generateSelfIntro）
   * @param dto resumeText + options（scene/duration/tone）
   * @returns SSE Observable
   */
  selfIntroStream(
    dto: SelfIntroDto,
    apiKey: string | undefined,
    baseUrl: string | undefined,
    modelId: string | undefined,
  ): Observable<{ data: string }> {
    this.validateHeaders(apiKey, baseUrl, modelId)
    const openai = this.createOpenAIClient(apiKey!, baseUrl!)

    const { scene, duration, tone } = dto.options
    const wordCount = duration * 220 // 中文语速估算

    // 同前端 generateSelfIntro 第 491-503 行的 systemPrompt
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

    return new Observable((subscriber) => {
      ;(async () => {
        try {
          const stream = await openai.chat.completions.create({
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: '请生成自我介绍' },
            ],
            model: modelId!,
            temperature: 0.7,
            stream: true,
          })

          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content || ''
            if (delta) {
              subscriber.next({
                data: JSON.stringify({ content: delta } as SseEventPayload),
              })
            }
          }

          subscriber.next({
            data: JSON.stringify({ done: true } as SseEventPayload),
          })
          subscriber.complete()
        } catch (error) {
          console.error('[AI] 自我介绍生成失败（key=%s）', this.maskKey(apiKey!))
          subscriber.error(new BadRequestException(this.formatError(error)))
        }
      })()

      return () => {}
    })
  }
}
