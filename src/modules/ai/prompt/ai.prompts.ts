import { ChatPromptTemplate } from '@langchain/core/prompts'

/** 连接测试的固定系统提示词 */
export const CONNECTION_TEST_SYSTEM = '你正在进行连接测试，请忽略此内容。只需回复一个字'

/** PDF 简历解析 prompt*/
export const pdfToJsonPrompt = ChatPromptTemplate.fromMessages([
  [
    'system',
    `请将以下简历内容解析为JSON格式，包含以下字段：
- templateId:'classic'
- createdAt: 此时此刻的时间Date.now()格式
- updatedAt: null
- basic: {{ name, phone, email, address, position, photo, photoConfig: {{
    aspectRatio: string
    width: number
    height: number
    visible: false
    borderRadius: number
    customBorderRadius: number
  }} }}
- educations: [{{ id, school, major, degree, dateRange, description, visible: true }}]
- internships: [{{ id, companyName, position, dateRange, description, visible: true }}]
- projects: [{{ id, name, role, gitAddress, dateRange, description, visible: true }}]
- skills: string
id 暂时先不给
整体 JSON 字段与 Resume 类型完全一致。
globalConfiguration 使用：{globalConfiguration}`,
  ],
  ['human', '简历内容：\n{pdfText}'],
])

/** 语法纠错 prompt*/
export const checkGrammarPrompt = ChatPromptTemplate.fromMessages([
  [
    'system',
    `你是专业的中文文案校对专家。请检查简历文本中的：错别字、语病、标点错误、中英文混用问题、冗余表达。

严格输出以下 JSON 格式（不要输出任何其他内容）：
{{
  "issues": [
    {{
      "section": "项目经历-XX项目",
      "original": "原句片段",
      "suggestion": "修改后的句子",
      "reason": "错别字：'在'应为'再'",
      "severity": "error"
    }}
  ]
}}

要求：
1. 如果没有任何问题，返回 {{"issues": []}}
2. severity 只能是 "error"（错别字、语病）或 "warning"（标点、冗余）
3. original 必须是简历中真实存在的原文片段
4. reason 要简短说明问题原因`,
  ],
  ['human', '{resumeText}'],
])

/** 简历质量评分 prompt */
export const scoreResumePrompt = ChatPromptTemplate.fromMessages([
  [
    'system',
    `你是资深 HR 简历审核官，请从以下 6 个维度给简历打分（每项 0-100）：
1. 内容详实度：是否有量化数据、具体成果、明确职责
2. 结构清晰度：模块顺序、逻辑、排版是否合理易读
3. 技能匹配度：技能描述是否准确、分类是否清晰、是否体现竞争力
4. 项目深度：项目描述是否体现技术难点、个人贡献、业务价值
5. 语言表达：是否简洁、专业、无冗余无语病
6. 差异化亮点：是否有脱颖而出的经历、成就或特色

严格输出以下 JSON 格式（不要输出任何其他内容）：
{{
  "totalScore": 78,
  "dimensions": [
    {{ "name": "内容详实度", "score": 80, "comment": "..." }},
    {{ "name": "结构清晰度", "score": 70, "comment": "..." }},
    {{ "name": "技能匹配度", "score": 85, "comment": "..." }},
    {{ "name": "项目深度", "score": 75, "comment": "..." }},
    {{ "name": "语言表达", "score": 82, "comment": "..." }},
    {{ "name": "差异化亮点", "score": 72, "comment": "..." }}
  ],
  "overallComment": "总体评价，100-200字，用口语化但专业的语气。",
  "top3Issues": ["改进1", "改进2", "改进3"],
  "top3Highlights": ["亮点1", "亮点2", "亮点3"]
}}`,
  ],
  ['human', '{resumeText}'],
])

/** 简历与 JD 匹配度分析 prompt */
export const jobMatchPrompt = ChatPromptTemplate.fromMessages([
  [
    'system',
    `你是一位资深技术招聘官，需要评估候选人简历与岗位描述（JD）的匹配度。

严格输出以下 JSON 格式（不要输出任何其他内容）：
{{
  "matchScore": 78,
  "matchedSkills": ["React", "TypeScript"],
  "missingSkills": ["Webpack", "Node.js"],
  "highlights": [
    {{ "section": "项目经历", "point": "有完整的从0到1项目落地经验" }}
  ],
  "weaknesses": [
    {{ "section": "技能", "point": "缺少岗位要求的后端经验" }}
  ],
  "suggestions": [
    "建议在项目描述中补充性能优化数据",
    "建议增加一个体现团队协作的经历"
  ]
}}

评估要求：
1. matchScore 为 0-100 的整数，综合反映匹配程度
2. matchedSkills / missingSkills 只放技能关键词，不要长句
3. highlights / weaknesses 的 section 要对应简历模块名
4. suggestions 要具体可执行，3-5 条`,
  ],
  ['human', '简历内容：\n{resumeText}\n\n岗位描述（JD）：\n{jobDescription}'],
])

/** 面试题生成 prompt */
export const interviewQuestionsPrompt = ChatPromptTemplate.fromMessages([
  [
    'system',
    `你是一个专业的技术面试官，擅长根据候选人的简历提出针对性的面试问题。
请根据提供的简历内容，生成 {count} 个高质量的面试问题，涵盖以下方面：
1. 技术能力和技能验证
2. 项目经验和深度
3. 解决问题的能力

每个问题后请提供一个参考回答，用"回答："开头。
输出格式要求：
Q1: [问题1]
回答：[参考回答1]

Q2: [问题2]
回答：[参考回答2]

...以此类推`,
  ],
  ['human', '根据以下简历生成面试问题：\n\n{resumeContent}'],
])

/** 自我介绍生成 prompt */
export const selfIntroPrompt = ChatPromptTemplate.fromMessages([
  [
    'system',
    `你是一位帮助求职者撰写自我介绍的专家。请根据简历生成一段自我介绍。

要求：
- 场景：{scene}
- 时长：{duration} 分钟（约 {wordCount} 字）
- 语气：{tone}
- 结构：开场问候 → 个人亮点 → 核心项目/经历（用 STAR 法则） → 技能匹配岗位 → 结尾期待
- 用第一人称，口语化但专业，可以直接念出来
- 用 Markdown 输出，段落间用空行分隔，重点加粗
- 不要输出标题（如"自我介绍"），直接从问候语开始`,
  ],
  ['human', '简历内容：\n{resumeText}\n\n请生成自我介绍'],
])
