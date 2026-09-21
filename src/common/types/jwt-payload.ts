/**
 * JWT Token 中携带的载荷（Payload）数据结构
 * 该对象在登录时被签名进 JWT，在请求被 JwtStrategy 校验后挂载到 request.user
 */
export interface JwtPayload {
  /** 当前登录用户 ID，对应用户表主键 */
  userId: number
  /** 当前登录用户名 */
  username: string
}

/**
 * Token 类型标识，用于区分 accessToken 与 refreshToken
 * - access：业务请求令牌，短寿命（默认 2 小时），挂在 Authorization 头使用
 * - refresh：刷新令牌，长寿命（默认 7 天），仅用于 /auth/refresh 换新令牌对
 */
export type JwtTokenType = 'access' | 'refresh'
