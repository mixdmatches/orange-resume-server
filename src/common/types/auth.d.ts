/**
 * 登录成功返回结构（双 Token 版本）
 */
export interface LoginResult {
  /** 访问令牌（默认 2h 过期）：所有业务接口的通行证 */
  accessToken: string
  /** 刷新令牌（默认 7d 过期）：accessToken 过期后用它换新，平时不参与业务请求 */
  refreshToken: string
  /** 当前用户公开资料（不含 passwordHash） */
  userInfo: UserProfile
}

/**
 * JWT 签发载荷：在用户标识基础上附加 token 类型（access/refresh）
 */
type SignPayload = JwtPayload & { type: JwtTokenType }
