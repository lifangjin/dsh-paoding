/**
 * dsh-paoding 配置后端核心 —— DSH Web 插件 (plugins/paoding-config-ui)
 * 的路由层适配：复用 tools/install.mjs 的检测与生成管线。
 *
 * 提供：检测状态收集（缓存）、状态序列化（含 workspaceMeta 工作区元数据）、
 * 生成/安装（支持按工作区落独立 preset）、首装/升级后的 preset 自动重生成
 * （ensurePresetInstalled，等价 install --auto 语义）。零运行时依赖。
 */
import os from 'node:os'
import path from 'node:path'
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { assignSlugs, collectState, generateAndInstall, presetIdOf } from '../../tools/install.mjs'
import { autoAssignments } from '../../tools/lib/alloc.mjs'

export function resolveDshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

export function resolveConfigFile() {
  return process.env.DSH_PAODING_CONFIG || path.join(resolveDshHome(), 'dsh-paoding.config.yml')
}

// ── state cache ─────────────────────────────────────────────────────────────

let stateCache = null
let stateError = null
// 采集 stateCache 时的配置文件 mtime（null = 采集时配置不存在 / 不可读）：
// 供 isStateCacheStale 做外部改动对账——外部（CLI / 手编）改过配置后，面板
// 不再拿着陈旧缓存 apply 覆盖丢失外部修改。
let stateCacheMtimeMs = null

/** 配置文件当前 mtime；读不到（不存在 / 无权限）返回 null。 */
function configMtimeMs() {
  try {
    return statSync(resolveConfigFile()).mtimeMs
  } catch {
    return null
  }
}

/**
 * 缓存是否已落后于磁盘配置（无缓存视为失效）。命中缓存时 stat 一次配置文件
 * 对账 mtime：变了说明外部改过，调用方应重刷（带运行时事实的重刷在路由层）。
 */
export function isStateCacheStale() {
  if (stateCache === null) return true
  return configMtimeMs() !== stateCacheMtimeMs
}

export async function getState() {
  // 纯读缓存：命中且配置文件 mtime 未变直接返回；缺失 / 已失效再重刷（不带
  // 运行时事实——是否带事实由路由层 helper 决定，见 index.mjs）。
  if (!isStateCacheStale()) return stateCache
  await refreshState()
  if (stateError) throw stateError
  return stateCache
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
    stateCacheMtimeMs = null
    stateError = err
    return
  }
  // 记录采集时刻的配置文件 mtime，作为后续外部改动对账的基准
  stateCacheMtimeMs = configMtimeMs()
}

/** Serialize the state into a JSON-safe view for the UI. */
export function serializeState(s) {
  const staticBase = {}
  for (const role of Object.keys(s.staticBase)) staticBase[role] = [...s.staticBase[role]]

  const blocks = {}
  for (const [role, b] of s.blocks) blocks[role] = [...b.names]

  const personas = {}
  for (const [role, p] of s.personaBlocks) personas[role] = p.text

  // 已落盘 preset 目录名透传（orchestrator + orchestrator-<slug>，供工作区
  // 元数据对账；字段缺失视为无 —— 老版本 collectState 产出的状态同样可用）
  const installedPresets = Array.isArray(s.installedPresets) ? s.installedPresets : []
  // 工作区元数据：现有配置里每个工作区路径的 slug / presetId / preset 是否已
  // 生成。整组路径过一次 assignSlugs（与生成层同源），保证 slug 与落盘目录名
  // 一致；existing 本身随上方透传，这里只补派生视图。
  const workspaceMeta = {}
  const wsSlugs = assignSlugs(Object.keys((s.existing && s.existing.workspaces) || {}))
  for (const [wsPath, slug] of wsSlugs) {
    const presetId = presetIdOf(slug)
    workspaceMeta[wsPath] = { slug, presetId, installed: installedPresets.includes(presetId) }
  }

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
    installedPresets,
    workspaceMeta,
    // 主 persona 尾部追加的默认常量（供 UI「人设追加」默认展示 / 恢复默认）
    mainPersonaExtraDefault: s.mainPersonaExtraDefault ?? null,
    // 运行时识别结果透传（字段缺失视为未启用运行时检测，与旧版 UI 行为一致）
    runtimePlugins: Array.isArray(s.runtimePlugins) ? s.runtimePlugins : [],
    runtimeOk: !!s.runtimeOk,
    runtimeError: s.runtimeError ?? null,
  }
}

