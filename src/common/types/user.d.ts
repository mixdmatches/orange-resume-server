export interface CreateUserInput {
  username: string
  email: string
  /** 原始明文密码，调用方不要提前哈希，由 Service 内部加密 */
  password: string
}

export interface UserProfile {
  id: number
  username: string
  email: string
  nickname: string | null
  avatar: string | null
}
