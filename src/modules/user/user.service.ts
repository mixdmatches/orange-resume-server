import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import * as bcrypt from 'bcrypt'
import { PrismaService } from '../../prisma/prisma.service'

export interface CreateUserInput {
  username: string
  email: string
  /** 原始明文密码，调用方不要提前哈希，由 Service 内部加密 */
  password: string
}

export interface UserProfile {
  id: number
  username: string
  email: string
  nickname: string | null
  avatar: string | null
}

@Injectable()
export class UserService {
  /** bcrypt 加密盐轮次，10 是安全性与性能的平衡值 */
  private readonly SALT_ROUNDS = 10

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 创建一个新用户（注册）
   *
   * @param input 创建入参 { username, email, password(明文) }
   * @returns 新建用户的 id, username, email
   * @throws ConflictException (40003) 当用户名或邮箱重复时
   */
  async createUser(input: CreateUserInput): Promise<{
    userId: number
    username: string
    email: string
  }> {
    const { username, email, password } = input

    // 检查唯一性
    const existUser = await this.prisma.user.findFirst({
      where: { OR: [{ username }, { email }] },
      select: { username: true, email: true },
    })
    if (existUser) {
      if (existUser.username === username) {
        throw new ConflictException('用户名已存在')
      }

      throw new ConflictException('邮箱已注册')
    }

    // 密码加密
    const passwordHash = await bcrypt.hash(password, this.SALT_ROUNDS)

    const created = await this.prisma.user.create({
      data: {
        username,
        email,
        passwordHash,
      },
      select: { id: true, username: true, email: true },
    })

    return {
      userId: created.id,
      username: created.username,
      email: created.email,
    }
  }

  /**
   * 根据「用户名或邮箱」匹配一条用户记录
   * 登录时调用，用于拿到 passwordHash 进行比对
   *
   * @param identifier 用户名或邮箱
   * @returns 带 passwordHash 的完整 User 或 null
   */
  async findByUsernameOrEmail(identifier: string): Promise<{
    id: number
    username: string
    email: string
    passwordHash: string
    nickname: string | null
    avatar: string | null
  } | null> {
    return this.prisma.user.findFirst({
      where: {
        OR: [{ username: identifier }, { email: identifier }],
      },
      select: {
        id: true,
        username: true,
        email: true,
        passwordHash: true,
        nickname: true,
        avatar: true,
      },
    })
  }

  /**
   * 根据用户 ID 查询用户资料（用于 profile 接口）
   * 绝不返回 passwordHash
   *
   * @param id 用户 ID
   * @returns 用户资料对象
   * @throws NotFoundException 当用户不存在时
   */
  async findById(id: number): Promise<UserProfile> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        email: true,
        nickname: true,
        avatar: true,
      },
    })
    if (!user) {
      throw new NotFoundException('用户不存在')
    }
    return user
  }

  /**
   * 注销用户账号（含所有关联数据），并清除本地 Token
   *
   * @param userId 用户 ID
   */
  async deleteAccount(userId: number): Promise<void> {
    await this.prisma.user.delete({
      where: { id: userId },
    })
  }
}
