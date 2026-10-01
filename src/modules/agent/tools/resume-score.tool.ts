import type { AgentTool } from '../types'

/**
 * 简历评分工具
 * 对简历进行 6 维度质量评分，返回总分、等级和改进建议
 * 直接复用 AiService.scoreResume，不重复实现 LLM 调用逻辑
 */
export const resumeScoreTool: AgentTool = {
  name: 'resume_score',
  description:
    '对简历进行多维度质量评分（内容详实度、结构清晰度、技能匹配度、项目深度、语言表达、差异化亮点），返回总分(0-100)、等级(S/A/B/C/D)和改进建议。当用户想了解简历整体质量、需要优化建议、或询问简历能打多少分时调用。',
  parameters: {
    type: 'object',
    properties: {
      resumeText: {
        type: 'string',
        description: '简历纯文本内容（基本信息+教育+工作经历+项目经历等拼接后的字符串）',
      },
    },
    required: ['resumeText'],
  },
  async execute(ctx, args) {
    const resumeText = String(args.resumeText || '')
    return ctx.aiService.scoreResume(ctx.userId, { resumeText })
  },
}