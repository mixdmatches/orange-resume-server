// ESLint 9 Flat Config（扁平化配置）
// 说明：ESLint 9 开始废弃 .eslintrc.*，改用单一导出的配置数组。
//       本文件通过 typescript-eslint 的 config() 辅助函数组合多个配置块。
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended";

export default tseslint.config(
	// ============== 全局忽略（纯 ignores 块对所有文件生效）==============
	{
		ignores: [
			"dist/**", // 构建产物
			"node_modules/**", // 依赖
			"prisma/**", // Prisma schema 与迁移文件（非 TS）
			"eslint.config.mjs", // 本配置文件自身
		],
	},

	// ============== 基础推荐规则（针对 JS）==============
	eslint.configs.recommended,

	// ============== TypeScript 推荐规则（针对 .ts/.tsx/.mts）==============
	...tseslint.configs.recommended,

	// ============== 项目自定义规则覆盖 ==============
	{
		rules: {
			// 关闭 any 类型警告：NestJS 的 DTO/拦截器等场景常用 any 做通用处理
			"@typescript-eslint/no-explicit-any": "off",
			// 未使用变量改为 warn（不阻断构建），并忽略以下划线开头的参数/变量
			// 例如 main.ts 中的 operationIdFactory: (_controllerKey, methodKey) => methodKey
			"@typescript-eslint/no-unused-vars": [
				"warn",
				{
					argsIgnorePattern: "^_",
					varsIgnorePattern: "^_",
					caughtErrorsIgnorePattern: "^_",
				},
			],
		},
	},

	// ============== Prettier 集成 ==============
	// eslint-plugin-prettier/recommended 会自动：
	// 1. 加载 eslint-config-prettier（关闭所有与 Prettier 冲突的格式化规则）
	// 2. 设置 'prettier/prettier': 'error'（把不符合 .prettierrc 的代码当作 ESLint 错误）
	// 3. 读取项目根目录的 .prettierrc 作为格式化标准
	eslintPluginPrettierRecommended,
);
