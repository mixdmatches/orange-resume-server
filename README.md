# 橙子简历后端服务

orange-resume 的后端服务，提供用户认证、简历管理、OpenAI 兼容模型代理和 Swagger API 文档。

> [!IMPORTANT]
> - 本项目需要 Node.js 20+、pnpm 11 和 MySQL 8.0+。
> - 启动前必须创建 `.env` 并执行 Prisma 数据库迁移。
> - 普通 JSON 接口无论成功还是失败，HTTP 状态码目前都返回 `200`，请通过响应体中的 `code` 判断结果。
> - AI 接口使用调用方提供的模型配置，API Key 仅在当前请求中使用，不写入数据库。

## 快速开始

### 1. 准备环境

请确认本机已经安装：

| 工具 | 要求 | 检查命令 |
| --- | --- | --- |
| Node.js | 20 或更高版本 | `node --version` |
| pnpm | 推荐使用项目声明的 11.17.0 | `pnpm --version` |
| MySQL | 8.0 或更高版本 | `mysql --version` |

在 MySQL 中创建开发数据库：

```sql
CREATE DATABASE orange_resume
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
```

### 2. 安装依赖

```powershell
pnpm install
```

项目根目录的 `pnpm-workspace.yaml` 已允许 Prisma、bcrypt 等依赖执行必要的安装脚本。

### 3. 配置环境变量

在项目根目录创建 `.env`：

```dotenv
DATABASE_URL="mysql://root:your_password@127.0.0.1:3306/orange_resume"
JWT_SECRET="replace-with-a-long-random-secret"
JWT_EXPIRES_IN="7d"
PORT=3000
```

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `DATABASE_URL` | 是 | 无 | Prisma 使用的 MySQL 连接地址 |
| `JWT_SECRET` | 生产环境必须 | `fallback-secret-change-me` | JWT 签名密钥，生产环境不得使用默认值 |
| `JWT_EXPIRES_IN` | 否 | `7d` | JWT 有效期，例如 `7d`、`12h` |
| `PORT` | 否 | `3000` | HTTP 服务端口 |

如果 MySQL 密码包含 `@`、`:`、`/`、`#` 等特殊字符，需要先进行 URL 编码。

### 4. 初始化数据库

```powershell
pnpm prisma:validate
pnpm prisma:migrate
pnpm prisma:generate
```

这些命令会校验 Prisma Schema、应用 `prisma/migrations` 中的迁移并生成 Prisma Client。

### 5. 启动开发服务

```powershell
pnpm start:dev
```

服务启动后可以访问：

| 地址 | 用途 |
| --- | --- |
| `http://localhost:3000/api` | API 基础地址 |
| `http://localhost:3000/api/docs` | Swagger UI |

如果修改了 `PORT`，请同步替换以上地址中的端口。

## 验证服务

推荐先通过 Swagger UI 完成注册、登录和接口调用。也可以在 Windows PowerShell 中执行以下请求。

注册用户：

```powershell
$registerBody = @{
  username = 'orange_user'
  email = 'orange@example.com'
  password = 'Orange123'
  confirmPassword = 'Orange123'
} | ConvertTo-Json

Invoke-RestMethod `
  -Uri 'http://localhost:3000/api/auth/register' `
  -Method Post `
  -ContentType 'application/json' `
  -Body $registerBody
```

登录并获取 JWT：

```powershell
$loginBody = @{
  username = 'orange_user'
  password = 'Orange123'
} | ConvertTo-Json

$loginResponse = Invoke-RestMethod `
  -Uri 'http://localhost:3000/api/auth/login' `
  -Method Post `
  -ContentType 'application/json' `
  -Body $loginBody

$token = $loginResponse.data.token
```

使用 JWT 获取当前用户资料：

```powershell
Invoke-RestMethod `
  -Uri 'http://localhost:3000/api/auth/profile' `
  -Method Get `
  -Headers @{ Authorization = "Bearer $token" }
