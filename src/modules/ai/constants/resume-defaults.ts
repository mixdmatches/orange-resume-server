/**
 * AI 模块需要的简历默认值常量
 * 对应前端 src/config/init-resume-data.ts 的内容
 * 用于 PDF 转 JSON 接口中，当模型返回缺少字段时进行兜底填充
 * 注意：此处保持静态对象，不依赖 Node.js 环境变量
 */

/** 初始全局配置（与前端保持一致） */
export const INITIAL_GLOBAL_CONFIGURATION = {
  baseFontSize: 14,
  basePagePadding: 20,
  baseLineHeight: 1.5,
  baseModuleSpacing: 10,
  paragraphSpacing: 10,
  titleFontSize: 16,
  subTitleFontSize: 14,
  themeColor: '#111827',
  fontFamily: '"Alibaba PuHuiTi", sans-serif',
  autoOnePage: false,
}

/** 默认菜单模块顺序 */
export const DEFAULT_MENU_SECTIONS = [
  { id: 'basic', title: '基本信息', order: '1' },
  { id: 'education', title: '教育经历', order: '2' },
  { id: 'internship', title: '实习经历', order: '3' },
  { id: 'project', title: '项目经历', order: '4' },
  { id: 'skills', title: '个人技能', order: '5' },
]

/** 默认模板 ID */
export const DEFAULT_TEMPLATE_ID = 'classic'

/** 默认简历标题前缀（PDF 导入后使用） */
export const DEFAULT_TITLE_PREFIX = 'PDF导入的简历'

/** 基本信息中照片配置的默认值（与前端保持一致） */
export const DEFAULT_PHOTO_CONFIG = {
  aspectRatio: '',
  width: 90,
  height: 120,
  visible: true,
  borderRadius: 5,
  customBorderRadius: 0,
}
