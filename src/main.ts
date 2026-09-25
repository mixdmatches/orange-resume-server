import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { AppModule } from '@/app.module'
import { TransformInterceptor } from './common/interceptors/transform.interceptor'
import { HttpExceptionFilter } from './common/filters/http-exception.filter'
import { PrismaService } from './prisma/prisma.service'

/**
 * NestJS 应用启动入口
 * 负责：
 * 1. 创建应用实例
 * 2. 装配全局 Pipe（参数校验）、Interceptor（统一响应）、Filter（统一异常）
 * 3. 配置 CORS、全局 API 前缀
 * 4. 配置 Swagger 文档（带 Bearer Token 授权按钮，可直接在 UI 里测试需要登录的接口）
 * 5. 读取配置端口启动 HTTP 服务
 * 6. 启用 Prisma 的优雅关闭钩子
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule)

  // ============== 全局参数校验管道 ==============
  // whitelist=true：DTA 中未加装饰器的字段自动剔除，防止越权参数
  // transform=true：自动按 DTO 类型进行运行时转换（尤其字符串转数字等）
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  )

  // ============== 全局拦截器 & 过滤器 ==============
  // 说明：这里直接 new 实例（而非 app.get），原因是这两个类未进入任何模块的 providers 数组，
  //      且两者都没有构造函数依赖注入，直接实例化即可正常工作，避免 "provider does not exist" 报错。
  //      （如果将来它们需要注入依赖，可改用 AppModule providers 中 APP_INTERCEPTOR / APP_FILTER token 注册方式）
  app.useGlobalInterceptors(new TransformInterceptor())
  app.useGlobalFilters(new HttpExceptionFilter())

  // ============== CORS 配置 ==============
  // 允许前端常见开发域（Vite 默认 5173、Nest 默认 3000），生产环境建议通过配置精确限制
  app.enableCors({
    origin: [
      'http://localhost:5173',
      'http://localhost:3000',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:3000',
      'https://github.com/mixdmatches/orange-resume',
    ],
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    exposedHeaders: ['Content-Disposition'],
  })

  // ============== 全局 API 前缀 ==============
  // Controller 中的路由如 'auth/register' → 最终 /api/auth/register
  app.setGlobalPrefix('api')

  // ============== Swagger 文档配置 ==============
  // 访问地址：http://localhost:3000/api/docs
  // - 页面右上角「Authorize」按钮输入 Bearer Token 后，可直接在 UI 内调所有需要登录的接口
  // - SSE 流式接口（/ai/chat/stream、/ai/self-intro/stream）在 Swagger UI 内无法持续接收推送
  //   （UI 会等响应结束才显示），生产环境建议用 curl -N 或前端页面测试
  const swaggerConfig = new DocumentBuilder()
    .setTitle('🍊 橙子简历 - 后端 API 文档')
    .setDescription(
      '橙子简历后端服务 MVP 一期：用户注册登录、简历 CRUD、AI 代理（流式+非流式）。所有接口统一响应格式：{ code, message, data }，code=0 表示成功。',
    )
    .setVersion('1.0.0 (MVP Phase 1)')
    // Bearer JWT：Swagger UI 右上角 "Authorize" 按钮弹出框，输入 "Bearer xxx" 或仅 "xxx" 均可
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          '通过 POST /api/auth/login 获取到的 Token，前面可加 Bearer 前缀或直接粘贴 Token 字符串',
        name: 'Authorization',
      },
      'bearer',
    )
    // AI 接口额外用到的 3 个自定义请求头（在 AI 分组页面会单独说明）
    .addApiKey(
      {
        type: 'apiKey',
        in: 'header',
        name: 'X-User-Api-Key',
        description: 'AI 接口使用：用户自己的大模型 API Key（临时使用，服务器不存储）',
      },
      'X-User-Api-Key',
    )
    .setContact('橙子简历项目组', 'https://github.com/', '')
    .addServer(`http://localhost:${process.env.PORT || 3000}`, '本地开发环境')
    .build()

  const document = SwaggerModule.createDocument(app, swaggerConfig, {
    // 全局响应：所有接口统一都返回 { code, message, data }
    // ignoreGlobalPrefix: false → 文档里的 URL 会自动带 /api 前缀（和 setGlobalPrefix 对齐）
    ignoreGlobalPrefix: false,
    operationIdFactory: (_controllerKey, methodKey) => methodKey, // 简化 SDK 生成时的 operationId 名称
  })

  // 挂载 Swagger UI，路径：/api/docs
  // 说明：SwaggerModule.setup() 的第一个参数是「绝对挂载路径」，不会自动叠加 setGlobalPrefix('api')。
  //       所以必须写 "api/docs" 才能和前端约定的 /api/* 路径风格保持一致。
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      // 默认折叠 Schemas 面板（让页面默认清爽一点）
      docExpansion: 'list',
      defaultModelsExpandDepth: 1,
      defaultModelExpandDepth: 1,
      // 让「Try it out」默认显示请求示例
      tryItOutEnabled: false,
      // 页面右上角显示请求持续时间
      showRequestDuration: true,
      filter: true, // 顶部出现搜索框，可按路径/tag 筛选
      persistAuthorization: true, // 关掉页面后 Token 不会丢，下次打开还在
    },
    customCss: '.swagger-ui .topbar { display: none }', // 隐藏顶部 Swagger 官方 logo 条，更贴近「项目文档」
    customSiteTitle: '🍊 橙子简历 API 文档', // 浏览器标签页标题
  })

  // ============== 端口 & 启动 ==============
  const configService = app.get(ConfigService)
  const port = Number(configService.get<string>('PORT')) || 3000

  // 启用优雅关闭（配合 PrismaService onModuleDestroy 正常释放连接）
  const prismaService = app.get(PrismaService)
  await prismaService.enableShutdownHooks(app)

  await app.listen(port)

  // 打印启动信息，便于快速定位
  const green = '\x1B[32m'
  const cyan = '\x1B[36m'
  const reset = '\x1B[0m'
  console.log(`${green}[orange-resume-server] 启动成功，监听 http://localhost:${port}${reset}`)
  console.log(`${cyan}📖 Swagger UI 文档: http://localhost:${port}/api/docs${reset}`)
  console.log(`API 前缀: /api`)
  console.log(`接口文档示例: POST /api/auth/register`)
}

bootstrap()
