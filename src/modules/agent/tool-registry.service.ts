import { Injectable } from '@nestjs/common'
import type OpenAI from 'openai'
import type { AgentTool, ToolContext } from './types'
import { resumeScoreTool, grammarCheckTool, jobMatchTool } from './tools'

type OpenAITool = OpenAI.Chat.Completions.ChatCompletionTool

/**
 * 工具注册表
 * 职责：
 * 1. 持有所有可用工具的实例（启动时注册，运行时只读）
 * 2. 把工具列表转换为 OpenAI tools 参数格式，供 LLM 决策调用
 * 3. 根据 LLM 返回的 tool_call 名称路由到对应工具执行
 *
 * 设计为单例服务，AgentRunner 注入后即可使用全部工具
 */
@Injectable()
export class ToolRegistryService {
  /** 工具映射表：name -> AgentTool */
  private readonly tools = new Map<string, AgentTool>()

  constructor() {
    // 注册内置工具（后续可扩展为从配置/Skill 动态加载）
    this.register(resumeScoreTool)
    this.register(grammarCheckTool)
    this.register(jobMatchTool)
  }

  /**
   * 注册一个工具
   * @param tool 工具实例
   */
  private register(tool: AgentTool): void {
    this.tools.set(tool.name, tool)
  }

  /**
   * 获取所有工具的 OpenAI schema 格式
   * 直接作为 chat.completions.create 的 tools 参数传入
   * @returns OpenAI tools 数组
   */
  getToolSchemas(): OpenAITool[] {
    return Array.from(this.tools.values()).map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }))
  }

  /**
   * 判断工具是否存在
   * @param name 工具名称
   */
  has(name: string): boolean {
    return this.tools.has(name)
  }

  /**
   * 执行指定工具
   * @param name 工具名称（LLM 返回的 function.name）
   * @param argsStr LLM 返回的 function.arguments（JSON 字符串）
   * @param ctx 执行上下文
   * @returns 工具执行结果
   * @throws 工具不存在时抛错
   */
  async execute(name: string, argsStr: string, ctx: ToolContext): Promise<unknown> {
    const tool = this.tools.get(name)
    if (!tool) {
      throw new Error(`未知工具: ${name}`)
    }

    // LLM 返回的 arguments 是 JSON 字符串，需解析为对象
    let args: Record<string, unknown>
    try {
      args = JSON.parse(argsStr)
    } catch {
      // 解析失败时传空对象，由工具内部做参数校验
      args = {}
    }

    return tool.execute(ctx, args)
  }

  /**
   * 获取已注册工具名称列表（用于调试/日志）
   */
  getToolNames(): string[] {
    return Array.from(this.tools.keys())
  }
}