/** Compose + (optionally) install from a UI-supplied assignments object.
 *  workspacePath 非 null 时为该工作区生成独立 preset（见 generateAndInstall）。 */
export function installAssignments(state, assignments, { dryRun = false, saveConfigOnWrite = false, workspacePath = null } = {}) {
  if (!assignments || typeof assignments !== 'object') {
    throw new Error('missing assignments object')
  }
  return generateAndInstall(state, assignments, { dryRun, saveConfigOnWrite, workspacePath })
}

// ── 首装 / 升级后 preset 自动重生成 ─────────────────────────────────────────
//
// 唯一官方安装通道是插件通道（dsh plugin add dsh-paoding），包不再携带 CLI：
// preset 的落盘改由插件启动时自愈——目录缺失（首装）或由旧版生成器产出（升级
// 换包）时，按 install --auto 语义重生成一次。对账基准是 preset 目录里的
// .generator-version 标记文件（内容 = 生成器版本）：插件包版本变 → 标记不符 →
// 下次启动自动重生成，一举解决「升级后 preset 还是旧版产物」的漂移问题。

// 生成器版本（标记对账基准）：插件包根 package.json 读一次即缓存。读失败兜底
// '0.0.0'——最坏后果只是每次启动多重生成一次 preset，不会装坏任何东西。
let cachedGeneratorVersion = null

/** 插件包版本（package.json version；读失败兜底 '0.0.0'）。 */
export function pluginVersion() {
  if (cachedGeneratorVersion !== null) return cachedGeneratorVersion
  try {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
    if (typeof pkg?.version === 'string' && pkg.version !== '') cachedGeneratorVersion = pkg.version
  } catch { /* 读不到 / 解析失败：走兜底值 */ }
  return cachedGeneratorVersion ?? '0.0.0'
}

// dispose 中止时的返回理由（记 reason 而非 error：不算失败，调用方不打日志）。
const PRESET_ENSURE_ABORTED = '插件已卸载（dispose），本次 preset 生成中止'

/**
 * 首装 / 升级后自动重生成 orchestrator preset（等价 install --auto 语义）。
 *
 * 判定：preset 目录缺失，或 .generator-version 标记缺失 / 版本与 generatorVersion
 * 不符 → 执行一次自动安装：局部 collectState()（不带运行时事实的纯文件扫描，
 * 首装触发点在插件启动、宿主服务未必就绪，且与 CLI --auto 语义对齐；不走
 * refreshState()——那会拿无事实的扫描覆盖路由层的共享缓存）后按既有配置合成
 * assignments（无配置写基础模板），经 generateAndInstall 落盘，最后写标记文件。
 * shouldAbort 在各 await 点后检查：插件 dispose 后在途的生成不再继续写盘。
 * 可脱离 ctx 独立调用（单测友好），任何异常自捕、绝不抛出。
 *
 * @param {{dshHome?: string, generatorVersion?: string, shouldAbort?: () => boolean}} opts
 *   缺省取 resolveDshHome() 与 pluginVersion()；shouldAbort 返回 true 时中止
 *   （按 reason 返回，不算 error）。
 * @returns {Promise<{installed: boolean, reason?: string, error?: string}>}
 *   installed=true 表示本次实际重生成；false 时带 reason（无需重生成 / 已中止）
 *   或 error（生成失败，调用方只记日志）。
 */
