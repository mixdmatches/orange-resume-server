import { Global, Module } from '@nestjs/common'
import { PrismaService } from './prisma.service'

/**
 * Prisma 全局模块
 * 使用 @Global() 装饰器，在 AppModule 中导入一次后，
 * 所有业务模块（auth、resume、ai 等）无需重复导入即可直接注入 PrismaService
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
