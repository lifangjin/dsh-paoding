/**
 * 底层常量与最小工具：仓库路径（REPO_ROOT / SRC_DIR —— lib 模块位于
 * <root>/tools/lib/，上跳两层即仓库根；旧单文件 install.mjs 位于 <root>/tools/
 * 上跳一层，二者推导结果相同）、内置角色名（ROLES）、主 persona 尾部追加默认值
 * （DEFAULT_MAIN_AGENT_PERSONA_EXTRA）与 warn()。
 * 本模块不依赖任何 lib 兄弟模块，供全部其它模块引用。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const SRC_DIR = path.join(REPO_ROOT, 'presets', 'orchestrator')

export const ROLES = ['search_external', 'design', 'implement']

/**
 * profile 名白名单（bin/dsh-paoding.mjs 与 lib/cli.mjs 两处共用，抽在此处防两边
 * 漂移）：首字符字母数字，其余限 [A-Za-z0-9._-] —— profile 名会被拼进 dsh 子进程
 * 命令行（win32 经 shell 拼接），在解析源头就排除空格与 shell 元字符。
 */
export const PROFILE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/**
 * 主 agent persona 尾部追加规则（默认值）。
 * 用户可在配置 UI 的「人设追加」里编辑/清空；配置键 main_agent_persona_extra：
 * null/缺省 = 用本默认；'' = 明确清空（不追加）；其他字符串 = 覆盖。
 * {{cwd}}/{{model}} 是 persona 模板占位符，DSH 运行时替换，必须原样保留。
 */
export const DEFAULT_MAIN_AGENT_PERSONA_EXTRA = `Codegraph MCP default project may be a DIFFERENT repository than {{cwd}}. Never call codegraph_* tools without passing projectPath = {{cwd}} (the absolute path of your working directory). If {{cwd}} has no .codegraph index, fall back to glob/grep/read directly and do not loop or comment on project mismatches.`

export function warn(message) {
  console.warn(`warning: ${message}`)
}
