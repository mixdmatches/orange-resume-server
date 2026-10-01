import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type { AiSession, InterviewSession } from '@prisma/client'
import { PrismaService } from '@/prisma/prisma.service'

/**
 * 会话归属校验服务
 */
@Injectable()
export class SessionGuardService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 校验会话归属并返回会话记录（不含 interviewSession）
   * 适用于 agent 等不需要面试扩展信息的场景
   *
   * @param userId 当前登录用户 ID
   * @param sessionIdStr URL 参数中的会话 ID 字符串
   * @returns 会话记录
   * @throws NotFoundException ID 格式非法 / 会话不存在 / 已软删除
   */
  async findOwnedSession(userId: number, sessionIdStr: string): Promise<AiSession> {
    if (!/^\d+$/.test(sessionIdStr)) {
      throw new NotFoundException('会话不存在')
    }
    const session = await this.prisma.aiSession.findFirst({
      where: { id: BigInt(sessionIdStr), userId },
    })
    if (!session || session.status === 'deleted') {
      throw new NotFoundException('会话不存在')
    }
    return session
  }

  /**
   * 校验会话归属并返回会话记录（含 interviewSession 关联）
   * 适用于 ai-session 详情接口等需要面试扩展信息的场景
   *
   * @param userId 当前登录用户 ID
   * @param sessionIdStr URL 参数中的会话 ID 字符串
   * @returns 会话记录（含 interviewSession，可能为 null）
   * @throws NotFoundException ID 格式非法 / 会话不存在 / 已软删除
   */
  async findOwnedSessionWithInterview(
    userId: number,
    sessionIdStr: string,
  ): Promise<AiSession & { interviewSession: InterviewSession | null }> {
    if (!/^\d+$/.test(sessionIdStr)) {
      throw new NotFoundException('会话不存在')
    }
    const session = await this.prisma.aiSession.findFirst({
      where: { id: BigInt(sessionIdStr), userId },
      include: { interviewSession: true },
    })
    if (!session || session.status === 'deleted') {
      throw new NotFoundException('会话不存在')
    }
    return session as AiSession & { interviewSession: InterviewSession | null }
  }

  /**
   * 校验面试会话归属并返回记录（含 interviewSession，且必须为 interview 类型）
   * 适用于 interview 模块
   *
   * @param userId 当前登录用户 ID
   * @param sessionIdStr URL 参数中的会话 ID 字符串
   * @returns 会话记录（含 interviewSession）
   * @throws NotFoundException ID 格式非法 / 会话不存在 / 非面试类型 / 已删除
   */
  async findOwnedInterview(
    userId: number,
    sessionIdStr: string,
  ): Promise<AiSession & { interviewSession: InterviewSession }> {
    if (!/^\d+$/.test(sessionIdStr)) {
      throw new NotFoundException('面试不存在')
    }
    const session = await this.prisma.aiSession.findFirst({
      where: { id: BigInt(sessionIdStr), userId },
      include: { interviewSession: true },
    })
    if (
      !session ||
      session.type !== 'interview' ||
      !session.interviewSession ||
      session.status === 'deleted'
    ) {
      throw new NotFoundException('面试不存在')
    }
    return session as AiSession & { interviewSession: InterviewSession }
  }
}
