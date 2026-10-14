/**
 * 结构化配置体检（save-time config health check）：把散落在生成期 console.warn
 * 里的告警（fork+model 互斥、roles_remove 命中 start_mode 等）与「配置了但宿主
 * 未挂载」「零工具角色」「未知模型」「预设漂移」四类静默问题收口成
 * { items: [{ level: 'error'|'warn'|'info', code, message }] }，随面板 preview /
 * apply 响应的 warnings 字段与 CLI --dry-run 报告透传（面板渲染由客户端批次做，
 * 本模块只负责产出结构化字段）。
 *
 * 检查项一览（每项一个独立函数，可单测）：
 *   - unmounted_tool (warn)：assignments 配置的具体工具名（roles.*.tools 与
 *     main_agent_extra）不在 presetUniverse ∪ inventory。白名单语义与生成层
 *     filterUsableTools 同源（不另立判断，防两处漂移）；含 `*`/`?` 的条目跳过
 *     （glob 支持由另一批次实现，这里不抢）。
 *   - zero_tool_role (error)：内置角色过滤后 allow 为空（提前给可读信息；
 *     composeGenerated 的既有 throw 行为不变，体检在前、throw 兜底）；自定义
 *     角色 tools 为空同口径（renderCustomRoleBlocks 的 throw 同样不动）。
 *   - unknown_model (warn)：roles.*.model 配了但模型目录（models，可选）查无
 *     此名；models 为 null（CLI / 面板模型目录拿不到）时整项跳过。
 *   - preset_drift (info)：已安装预设与当前配置的再生成结果不一致（复用
 *     generateAndInstall 的 dryRun 产物文本对比；dryRunResult 已由调用方传入时
 *     直接消费，不再重跑生成）。
 *   - generation (warn)：生成期 warn 原样透传（captureWarnings 接管 console.warn
 *     抓取 warning: 前缀行），不重复实现判定逻辑。
 *
 * 依赖 util（ROLES）、compose（filterUsableTools）、state（generateAndInstall，
 * 仅在未拿到 dryRunResult 时做一次 dry-run 预演）；被 api-core / cli / doctor
 * 引用。healthCheck 自身绝不 throw——体检坏了不该连带请求 500。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { ROLES } from './util.mjs'
import { filterUsableTools } from './compose.mjs'
import { generateAndInstall } from './state.mjs'

const WARN_PREFIX = 'warning: '

/**
 * 临时接管 console.warn，收集窗口期内所有告警行。返回 [fn() 结果, 消息数组]；
 * 消息剥掉 util.warn 的 `warning: ` 前缀（透传给结构化 items 的 message 用）。
 * 非字符串参数取 message 字段或 String() 兜底；finally 里必还原，fn 抛错也
 * 不吞——需要「抓告警 + 容错」的调用方自己包 try/catch（见 installAssignments）。
 */
export function captureWarnings(fn) {
  const messages = []
  const original = console.warn
  console.warn = (...args) => {
    const text = args.map((a) => (typeof a === 'string' ? a : String(a?.message ?? a))).join(' ')
    messages.push(text.startsWith(WARN_PREFIX) ? text.slice(WARN_PREFIX.length) : text)
  }
  let result
  try {
    result = fn()
  } finally {
    console.warn = original
  }
  return [result, messages]
}

/** 体检结果条目工厂：统一形状，防各检查项字段漂移。 */
function item(level, code, message) {
  return { level, code, message }
}

/**
 * presetUniverse（restrict.mjs 主 agent 白名单 ∪ 源 preset 各角色 allow 自带面），
 * 与 composeGenerated 同一构造。state 必须是原始 collectState 产物（blocks 是
 * Map）——序列化视图喂进来 blocks 不可枚举时按空面兜底（结果只会多报
 * unmounted_tool warn，不会误报 error）。
 */
function presetUniverseOf(state) {
  const universe = new Set(Array.isArray(state.restrictBase) ? state.restrictBase : [])
  if (state.blocks instanceof Map) {
    for (const block of state.blocks.values()) {
      for (const name of block.names) universe.add(name)
    }
  }
  return universe
}

/** inventory 兜底：原始 state 是 Set；容一个数组形态（序列化视图误入时）。 */
function inventoryOf(state) {
  return state.inventory instanceof Set
    ? state.inventory
    : new Set(Array.isArray(state.inventory) ? state.inventory : [])
}

