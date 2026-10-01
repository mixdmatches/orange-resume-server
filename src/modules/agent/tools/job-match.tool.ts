import type { AgentTool } from '../types'

/**
 * 岗位匹配分析工具
 * 分析简历与岗位 JD 的匹配度，返回匹配分、匹配技能、缺失技能、亮点/薄弱点和建议
 * 直接复用 AiService.analyzeJobMatch
 */
export const jobMatchTool: AgentTool = {
  name: 'job_match',
  description:
    '分析简历与目标岗位描述(JD)的匹配度。返回匹配分(0-100)、已匹配技能、缺失技能、简历亮点、薄弱点和改进建议。当用户提供了岗位描述(JD)并想知道匹配程度、需要针对性优化建议时调用。',
  parameters: {
    type: 'object',
    properties: {
      resumeText: {
        type: 'string',
        description: '简历纯文本内容',
      },
      jobDescription: {
        type: 'string',
        description: '目标岗位描述(JD)纯文本，建议粘贴招聘网页原文',
      },
    },
    required: ['resumeText', 'jobDescription'],
  },
  async execute(ctx, args) {
    const resumeText = String(args.resumeText || '')
    const jobDescription = String(args.jobDescription || '')
    return ctx.aiService.analyzeJobMatch(ctx.userId, { resumeText, jobDescription })
  },
}