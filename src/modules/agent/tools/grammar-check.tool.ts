import type { AgentTool } from '../types'

/**
 * 语法检查工具
 * 检查简历中的错别字、语病、标点错误、中英文混用、冗余表达
 * 直接复用 AiService.checkGrammar
 */
export const grammarCheckTool: AgentTool = {
  name: 'grammar_check',
  description:
    '检查简历文本中的错别字、语病、标点错误、中英文混用问题和冗余表达。返回问题列表，每项包含原文片段、修改建议、问题原因和严重程度(error/warning)。当用户要求检查语法、纠错、润色文字、或询问有没有错别字时调用。',
  parameters: {
    type: 'object',
    properties: {
      resumeText: {
        type: 'string',
        description: '简历纯文本内容',
      },
    },
    required: ['resumeText'],
  },
  async execute(ctx, args) {
    const resumeText = String(args.resumeText || '')
    return ctx.aiService.checkGrammar(ctx.userId, { resumeText })
  },
}