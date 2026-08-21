import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common'
import { Response } from 'express'
import { ErrorCode, failure } from '../dto/api-response'

/**
 * 全局异常过滤器
 * 捕获所有 Controller / Service 抛出的异常，并转换为统一格式的 JSON 响应。
 *
 * 映射规则：
 * - BadRequestException (400)          → code=40001（校验错误 / 通用参数错误）
 * - UnauthorizedException (401)        → code=40101（未登录 / Token 失效）
 * - ForbiddenException (403)           → code=40301（越权 / 无权限）
 * - NotFoundException (404)            → code=40401（资源不存在）
 * - ConflictException (409)            → code=40003（资源冲突，如用户名已存在）
 * - 其他 HttpException                  → code 取对应区间或 50001
 * - 未知非 HttpException (Error 等)    → code=50001，对外隐藏堆栈
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  /**
   * 捕获异常并写入响应
   * @param exception 抛出的异常对象
   * @param host 参数主机，可切换到 HTTP 上下文取 Response
   */
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()

    let code = ErrorCode.INTERNAL_ERROR
    let message = '服务器内部错误'

    if (exception instanceof HttpException) {
      const status = exception.getStatus()
      const res = exception.getResponse() as any
      // 提取可读错误消息：可能是字符串，也可能是 ValidationPipe 返回的对象
      const rawMessage =
        typeof res === 'string'
          ? res
          : Array.isArray(res?.message)
            ? res.message.join('; ')
            : res?.message || exception.message

      switch (exception.constructor) {
        case BadRequestException:
          // 登录失败等「参数/业务校验错误」中部分 message 映射到更精确的错误码
          if (rawMessage === '用户不存在或密码错误') {
            code = ErrorCode.INVALID_CREDENTIALS
          } else {
            // 默认：class-validator 校验失败等通用参数错误
            code = ErrorCode.BAD_REQUEST
          }
          message = rawMessage || '参数校验失败'
          break
        case UnauthorizedException:
          code = ErrorCode.UNAUTHORIZED
          message = rawMessage || '未登录或登录已过期'
          break
        case ForbiddenException:
          code = ErrorCode.FORBIDDEN
          message = rawMessage || '无权限操作'
          break
        case NotFoundException:
          code = ErrorCode.NOT_FOUND
          message = rawMessage || '资源不存在'
          break
        case ConflictException:
          // 资源冲突（如用户注册时 username/email 已存在）
          code = ErrorCode.USER_ALREADY_EXISTS
          message = rawMessage || '资源已存在'
          break
        default:
          // 其他自定义 HttpException：如果是 409/422 等则归到 40001
          if (status >= 400 && status < 500) {
            code = ErrorCode.BAD_REQUEST
          } else {
            code = ErrorCode.INTERNAL_ERROR
          }
          message = rawMessage || '请求失败'
      }
    } else if (exception instanceof Error) {
      // 非 HttpException：对外返回统一错误提示，日志打印完整堆栈
      console.error('[Uncaught Error]', exception?.stack || exception)
    } else {
      // 兜底的未知异常
      console.error('[Unknown Exception]', exception)
    }

    // 总是返回 200 HTTP Status，让前端通过 body.code 判断业务成败
    response.status(HttpStatus.OK).json(failure(code, message))
  }
}
