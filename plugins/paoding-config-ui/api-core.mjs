/**
 * dsh-paoding 配置后端核心 —— DSH Web 插件 (plugins/paoding-config-ui)
 * 的路由层适配：复用 tools/install.mjs 的检测与生成管线。
 *
 * 提供：检测状态收集（缓存）、状态序列化、生成/安装。零运行时依赖。
 */
import os from 'node:os'
import path from 'node:path'
import { collectState, generateAndInstall } from '../../tools/install.mjs'

export function resolveDshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

export function resolveConfigFile() {
  return process.env.DSH_PAODING_CONFIG || path.join(resolveDshHome(), 'dsh-paoding.config.yml')
}

// ── state cache ─────────────────────────────────────────────────────────────

let stateCache = null
let stateError = null

export async function getState(runtimeFacts = null) {
  // 传入运行时事实（rescan / 首屏首次加载）时总是先带着最新事实重刷一次，
  // 再返回缓存；不传则沿用旧语义（命中缓存直接返回，未命中再刷）。
  if (runtimeFacts !== null) {
    await refreshState(runtimeFacts)
    if (stateError) throw stateError
    return stateCache
  }
  if (stateCache) return stateCache
  await refreshState()
  if (stateError) throw stateError
  return stateCache
}

/** 是否有可用的状态缓存（供路由层决定是否值得带运行时事实重刷）。 */
export function hasStateCache() {
  return stateCache !== null
}

export async function refreshState(runtimeFacts = null) {
  stateError = null
  try {
    stateCache = await collectState({
      dshHome: resolveDshHome(),
      configFile: resolveConfigFile(),
      cwd: process.env.DSH_PAODING_CWD || process.cwd(),
      // 运行时事实透传给 collectState（不传时默认 null，走纯文件扫描旧逻辑）
      runtimeFacts: runtimeFacts ?? null,
    })
  } catch (err) {
    stateCache = null
    stateError = err
  }
}

/** Serialize the state into a JSON-safe view for the UI. */
export function serializeState(s) {
  const staticBase = {}
  for (const role of Object.keys(s.staticBase)) staticBase[role] = [...s.staticBase[role]]

  const blocks = {}
  for (const [role, b] of s.blocks) blocks[role] = [...b.names]

  const personas = {}
  for (const [role, p] of s.personaBlocks) personas[role] = p.text

  return {
    dshHome: s.dshHome,
    configFile: s.configFile,
    effectiveProfile: s.effectiveProfile,
    inventory: [...s.inventory].sort(),
    mcpReports: s.mcpReports,
    pluginReports: s.pluginReports,
    scanned: s.scanned,
    skills: s.skills,
    staticBase,
    blocks,
    personas,
    restrictBase: [...s.restrictBase],
    existing: s.existing,
    suggested: s.suggested,
    // 主 persona 尾部追加的默认常量（供 UI「人设追加」默认展示 / 恢复默认）
    mainPersonaExtraDefault: s.mainPersonaExtraDefault ?? null,
    // 运行时识别结果透传（字段缺失视为未启用运行时检测，与旧版 UI 行为一致）
    runtimePlugins: Array.isArray(s.runtimePlugins) ? s.runtimePlugins : [],
    runtimeOk: !!s.runtimeOk,
    runtimeError: s.runtimeError ?? null,
  }
}

/** Compose + (optionally) install from a UI-supplied assignments object. */
export function installAssignments(state, assignments, { dryRun = false, saveConfigOnWrite = false } = {}) {
  if (!assignments || typeof assignments !== 'object') {
    throw new Error('missing assignments object')
  }
  return generateAndInstall(state, assignments, { dryRun, saveConfigOnWrite })
}
