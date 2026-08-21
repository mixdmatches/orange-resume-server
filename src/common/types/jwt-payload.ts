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