/** assignments 里配置的具体工具名 → [{ name, where }]（roles.*.tools + main_agent_extra）。 */
function configuredToolRefs(assignments) {
  const refs = []
  const roles = assignments && typeof assignments.roles === 'object' && assignments.roles !== null ? assignments.roles : {}
  for (const [role, conf] of Object.entries(roles)) {
    if (!conf || typeof conf !== 'object') continue
    const tools = Array.isArray(conf.tools) ? conf.tools : []
    for (const tool of tools) {
      if (typeof tool === 'string' && tool !== '') refs.push({ name: tool, where: `roles.${role}.tools` })
    }
  }
  const extra = Array.isArray(assignments?.main_agent_extra) ? assignments.main_agent_extra : []
  for (const tool of extra) {
    if (typeof tool === 'string' && tool !== '') refs.push({ name: tool, where: 'main_agent_extra' })
  }
  return refs
}

/** 收集 roles.*.model 引用（[{ toolName, model }]，trim 后非空才算配置了）。 */
export function collectModelRefs(assignments) {
  const refs = []
  const roles = assignments && typeof assignments.roles === 'object' && assignments.roles !== null ? assignments.roles : {}
  for (const [toolName, conf] of Object.entries(roles)) {
    if (!conf || typeof conf !== 'object') continue
    if (typeof conf.model === 'string' && conf.model.trim() !== '') {
      refs.push({ toolName, model: conf.model.trim() })
    }
  }
  return refs
}

// ── 检查项：unmounted_tool ──────────────────────────────────────────────────

/**
 * 配置了但当前未挂载（presetUniverse ∪ inventory 都查无）的工具名。可用性判定
 * 直接复用生成层的 filterUsableTools（同一白名单语义，零漂移）；`*`/`?` 通配
 * 条目跳过（glob 支持另一批次实现）。
 */
function checkUnmountedTools(refs, presetUniverse, inventory) {
  const names = [...new Set(refs.map((r) => r.name))]
  const kept = new Set(filterUsableTools(names, presetUniverse, inventory))
  const items = []
  const seen = new Set()
  for (const { name, where } of refs) {
    if (name.includes('*') || name.includes('?')) continue
    if (kept.has(name)) continue
    const key = `${name}\u0000${where}`
    if (seen.has(key)) continue
    seen.add(key)
    items.push(item('warn', 'unmounted_tool', `已配置但当前未挂载：${name}（${where}）`))
  }
  return items
}

// ── 检查项：zero_tool_role ──────────────────────────────────────────────────

/**
 * 过滤后工具为空的角色。意图（intent）取法与 composeGenerated 逐字对齐：
 * 显式 `tools: []` 就按空算（不回落源模板 allow），只有键缺省才回落 blocks；
 * 自定义角色不经过滤、tools 为空即零工具（与 renderCustomRoleBlocks 同口径）。
 * 只产 error 条目，不在本层拦下生成——composeGenerated 的既有 throw 照旧兜底。
 */
function checkZeroToolRoles(assignments, state, presetUniverse, inventory) {
  const items = []
  const roles = assignments && typeof assignments.roles === 'object' && assignments.roles !== null ? assignments.roles : {}
  const removedRoles = new Set(Array.isArray(assignments?.roles_remove) ? assignments.roles_remove : [])
  const blocks = state.blocks instanceof Map ? state.blocks : null
  for (const role of ROLES) {
    if (removedRoles.has(role)) continue
    const conf = roles[role] && typeof roles[role] === 'object' ? roles[role] : null
    const intent = Array.isArray(conf?.tools) ? conf.tools : (blocks?.get(role)?.names ?? [])
    if (filterUsableTools(intent, presetUniverse, inventory).length === 0) {
      items.push(
        item(
          'error',
          'zero_tool_role',
          `角色 ${role} 过滤后没有任何可用工具（零工具角色会被拒绝安装）：` +
            `请在配置里为它勾选至少一个已挂载工具，或加入 roles_remove 删除该角色`,
        ),
      )
    }
  }
  for (const [toolName, conf] of Object.entries(roles)) {
    if (ROLES.includes(toolName)) continue
    const tools = Array.isArray(conf?.tools) ? conf.tools : []
    if (tools.length === 0) {
      items.push(
        item(
          'error',
          'zero_tool_role',
          `自定义角色 ${toolName} 没有配置任何工具（零工具角色会被拒绝安装）：请在配置里为它写 tools 列表`,
        ),
      )
    }
  }
  return items
}

// ── 检查项：unknown_model ───────────────────────────────────────────────────

/** 模型目录（面板 models 路由的 groups 形状）→ 已知模型 id 集合；容忍扁平 id 数组。 */
function knownModelIds(models) {
  const ids = new Set()
  if (!Array.isArray(models)) return ids
  for (const entry of models) {
    if (typeof entry === 'string' && entry !== '') {
      ids.add(entry)
      continue
    }
    if (!entry || typeof entry !== 'object') continue
    if (typeof entry.id === 'string' && entry.id !== '') ids.add(entry.id)
    if (Array.isArray(entry.models)) {
      for (const model of entry.models) {
        if (typeof model === 'string' && model !== '') ids.add(model)
        else if (model && typeof model.id === 'string' && model.id !== '') ids.add(model.id)
      }
    }
  }
  return ids
}

