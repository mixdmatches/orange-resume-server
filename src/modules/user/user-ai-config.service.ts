import { BadRequestException, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as crypto from 'node:crypto'
import { decrypt, encrypt, maskApiKey } from '@/common/utils/crypto.utils'
import { PrismaService } from '@/prisma/prisma.service'
import { createAiConfigDto, MaskedManufacturer } from './dto/ai-config.dto'

/**
 * AI 调用凭证（API Key 已解密为明文）
 * 仅在服务端内存中短期使用，不落日志、不返回给前端
 */
export interface AiCredentials {
  /** 明文 API Key */
  apiKey: string
  /** OpenAI 协议兼容端点 */
  baseUrl: string
  /** 模型 ID */
  modelId: string
}

@Injectable()
export class UserAiConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 生成 8 位短 ID（与前端策略保持一致）
   * @returns 8 个字符长度的随机字符串
   */
  private generateShortId(): string {
    return crypto.randomUUID().substring(0, 8)
  }

  /**
   * 保存用户AI配置（幂等：同用户下同 providerId 不存在则新增，已存在则覆盖更新）
   * @param userId 用户ID
   * @param config 用户AI配置
   * @returns 服务商唯一标识 providerId
   */
  async addOrUpdateAiConfig(userId: number, config: createAiConfigDto): Promise<string> {
    if (!config.apiKeyEnc) {
      throw new BadRequestException('API Key 不能为空')
    }
    if (config.apiKeyEnc.includes('****')) {
      throw new BadRequestException('API Key 不能包含 ****')
    }
    if (!config.providerId) {
      config.providerId = this.generateShortId()
    }
    await this.prisma.aiProvider.upsert({
      where: { userId_providerId: { userId, providerId: config.providerId } },
      // 新增：apiKeyEnc 视为新明文，加密落库
      create: {
        userId,
        providerId: config.providerId,
        providerName: config.providerName,
        apiKeyCipher: encrypt(config.apiKeyEnc, this.configService),
        apiKeyLast4: config.apiKeyEnc.slice(-4),
        modelId: config.modelId,
        apiEndpoint: config.apiEndpoint,
      },
      // 已存在：覆盖更新；apiKeyEnc 含 **** 说明前端回传的是脱敏值，保留原密文
      update: {
        providerName: config.providerName,
        ...(config.apiKeyEnc.includes('****')
          ? {}
          : {
              apiKeyCipher: encrypt(config.apiKeyEnc, this.configService),
              apiKeyLast4: config.apiKeyEnc.slice(-4),
            }),
        modelId: config.modelId,
        apiEndpoint: config.apiEndpoint,
      },
    })
    return config.providerId
  }

  /**
   * 读取所有厂商用户AI配置
   * @param userId 用户ID
   * @returns 用户AI配置（apiKey 已脱敏）
   */
  async getAiConfig(userId: number): Promise<MaskedManufacturer[]> {
    const rows = await this.prisma.aiProvider.findMany({
      where: { userId },
      orderBy: { providerId: 'asc' },
    })
    return rows.map((row): MaskedManufacturer => {
      let apiKeyCipher = ''
      if (row.apiKeyCipher) {
        try {
          const plain = decrypt(row.apiKeyCipher, this.configService)
          apiKeyCipher = maskApiKey(plain)
        } catch {
          apiKeyCipher = '****'
        }
      }
      return {
        providerId: row.providerId,
        providerName: row.providerName ?? undefined,
        apiKeyCipher,
        modelId: row.modelId ?? undefined,
        apiEndpoint: row.apiEndpoint ?? '',
      }
    })
  }

  /**
   * 删除用户AI配置
   * @param userId 用户ID
   * @param id 服务商ID
   */
  async deleteAiConfig(userId: number, id: string) {
    await this.prisma.aiProvider.delete({
      where: { userId_providerId: { userId, providerId: id } },
    })
  }

  /**
   * 获取用户选中模型和润色提示词
   * @param userId 用户ID
   * @returns 用户选中模型和润色提示词
   */
  async getSelModelAndPrompt(
    userId: number,
  ): Promise<{ selectedProviderId: string; polishPrompt: string }> {
    const row = await this.prisma.aiPreference.findFirst({
      where: { userId },
    })
    return {
      selectedProviderId: row?.selectedProviderId ?? '',
      polishPrompt: row?.polishPrompt ?? '',
    }
  }

  /**
   * 更新用户选中模型和润色提示词
   * 使用 upsert 保证幂等：偏好行不存在时自动创建（update 遇不到行会抛 P2025 导致 500）
   * @param userId 用户ID
   * @param selectedProviderId 选中模型ID（可传 null 表示取消选中）
   * @param polishPrompt 润色提示词
   */
  async updateSelModelAndPrompt(
    userId: number,
    selectedProviderId: string | null,
    polishPrompt: string | null,
  ): Promise<void> {
    await this.prisma.aiPreference.upsert({
      where: { userId },
      create: {
        userId,
        selectedProviderId,
        polishPrompt,
      },
      update: {
        selectedProviderId,
        polishPrompt,
      },
    })
  }

  /**
   * 获取当前生效的 AI 调用凭证（供 AI 代理模块转发请求使用）
   * @param userId 用户ID
   * @param providerId 指定的服务商ID（可选，不传则用用户当前选中的）
   * @returns 解密后的调用凭证 { apiKey, baseUrl, modelId }
   * @throws BadRequestException 未选择配置 / 配置不存在 / 配置不完整 / 解密失败
   */
  async getActiveCredentials(userId: number, providerId: string): Promise<AiCredentials> {
    const row = await this.prisma.aiProvider.findUnique({
      where: { userId_providerId: { userId, providerId } },
    })
    if (!row) {
      throw new BadRequestException('AI 服务商配置不存在，请重新保存')
    }
    if (!row.apiKeyCipher) {
      throw new BadRequestException('该服务商未配置 API Key，请补全后再试')
    }
    if (!row.apiEndpoint) {
      throw new BadRequestException('该服务商未配置 API 端点，请补全后再试')
    }
    if (!row.modelId) {
      throw new BadRequestException('该服务商未配置模型 ID，请补全后再试')
    }

    let apiKey: string
    try {
      apiKey = decrypt(row.apiKeyCipher, this.configService)
    } catch {
      throw new BadRequestException('API Key 解密失败，请重新保存该服务商的 API Key')
    }

    return { apiKey, baseUrl: row.apiEndpoint, modelId: row.modelId }
  }
}
