/** 新会话的默认标题（首条用户消息发出后自动用消息内容截取覆盖） */
export const DEFAULT_SESSION_TITLE = '新对话'

/** 标题截取长度（取首条用户消息前 50 个字符） */
export const TITLE_MAX_LENGTH = 50

/** 组装上下文时最多携带的历史消息条数（防止 token 超限） */
export const MAX_HISTORY_MESSAGES = 20
