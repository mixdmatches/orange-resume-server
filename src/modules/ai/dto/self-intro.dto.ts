import { IsEnum, IsIn, IsNotEmpty, IsObject, IsString } from 'class-validator'

/** 自我介绍生成场景 */
export type SelfIntroScene = '校招' | '社招' | '实习'
/** 自我介绍生成语气 */
export type SelfIntroTone = '正式' | '轻松'

/** 自我介绍生成选项（与前端 aiAPIConnect.ts 保持一致） */
export class SelfIntroOptionsDto {
  @IsEnum(['校招', '社招', '实习'], { message: 'scene 只能是 校招 / 社招 / 实习' })
  scene!: SelfIntroScene

  @IsIn([1, 3, 5], { message: 'duration 只能是 1 / 3 / 5（分钟）' })
  duration!: 1 | 3 | 5

  @IsEnum(['正式', '轻松'], { message: 'tone 只能是 正式 / 轻松' })
  tone!: SelfIntroTone
}

/** 自我介绍流式生成 DTO */
export class SelfIntroDto {
  /** 简历纯文本内容 */
  @IsNotEmpty({ message: 'resumeText 不能为空' })
  @IsString({ message: 'resumeText 必须为字符串' })
  resumeText!: string

  /** 生成选项 */
  @IsNotEmpty({ message: 'options 不能为空' })
  @IsObject({ message: 'options 必须为对象' })
  options!: SelfIntroOptionsDto
}
