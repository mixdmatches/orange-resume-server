export interface JwtPayload {
  /** 当前登录用户 ID，对应用户表主键 */
  userId: number
  /** 当前登录用户名 */
  username: string
}

export type JwtTokenType = 'access' | 'refresh'
