/**
 * 统一错误码枚举
 * 所有业务接口发生异常时，必须返回其中之一对应的 code 数值
 * 前端根据 code 进行 i18n 或针对性提示
 */
export enum ErrorCode {
  /** 成功 */
  SUCCESS = 0,
  /** 参数校验失败（class-validator、DTO 校验不通过、缺少必填 Header 等） */
  BAD_REQUEST = 40001,
  /** 用户不存在 或 密码错误（登录类失败） */
  INVALID_CREDENTIALS = 40002,
  /** 用户名已存在 或 邮箱已注册（注册冲突） */
  USER_ALREADY_EXISTS = 40003,
  /** 未登录 / Token 无效 / Token 过期 */
  UNAUTHORIZED = 40101,
  /** 无权限操作（访问他人资源、角色不足等） */
  FORBIDDEN = 40301,
  /** 资源不存在（如根据 ID 找不到记录） */
  NOT_FOUND = 40401,
  /** 服务器内部未知错误 */
  INTERNAL_ERROR = 50001,
}

/**
 * 统一接口响应结构
 * 所有接口无论成功失败，都会经过拦截器/过滤器处理为此格式
 * @template T data 字段的类型，无数据时为 null
 */
export interface ApiResponse<T> {
  /** 状态码，0 表示成功，其他为 ErrorCode 枚举对应值 */
  code: number
  /** 描述信息，成功通常为 'success'，失败时给出可读错误原因 */
  message: string
  /** 响应业务数据，失败时统一返回 null */
  data: T | null
}

/**
 * 构造一个成功响应对象
 * @param data 业务返回数据，不传则为 null
 * @param message 自定义成功提示，不传则默认 'success'
 * @returns 满足 ApiResponse<T> 结构的成功响应
 */
export function success<T>(data?: T, message = 'success'): ApiResponse<T> {
  return {
    code: ErrorCode.SUCCESS,
    message,
    data: data ?? null,
  }
}

/**
 * 构造一个失败响应对象
 * @param code 错误码（非 0），来自 ErrorCode 枚举
 * @param message 可读错误描述
 * @returns 满足 ApiResponse<null> 结构的失败响应（data 固定为 null）
 */
export function failure(code: number, message: string): ApiResponse<null> {
  return {
    code,
    message,
    data: null,
  }
}
