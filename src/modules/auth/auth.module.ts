import { Module } from '@nestjs/common'
import { PassportModule } from '@nestjs/passport'
import { JwtModule } from '@nestjs/jwt'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { UserModule } from '../user/user.module'
import { AuthService } from './auth.service'
import { AuthController } from './auth.controller'
import { JwtStrategy } from './strategies/jwt.strategy'

/**
 * 认证模块
 * 提供注册、登录、登出、获取用户资料相关的路由和业务逻辑
 * JwtModule 使用 registerAsync 从 ConfigService 读取 secret 等配置
 */
@Module({
  imports: [
    UserModule,
    PassportModule,
    // 异步配置 JwtModule，确保能拿到 .env 中的 secret
    // 注：signOptions 不在此设置 expiresIn，由 auth.service 在 sign() 时按 string 形式显式传入（兼容 '7d' 等写法）
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET') ?? 'fallback-secret-change-me',
      }),
    }),
  ],
  providers: [AuthService, JwtStrategy],
  controllers: [AuthController],
  exports: [AuthService, JwtStrategy],
})
export class AuthModule {}