/** roles.*.model 配了但目录查无 → warn。models 为 null（拿不到目录）整项跳过。 */
function checkUnknownModels(assignments, models) {
  if (models === null || models === undefined) return []
  const known = knownModelIds(models)
  if (known.size === 0) return []
  return collectModelRefs(assignments)
    .filter(({ model }) => !known.has(model))
    .map(({ toolName, model }) =>
      item('warn', 'unknown_model', `roles.${toolName}.model: '${model}' 不在当前模型目录中（名单以设置页模型选择器为准，配错会被静默回落）`),
    )
}

// ── 检查项：preset_drift ────────────────────────────────────────────────────

/**
 * 已安装预设 vs 再生成结果：对比 dryRunResult.text 与落盘的 agent.cordis.yml
 * （按 dryRunResult.presetId 定位，工作区预设同样适用）。文本一致 → 无条目；
 * 落盘文件缺失（未安装）→ info 条目提示应用后生成；内容有差 → info「落后于
 * 配置」。拿不到 dryRunResult（调用方没生成过）时返回空，由调用方决定是否
 * 先做 dry-run 预演再传入。
 */
function checkPresetDrift(state, dryRunResult) {
  if (!dryRunResult || typeof dryRunResult.text !== 'string') return []
  const presetId = typeof dryRunResult.presetId === 'string' && dryRunResult.presetId !== '' ? dryRunResult.presetId : 'orchestrator'
  const dshHome = typeof state.dshHome === 'string' ? state.dshHome : null
  if (!dshHome) return []
  let installed = null
  try {
    installed = readFileSync(path.join(dshHome, '.agent-presets', presetId, 'agent.cordis.yml'), 'utf8')
  } catch {
    installed = null
  }
  if (installed === dryRunResult.text) return []
  return [
    item(
      'info',
      'preset_drift',
      installed === null
        ? `预设 ${presetId} 尚未安装：应用一次（面板「保存并应用」或 CLI --auto）即生成`
        : `预设 ${presetId} 落后于配置，重新应用即同步`,
    ),
  ]
}

// ── 入口 ────────────────────────────────────────────────────────────────────

/**
 * 跑全套体检，返回 { items }。参数：
 *   - state：原始 collectState 产物（restrictBase / blocks / inventory / dshHome）。
 *   - assignments：待检的目标字段集合（配置面板提交形状或 loadConfig 产物）。
 *   - models：模型目录（面板 models 路由的 groups 数组）；null = 跳过 unknown_model。
 *   - dryRunResult：调用方已有的 generateAndInstall 产物（preview/apply 顺路传入，
 *     不重跑生成）；null 时本函数自己跑一次 dry-run 预演（doctor / 直接调用）。
 *   - generationWarnings：调用方在其生成窗口内用 captureWarnings 抓到的告警
 *     （installAssignments 传入，避免同一次生成跑两遍）；null 且无 dryRunResult
 *     时由本函数的预演自行抓取。
 * 任何内部失败都折成条目（generation_error），本函数自身不 throw。
 */
export function healthCheck({ state, assignments, models = null, dryRunResult = null, generationWarnings = null } = {}) {
  const items = []
  if (!state || typeof state !== 'object') return { items }

  const presetUniverse = presetUniverseOf(state)
  const inventory = inventoryOf(state)

  // 生成（或复用调用方产物）与生成期告警：三条互斥路径——
  //   1) dryRunResult 已给 → 全复用，零重跑；
  //   2) 只有 generationWarnings（原生成已失败，installAssignments 容错路径）
  //      → 消费现成告警，不再重跑（失败场景重跑只会复现同一个错）；
  //   3) 都没有 → 自己做一次 dry-run 预演并抓告警；预演失败折成 generation_error。
  let result = dryRunResult
  let warns = Array.isArray(generationWarnings) ? generationWarnings : null
  if (result === null && warns === null) {
    try {
      const [ran, captured] = captureWarnings(() => generateAndInstall(state, assignments ?? {}, { dryRun: true }))
      result = ran
      warns = captured
    } catch (err) {
      items.push(item('error', 'generation_error', `生成预演失败：${err?.message ?? err}`))
    }
  }

  items.push(...checkUnmountedTools(configuredToolRefs(assignments), presetUniverse, inventory))
  items.push(...checkZeroToolRoles(assignments, state, presetUniverse, inventory))
  items.push(...checkUnknownModels(assignments, models))
  if (Array.isArray(warns)) {
    for (const message of warns) items.push(item('warn', 'generation', message))
  }
  items.push(...checkPresetDrift(state, result))
  return { items }
}
