import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { decrypt, maskApiKey } from '@/common/utils/crypto.utils'
import { PrismaService } from '@/prisma/prisma.service'

/** 数据库中存储的加密后服务商配置（apiKey 已加密为 apiKeyEnc） */
interface EncryptedManufacturer {
  id: string
  name: string
  icon: string
  hint: string
  apiKeyEnc: string
  modelId?: string
  apiEndpoint: string
  providerName?: string
}

export interface MaskedManufacturer {
  id: string
  name: string
  icon: string
  hint: string
  apiKey: string
  hasKey: boolean
  modelId?: string
  apiEndpoint: string
  providerName?: string
}

export interface AiConfigResponse {
  selectedModel: string | null
  polishPrompt: string | null
  states: MaskedManufacturer[]
  version: number
}

@Injectable()
export class UserAiConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 读取用户AI配置
   */
  async getAiConfig(userId: number): Promise<AiConfigResponse> {
    const row = await this.prisma.userAiConfig.findUnique({
      where: { userId },
    })

    if (!row) {
      return { selectedModel: null, polishPrompt: null, states: [], version: 0 }
    }

    const providers = row.providers as { states?: EncryptedManufacturer[] }
    const states = (providers.states ?? []).map((m): MaskedManufacturer => {
      let apiKey = ''
      let hasKey = false
      if (m.apiKeyEnc) {
        try {
          const plain = decrypt(m.apiKeyEnc, this.configService)
          apiKey = maskApiKey(plain)
          hasKey = true
        } catch {
          apiKey = '****'
          hasKey = false
        }
      }
      return {
        id: m.id,
        name: m.name,
        icon: m.icon,
        hint: m.hint,
        apiKey,
        hasKey,
        modelId: m.modelId,
        apiEndpoint: m.apiEndpoint,
        providerName: m.providerName,
      }
    })

    return {
      selectedModel: row.selectedModel,
      polishPrompt: row.polishPrompt,
      states,
      version: row.version,
    }
  }
}
