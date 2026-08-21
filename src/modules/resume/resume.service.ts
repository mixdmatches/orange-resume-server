import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import * as crypto from 'node:crypto'
import { PrismaService } from '../../prisma/prisma.service'
import type { UpdateResumeDto, DeleteBatchResumeDto, CreateResumeDto } from './dto/resume.dto'

/**
 * 简历列表单条摘要结构（不含 content，省流量）
 */
export interface ResumeSummary {
  /** 简历短 ID */
  id: string
  /** 简历标题 */
  title: string
  /** 模板 ID */
  templateId: string
  /** 创建时间（毫秒时间戳，与前端 Resume 类型一致） */
  createdAt: number
  /** 更新时间（毫秒时间戳） */
  updatedAt: number
}

/**
 * 简历列表响应结构
 */
export interface ResumeListResult {
  list: ResumeSummary[]
  total: number
}

/**
 * 简历模块 Service
 * 负责所有简历相关的 CRUD 业务逻辑，包含严格的所有权校验（防止水平越权）
 */
@Injectable()
export class ResumeService {
  constructor(private readonly prisma: PrismaService) {}

  // ==================================================================
  // 内部辅助方法
  // ==================================================================

  /**
   * 生成 8 位短 ID（与前端策略保持一致）
   * @returns 8 个字符长度的随机字符串
   */
  private generateShortId(): string {
    return crypto.randomUUID().substring(0, 8)
  }

  /**
   * DateTime → 毫秒时间戳（JS number）
   * @param dt Prisma 返回的 Date 对象
   */
  private toTimestamp(dt: Date): number {
    return dt.getTime()
  }

  /**
   * 根据 ID 读取简历记录，内部统一处理「不存在 / 无权限」
   *
   * @param userId 当前登录用户 ID
   * @param resumeId 目标简历 ID
   * @param allowSkipOwnerCheck 特殊场景（目前无）跳过所有权校验
   * @returns Prisma Resume 记录（含 content）
   * @throws NotFoundException (40401)  ID 不存在
   * @throws ForbiddenException (40301)  userId 不匹配
   */
  private async getResumeWithOwnerCheck(userId: number, resumeId: string) {
    const resume = await this.prisma.resume.findUnique({
      where: { id: resumeId },
    })
    if (!resume) {
      throw new NotFoundException('简历不存在')
    }
    if (resume.userId !== userId) {
      throw new ForbiddenException('无权限操作该简历')
    }
    return resume
  }

  // ==================================================================
  // 对外业务方法
  // ==================================================================

  /**
   * 创建一份新的简历，归属到指定用户
   *
   * @param userId 当前登录用户 ID
   * @param dto 创建参数（含 templateId、title、content）
   * @returns 新简历 id
   */
  async createResume(userId: number, dto: CreateResumeDto): Promise<{ id: string }> {
    const id = dto.id || this.generateShortId()

    await this.prisma.resume.create({
      data: {
        id,
        userId,
        templateId: dto.templateId,
        title: dto.title,
        content: dto.content as any,
      },
    })

    return { id }
  }

  /**
   * 获取当前登录用户的简历列表（按更新时间倒序）
   * 只返回摘要字段，不返回 content 内容，节省带宽
   *
   * @param userId 当前登录用户 ID
   * @returns { list: ResumeSummary[], total: number }
   */
  async getMyResumes(userId: number): Promise<ResumeListResult> {
    const [rows, total] = await Promise.all([
      this.prisma.resume.findMany({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        // 注意：明确不 select content 字段
        select: {
          id: true,
          title: true,
          templateId: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.resume.count({ where: { userId } }),
    ])

    return {
      list: rows.map((r) => ({
        id: r.id,
        title: r.title,
        templateId: r.templateId,
        createdAt: this.toTimestamp(r.createdAt),
        updatedAt: this.toTimestamp(r.updatedAt),
      })),
      total,
    }
  }

  /**
   * 获取单份简历的完整详情（含平铺的 Resume 结构）
   * 流程：查库 → 校验所有权 → content JSON + 数据库列合并 → 返回
   *
   * @param userId 当前登录用户 ID
   * @param resumeId 目标简历 ID
   * @returns 与前端 Resume 类型完全一致的对象（含 basic/educations/...）
   */
  async getResumeDetail(userId: number, resumeId: string): Promise<Record<string, any>> {
    const resume = await this.getResumeWithOwnerCheck(userId, resumeId)

    // content 存储的是前端 Resume 对象的 JSON（可能存在 id/title 不同步的情况）
    // 因此以数据库列为准覆盖关键字段，然后合并返回
    const content = (resume.content ?? {}) as Record<string, any>

    const merged: Record<string, any> = {
      ...content,
      id: resume.id,
      title: resume.title,
      templateId: resume.templateId,
      createdAt: this.toTimestamp(resume.createdAt),
      updatedAt: this.toTimestamp(resume.updatedAt),
    }

    return merged
  }

  /**
   * 更新一份简历（全量覆盖 content + 元字段）
   *
   * @param userId 当前登录用户 ID
   * @param resumeId 目标简历 ID
   * @param dto 更新参数
   * @returns { id, updatedAt } 更新后的主键与最新更新时间（毫秒）
   */
  async updateResume(
    userId: number,
    resumeId: string,
    dto: UpdateResumeDto,
  ): Promise<{ id: string; updatedAt: number }> {
    // 先校验存在与所有权
    await this.getResumeWithOwnerCheck(userId, resumeId)

    const updated = await this.prisma.resume.update({
      where: { id: resumeId },
      data: {
        title: dto.title ?? undefined,
        templateId: dto.templateId ?? undefined,
        content: dto.content as any,
        // updatedAt 由 Prisma 的 @updatedAt 自动刷新
      },
      select: { id: true, updatedAt: true },
    })

    return {
      id: updated.id,
      updatedAt: this.toTimestamp(updated.updatedAt),
    }
  }

  /**
   * 删除一份简历（硬删除）
   *
   * @param userId 当前登录用户 ID
   * @param resumeId 目标简历 ID
   * @returns { success: true }
   */
  async deleteResume(userId: number, resumeId: string): Promise<{ success: true }> {
    await this.getResumeWithOwnerCheck(userId, resumeId)
    await this.prisma.resume.delete({ where: { id: resumeId } })
    return { success: true }
  }

  /**
   * 删除多份简历（硬删除）
   *
   * @param userId 当前登录用户 ID
   * @param ids 要删除的简历 ID 列表
   * @returns { success: true }
   */
  async deleteBatchResumes(userId: number, ids: string[]): Promise<{ success: true }> {
    await this.prisma.resume.deleteMany({
      where: {
        userId,
        id: { in: ids },
      },
    })
    return { success: true }
  }

  /**
   * 复制一份简历：保留 content，生成新 ID，title 后缀加「副本」，重置创建时间
   *
   * @param userId 当前登录用户 ID
   * @param resumeId 原始简历 ID
   * @returns { newId } 新简历 ID
   */
  async duplicateResume(userId: number, resumeId: string): Promise<{ newId: string }> {
    const source = await this.getResumeWithOwnerCheck(userId, resumeId)

    const newId = this.generateShortId()
    const newTitle = `${source.title} 副本`
    const contentCopy = (source.content ?? {}) as Record<string, any>

    await this.prisma.resume.create({
      data: {
        id: newId,
        userId,
        templateId: source.templateId,
        title: newTitle,
        content: contentCopy as any,
        // createdAt / updatedAt 用默认值（当前时间）
      },
    })

    return { newId }
  }
}