export async function ensurePresetInstalled({ dshHome = resolveDshHome(), generatorVersion = pluginVersion(), shouldAbort = null } = {}) {
  try {
    const presetDir = path.join(dshHome, '.agent-presets', 'orchestrator')
    const markerFile = path.join(presetDir, '.generator-version')
    let marker = null
    try {
      marker = (await readFile(markerFile, 'utf8')).trim()
    } catch { /* 目录或标记缺失：按未生成处理 */ }
    if (marker === generatorVersion) {
      return { installed: false, reason: 'preset 已由当前版本生成器产出，无需重生成' }
    }

    if (shouldAbort?.()) return { installed: false, reason: PRESET_ENSURE_ABORTED }
    const state = await collectState({
      dshHome,
      configFile: resolveConfigFile(),
      cwd: process.env.DSH_PAODING_CWD || process.cwd(),
      runtimeFacts: null,
    })
    if (shouldAbort?.()) return { installed: false, reason: PRESET_ENSURE_ABORTED }
    const assignments = autoAssignments({
      existing: state.existing,
      suggested: state.suggested,
      staticBase: state.staticBase,
    })
    const result = generateAndInstall(state, assignments, {
      dryRun: false,
      // 与 CLI --auto 同款：fresh 把基础模板落进配置文件（显式锚定「未开启
      // host 工具」）；有配置时绝不覆写用户配置。
      saveConfigOnWrite: !state.existing,
    })
    if (!result.wrote) throw new Error('preset 生成未落盘')

    // 标记最后写：generateAndInstall 会整目录重建（rmSync），先写必被删。
    if (shouldAbort?.()) return { installed: false, reason: PRESET_ENSURE_ABORTED }
    mkdirSync(presetDir, { recursive: true })
    writeFileSync(markerFile, `${generatorVersion}\n`, 'utf8')
    return {
      installed: true,
      reason: state.existing
        ? 'preset 缺失或由旧版生成器产出，已按现有配置重新生成'
        : 'preset 缺失或由旧版生成器产出，已写入基础模板',
    }
  } catch (err) {
    // 绝不抛：首装自愈是锦上添花，失败只带回 error 交调用方记日志，不拖垮插件启动。
    return { installed: false, error: String(err?.message ?? err) }
  }
}

// ── 工作区候选发现（「添加工作区」组合框的服务端候选扫描）──────────────────

// home 直属目录黑名单：系统 / 媒体目录不算项目。正常情况它们也不带项目标记，
// 这份名单是双保险——万一哪天 Desktop 里翻出个带 .git 的东西也拦得住。
const HOME_DIR_SKIP = new Set([
  'Library', 'Applications', 'Desktop', 'Downloads', 'Movies', 'Music',
  'Pictures', 'Public', 'Documents',
])

// 单个目录命中的项目标记：.git / .codegraph 目录、package.json 文件，
// 返回标记名（进候选的 marker 字段，客户端可据此展示）；一个都没有返回 null。
function projectMarkerOf(dirPath) {
  const markers = [
    ['.git', 'isDirectory'],
    ['.codegraph', 'isDirectory'],
    ['package.json', 'isFile'],
  ]
  for (const [name, check] of markers) {
    try {
      if (statSync(path.join(dirPath, name))[check]()) return name
    } catch { /* 无此标记（或不可读）：换下一个接着看 */ }
  }
  return null
}

/**
 * 扫描「添加工作区」的候选目录。扫描面刻意收窄（有界，不深递归）：
 * 已知路径的父目录一层 + home 一层，各自只看直属子目录。只收带项目标记的
 * 真实目录；已在注册表 / 配置里的路径不再建议；单个父目录读不了（权限、
 * 不存在等）就地跳过，绝不让整个发现失败。返回 { path, basename, marker }[]，
 * 按 basename 排序，最多 50 条（截断不算错误）。
 */
export function discoverWorkspaceCandidates({ registryPaths = [], configPaths = [], home = os.homedir() } = {}) {
  // 已知路径集合：候选与它们撞车就没有建议价值了
  const known = new Set()
  for (const p of [...registryPaths, ...configPaths]) {
    if (typeof p === 'string' && p !== '') known.add(path.resolve(p))
  }

  // 待扫父目录：home 兜底 + 已知路径的父目录（Set 天然去重）
  const parents = new Set([home])
  for (const p of known) parents.add(path.dirname(p))

  const seen = new Set()
  const items = []
  for (const parent of parents) {
    let entries
    try {
      entries = readdirSync(parent, { withFileTypes: true })
    } catch { /* 读不了这层就跳过这层：发现是锦上添花，不值得为一个目录报错 */ continue }
    for (const ent of entries) {
      // 只收真实目录；symlink 不跟进，扫描面才守得住「有界」
      if (!ent.isDirectory()) continue
      if (parent === home && HOME_DIR_SKIP.has(ent.name)) continue
      const dirPath = path.join(parent, ent.name)
      const resolved = path.resolve(dirPath)
      if (known.has(resolved) || seen.has(resolved)) continue
      const marker = projectMarkerOf(dirPath)
      if (!marker) continue // 裸目录：没有项目依据，不进候选
      seen.add(resolved)
      items.push({ path: dirPath, basename: ent.name, marker })
    }
  }

  items.sort((a, b) => a.basename.localeCompare(b.basename))
  return items.slice(0, 50)
}