```

## 主要能力

- 用户注册、登录、登出和资料查询
- bcrypt 密码哈希和 JWT Bearer 身份认证
- 简历创建、列表、详情、更新、删除、批量删除和复制
- 简历所有权检查，阻止用户访问其他用户的简历
- 简历内容以 MySQL JSON 字段保存
- AI 语法检查、简历评分、岗位匹配、面试题生成和 PDF 文本结构化
- AI 对话和自我介绍 SSE 流式输出
- DTO 参数校验、统一响应结构和统一异常处理
- Swagger UI 在线接口文档

## 技术栈

| 分类 | 技术 |
| --- | --- |
| Web 框架 | NestJS 11 |
| 开发语言 | TypeScript 5 |
| ORM | Prisma 6 |
| 数据库 | MySQL 8 |
| 身份认证 | Passport、JWT、bcrypt |
| 参数校验 | class-validator、class-transformer |
| AI SDK | OpenAI Node.js SDK，兼容 OpenAI 协议服务 |
| API 文档 | Swagger UI |
| 代码质量 | ESLint 9、Prettier 3 |
| 包管理器 | pnpm 11 |

## 项目结构

```text
orange-resume-server/
├─ prisma/
│  ├─ migrations/              # 数据库迁移
│  └─ schema.prisma            # User、Resume 数据模型
├─ src/
│  ├─ common/
│  │  ├─ decorators/           # CurrentUser 参数装饰器
│  │  ├─ dto/                  # 统一响应结构和业务码
│  │  ├─ filters/              # 全局异常过滤器
│  │  ├─ guards/               # JWT 守卫
│  │  ├─ interceptors/         # 成功响应包装
│  │  └─ types/                # 公共类型
│  ├─ modules/
│  │  ├─ ai/                   # AI 代理和 SSE
│  │  ├─ auth/                 # 注册、登录和 JWT 签发
│  │  ├─ resume/               # 简历 CRUD
│  │  └─ user/                 # 用户数据访问
│  ├─ prisma/                  # PrismaModule 和 PrismaService
│  ├─ app.module.ts            # 根模块
│  └─ main.ts                  # 应用启动、CORS、Swagger 和全局组件
├─ eslint.config.mjs           # ESLint 9 Flat Config
├─ pnpm-workspace.yaml         # pnpm 11 依赖构建权限
└─ package.json
```

请求处理流程：

```text
HTTP 请求
  -> ValidationPipe 参数校验
  -> JwtAuthGuard 身份认证
  -> Controller
  -> Service
  -> Prisma
  -> MySQL
  -> TransformInterceptor / HttpExceptionFilter
  -> { code, message, data }
```

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `pnpm start:dev` | 监听文件变化并启动开发服务 |
| `pnpm build` | 编译到 `dist` |
| `pnpm start:prod` | 运行已编译的生产代码 |
| `pnpm lint` | 检查并自动修复 ESLint 问题 |
| `pnpm lint:check` | 只检查 ESLint，不修改文件 |
| `pnpm format` | 使用 Prettier 格式化源代码 |
| `pnpm format:check` | 检查代码格式 |
| `pnpm prisma:validate` | 校验 Prisma Schema |
| `pnpm prisma:migrate` | 在开发环境创建或应用迁移 |
| `pnpm prisma:generate` | 生成 Prisma Client |
| `pnpm prisma:studio` | 打开 Prisma Studio |

项目目前没有配置自动化测试命令，提交代码前至少执行：

```powershell
pnpm lint:check
pnpm format:check
pnpm build
```

## 生产部署

部署前应用迁移并构建：

```powershell
pnpm install --frozen-lockfile
pnpm exec prisma migrate deploy
pnpm prisma:generate
pnpm build
pnpm start:prod
```

生产环境还需要：

- 设置高强度、不可公开的 `JWT_SECRET`
- 使用受限的 MySQL 账号，不要使用 `root`
- 使用 HTTPS，避免 JWT 和用户 AI Key 被明文传输
- 将 `src/main.ts` 中写死的 CORS 来源改为生产前端域名
- 在反向代理中关闭 SSE 响应缓冲，并适当延长读取超时
- 不要将 `.env` 提交到 Git

## 常见问题

### Prisma 无法连接 MySQL

检查 MySQL 服务是否启动、数据库是否存在，以及 `.env` 中的用户名、密码、主机、端口和数据库名是否正确：

```powershell
pnpm prisma:validate
pnpm exec prisma db pull
```

### 找不到 Prisma Client

重新生成客户端：

```powershell
pnpm prisma:generate
```

如果刚刚修改了数据模型，还需要创建迁移：

```powershell
pnpm exec prisma migrate dev --name describe_your_change
```