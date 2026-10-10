/**
 * 委派子代理标签带角色名（delegation-labels.mjs）
 *
 * Part of the dsh-paoding 编排模式 (orchestrator) preset. 主 agent 委派角色
 * （implement / design / search_external 及自定义角色）时，委派工具调用的
 * `description` 参数会成为子会话的持久 label——任务管理页（better-sidebar）、
 * 原生会话头的子代理目录树、后台任务列表展示的都是它。编排模型随手写的
 * description 只是一句任务短语，扫一眼分不清哪条子代理是谁在干活；本插件在
 * `tools/pre-execute` 瀑布上把命中角色的委派调用改写成 `角色名 · 原任务短语`
 * （如「民工码农 · 修复标签显示」），三处展示面统一带上角色名。
 *
 * 机制（提示词约束做不到的确定性改写）：
 *   dsh-tools 调度器在每次工具执行前跑 tools/pre-execute 瀑布，随后把同一个
 *   exec.arguments 对象原样交给工具本体。dsh-tool-subagent 的子会话 label、
 *   jobs.start 的 job label、startContinuable 的 label 三者都取自
 *   args.description，所以在这里原地改写该字段，下游一并生效，并随子会话
 *   descriptor 持久化。处理完必须 `return await next()` 放行——本插件只管
 *   标签，永不拦截委派。
 *
 * config.roles 由生成器按 dsh-paoding.config.yml 的 roles.<toolName>.name 填充
 * （toolName → 显示名）：没配名字的角色不进映射、标签保持原样；全空时本插件
 * 不注册任何处理器。幂等：已带 `角色名 · ` 前缀的 description 不重复加前缀
 * （同一次委派重复过瀑布也不会双写）。
 *
 * 失败面：整段 try/catch 包住，任何异常只 warn 一次后照常放行——标签出错顶多
 * 退回旧观感，绝不能拦掉一次委派。
 */

/** Cordis plugin name used by loader diagnostics. */
export const name = 'orchestrator-delegation-labels'

/** The waterfall rides on ctx events; tools guarantees the registry exists first. */
export const inject = ['tools']

/** 角色名与任务短语之间的缺省分隔符。 */
const DEFAULT_SEPARATOR = ' · '

/** 标签改写出错只提醒一次，避免每次委派都刷一条日志。 */
let warned = false

/**
 * @param {object} ctx - cordis context（事件瀑布 / logger）。
 * @param {{ separator?: string, roles?: Record<string, string> }} config
 *   生成器写入的角色显示名映射与可选分隔符。
 */
export function apply(ctx, config = {}) {
  const separator =
    typeof config.separator === 'string' && config.separator !== '' ? config.separator : DEFAULT_SEPARATOR
  // 只收非空显示名；一个名字都没有就什么都不注册（无事可做，零开销）。
  const displayNames = new Map()
  for (const [toolName, displayName] of Object.entries(config.roles ?? {})) {
    if (typeof toolName !== 'string' || toolName === '') continue
    if (typeof displayName !== 'string' || displayName.trim() === '') continue
    displayNames.set(toolName, displayName.trim())
  }
  if (displayNames.size === 0) return

  ctx.on('tools/pre-execute', async (exec, next) => {
    try {
      const toolName = exec?.name
      if (typeof toolName === 'string' && displayNames.has(toolName)) {
        const args = exec.arguments
        if (args !== null && typeof args === 'object') {
          const prefix = `${displayNames.get(toolName)}${separator}`
          const description = args.description
          // 非空字符串且未带前缀才改写（幂等：再次进瀑布不双写前缀）。
          if (typeof description === 'string' && description.trim() !== '' && !description.startsWith(prefix)) {
            args.description = `${prefix}${description}`
          }
        }
      }
    } catch (error) {
      if (!warned) {
        warned = true
        ctx.logger?.warn?.(`${name}: 标签前缀注入失败，本次按原 description 放行（后续不再提醒）: ${String(error)}`)
      }
    }
    return await next()
  })
}
