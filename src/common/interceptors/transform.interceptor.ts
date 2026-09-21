import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common'
import { Observable } from 'rxjs'
import { map } from 'rxjs/operators'
import { success } from '../dto/api-response'

/**
 * 全局响应转换拦截器
 * 将 Controller 方法的返回值包裹成统一的 { code, message, data } 成功格式
 *
 * 注意：
 * 1. 对于 SSE 流式响应，返回的是 Observable<SseMessage>，不需要包裹 JSON，
 *    因此需要跳过拦截（通过请求路径是否含 '/stream/' 判断）
 * 2. 异常统一由 HttpExceptionFilter 处理，不走此拦截器
 */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, any> {
  /**
   * 拦截处理函数
   * @param context 执行上下文（可获取 Request、路由等信息）
   * @param next 后续调用处理器，handle() 返回 Controller 返回值的 Observable
   * @returns 转换后的响应 Observable
   */
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<any> {
    const request = context.switchToHttp().getRequest()
    const url: string = request?.url ?? ''

    // 流式接口跳过拦截：SSE 事件本身是 text/event-stream，不能包 JSON
    // 统一按 URL 含 /stream 判断（覆盖 /ai/chat/stream、/ai/self-intro/stream、/ai-sessions/:id/chat/stream 等）
    const isSseStream = url.includes('/stream')

    if (isSseStream) {
      return next.handle()
    }

    // 正常 JSON 响应：用 success() 包裹为统一格式
    return next.handle().pipe(map((data) => success(data)))
  }
}
