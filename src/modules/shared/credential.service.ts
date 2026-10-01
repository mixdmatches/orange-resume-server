import { BadRequestException, Injectable } from '@nestjs/common'
import { PrismaService } from '@/prisma/prisma.service'
import { UserAiConfigService } from '../user/user-ai-config.service'
import type { AiCredentials } from '../user/user-ai-config.service'

/**
 * AI 凭证解析服务
 *
 * 统一处理「根据用户 ID 解析出可用 AI 调用凭证」的逻辑。
 * 该逻辑在 ai、interview、ai-session、agent 四个模块中反复出现，
 * 提取后避免每个模块都重复写「读 ai_preference → 取 selectedProviderId → 调 getActiveCredentials」。
 *
 * 解析优先级：
 * 1. 调用方显式传入的 providerId（如测试连接指定服务商）
 * 2. 用户在 ai_preference 中选中的 selectedProviderId
 * 3. 都没有则抛 BadRequestException，提示用户去设置页选择服务商
 */
@Injectable()
export class CredentialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userAiConfigService: UserAiConfigService,
  ) {}

  /**
   * 解析当前用户生效的 AI 调用凭证
   * @param userId 当前登录用户 ID
   * @param providerId 可选，指定服务商 ID（优先级高于用户偏好）
   * @returns 解密后的调用凭证 { apiKey, baseUrl, modelId }
   * @throws BadRequestException 未选择配置 / 配置不存在 / 配置不完整 / 解密失败
   */
  async resolveCredentials(userId: number, providerId?: string): Promise<AiCredentials> {
    // 优先使用调用方指定的 providerId，否则读取用户偏好中选中的厂商
    let finalProviderId = providerId
    if (!finalProviderId) {
      const preference = await this.prisma.aiPreference.findUnique({ where: { userId } })
      finalProviderId = preference?.selectedProviderId
    }

    if (!finalProviderId) {
      throw new BadRequestException('请先前往设置页，选择并保存要使用的 AI 服务商')
    }

    return this.userAiConfigService.getActiveCredentials(userId, finalProviderId)
  }

  /**
   * 解析凭证并附带「用户偏好是否存在」的校验
   * 用于 ai.service 中需要先确认用户有偏好配置的场景
   * @param userId 当前登录用户 ID
   * @param providerId 可选，指定服务商 ID
   * @returns 解密后的调用凭证
   * @throws BadRequestException 用户无偏好配置 或 凭证解析失败
   */
  async resolveCredentialsWithPreferenceCheck(
    userId: number,
    providerId?: string,
  ): Promise<AiCredentials> {
    if (!providerId) {
      const preference = await this.prisma.aiPreference.findUnique({ where: { userId } })
      if (!preference) {
        throw new BadRequestException('暂无该用户偏好配置')
      }
      providerId = preference.selectedProviderId
    }
    return this.resolveCredentials(userId, providerId)
  }
}