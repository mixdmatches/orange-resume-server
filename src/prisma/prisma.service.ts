import { Injectable, OnModuleInit, OnModuleDestroy, INestApplication } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'

/**
 * Prisma 数据库服务
 * 封装 PrismaClient 生命周期，随 NestJS 模块启动/关闭自动管理连接
 * 所有业务 Service 都通过依赖注入拿到 PrismaService 来操作数据库
 *
 * 注意：Prisma 5.0+ 已移除旧的 `$on('beforeExit')` 钩子（library engine 模式下该事件不再存在），
 *      本实现使用标准的 process.on('SIGINT' / 'SIGTERM') 信号监听来触发优雅关闭。
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  /**
   * 模块初始化时建立与数据库的连接
   * NestJS 会在应用启动时自动调用此方法
   */
  async onModuleInit(): Promise<void> {
    await this.$connect()
  }

  /**
   * 模块销毁时关闭数据库连接（配合 enableShutdownHooks 或 NestJS 生命周期）
   * 保证进程优雅退出，避免连接泄漏
   */
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect()
  }

  /**
   * 启用「优雅关闭」监听 —— 适配 Prisma 5+ library engine
   *
   * 工作原理：
   * 1. 先调用 NestJS 官方的 app.enableShutdownHooks()，让 Nest 自身响应 SIGINT/SIGTERM 信号
   * 2. 额外在 process 对象上监听相同信号，做兜底（Windows 下 Ctrl+C、Docker stop、PM2 restart 等场景）
   * 3. 信号到达时：关闭 Nest app（会依次触发 onModuleDestroy → this.$disconnect）→ 最后安全退出进程
   *
   * @param app NestApplication 实例，用于执行 app.close()
   */
  async enableShutdownHooks(app: INestApplication): Promise<void> {
    // 1) 让 Nest 开启标准关闭钩子监听
    app.enableShutdownHooks()

    // 2) 定义一次性的关闭处理器（避免信号来后重复执行）
    let shuttingDown = false
    const shutdown = async (signal: string): Promise<void> => {
      if (shuttingDown) return
      shuttingDown = true
      try {
        console.log(`[orange-resume-server] 收到 ${signal} 信号，开始优雅关闭...`)
        await app.close()
        await this.$disconnect()
        console.log('[orange-resume-server] 已优雅关闭')
        process.exit(0)
      } catch (e) {
        console.error('[orange-resume-server] 优雅关闭失败，强制退出', e)
        process.exit(1)
      }
    }

    // 3) 绑定常见 3 个信号（SIGINT = Ctrl+C；SIGTERM = Docker/PM2/kill；SIGBREAK = Windows Ctrl+Break）
    process.once('SIGINT', () => shutdown('SIGINT'))
    process.once('SIGTERM', () => shutdown('SIGTERM'))
    process.once('SIGBREAK', () => shutdown('SIGBREAK'))
  }
}
