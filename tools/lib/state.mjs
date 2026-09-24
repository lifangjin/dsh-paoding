/**
 * 公共状态管线：collectState（patch 分层扫描 / MCP 工具名解析 / 插件与技能检测 /
 * smart defaults，含可选 runtimeFacts 合并 / 预设安装轨道探测 / 已落盘 preset
 * 目录扫描）与 generateAndInstall（compose + yaml 校验 + dst 目录落盘 +
 * saveConfig，支持按工作区落到 orchestrator-<slug> 独立 preset 目录并把条目
 * 并进配置 workspaces 段；配置读取失败 / 状态不可信时拒绝破坏性落盘，成功后
 * 回收孤儿工作区 preset；并按 presetSystem 双轨收尾——0.1.7+ 声明行轨把声明行
 * upsert 进 home patch 托管块，≤0.1.6 目录扫描轨撤掉残留声明块自愈）。
 * install.mjs 的公共导出（collectState / generateAndInstall）即来自本模块。
 * 依赖 util / yaml / config / host / skills / spans / compose / alloc /
 * workspaces / preset-system 与 node:fs / node:path / node:url；被 cli 与
 * plugins/paoding-config-ui 引用。
 */
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { DEFAULT_MAIN_AGENT_PERSONA_EXTRA, ROLES, SRC_DIR, warn } from './util.mjs'
import { flattenEntries, loadYaml, parsePatchFile } from './yaml.mjs'
import {
  loadConfig,
  normalizeRoleName,
  normalizeTargetFields,
  saveConfig,
  stripNonTargetKeys,
  yamlScalar,
} from './config.mjs'
import { assignSlugs, presetIdOf } from './workspaces.mjs'
import {
  extractMcp,
  isEntryEnabled,
  isMcpEntry,
  KNOWN_HOST_PLUGINS,
  pluginLabel,
  resolveMCP,
} from './host.mjs'
import { detectSkills, findSkillMeta } from './skills.mjs'
import { locateAllowBlocks, locatePersonaBlocks } from './spans.mjs'
import { composeGenerated, extractMainAgentAllow } from './compose.mjs'
import { smartDefaults } from './alloc.mjs'
import {
  buildPresetRowText,
  detectPresetSystem,
  listOrchestratorPresetIds,
  presetRowId,
  readHomePatchRows,
  readPresetDirMeta,
  stripHomePatchRows,
  upsertHomePatchRows,
} from './preset-system.mjs'

/**
 * Reusable state collection for the CLI and the visual config UI.
 * Runs the whole detection pipeline (patch scan, MCP handshakes, plugin and
 * skill detection, smart defaults) and returns everything the generator needs,
 * without writing anything or prompting. Throws on hard errors.
 *
 * `runtimeFacts`（可选，仅 Web 配置器经 ctx 传入）是运行时优先的补充事实：
 * { ok, error?, pluginEntries, toolNames, presetSystem }，来自
 * plugins/paoding-config-ui/runtime-inventory.mjs。不传时整段合并逻辑跳过，
 * 行为与旧版完全一致；传入时把 preset 未覆盖的运行时工具并进 inventory /
 * mcpReports / pluginReports，让 bundle 形态加载的插件（@hyzyn/dsh-codegraph、
 * dsh-mnemon 等）也能被识别；presetSystem（预设安装轨道）直接采信，免去
 * dsh --version 子进程探测。文件扫描路径（KNOWN_HOST_PLUGINS 白名单等）
 * 始终保持为兜底，不动。
 */
export async function collectState({ dshHome, configFile, profile = null, patches = [], cwd = process.cwd(), runtimeFacts = null }) {
  const dstDir = path.join(dshHome, '.agent-presets', 'orchestrator')
  const dstAgentFile = path.join(dstDir, 'agent.cordis.yml')

  // Source preset files must exist before anything else.
  const sourceFiles = ['agent.cordis.yml', 'preset.yml', 'restrict.mjs'].map((f) => path.join(SRC_DIR, f))
  for (const file of sourceFiles) {
    if (!existsSync(file)) throw new Error(`missing preset source file: ${file}`)
  }

  const yamlMod = loadYaml(dshHome)
  const srcText = readFileSync(path.join(SRC_DIR, 'agent.cordis.yml'), 'utf8')
  const restrictSrc = readFileSync(path.join(SRC_DIR, 'restrict.mjs'), 'utf8')

  // Locate role allow + persona blocks; failure is a hard error.
  let blocks
  let personaBlocks
  try {
    blocks = locateAllowBlocks(srcText, yamlMod)
    personaBlocks = locatePersonaBlocks(srcText, yamlMod)
  } catch (err) {
    throw new Error(`cannot locate role blocks in ${path.join(SRC_DIR, 'agent.cordis.yml')}: ${err.message}`)
  }
  // 这层包装无增值（错误文案原样透传），让原始错误直接上抛。
  const restrictBase = extractMainAgentAllow(restrictSrc)

  // Load the existing config (null when absent); its profile wins unless an
  // explicit profile was given. 读失败（存在但解析不了等）原样上抛，不做静默降级。
  const existing = loadConfig(configFile, yamlMod)
  const effectiveProfile = profile ?? existing?.profile ?? 'web'

  // Scan the patch layers (home, profile, extra --patch files) in order.
  const patchSources = [
    { path: path.join(dshHome, 'cordis.patch.yml'), explicit: false },
    { path: path.join(dshHome, 'profiles', effectiveProfile, 'cordis.patch.yml'), explicit: false },
    ...patches.map((p) => ({ path: path.resolve(p), explicit: true })),
  ]
  const entries = []
  const scanned = []
  for (const source of patchSources) {
    if (!existsSync(source.path)) {
      if (source.explicit) warn(`${source.path}: not found — skipped`)
      scanned.push({ path: source.path, status: 'missing' })
      continue
    }
    const data = parsePatchFile(source.path, yamlMod)
    if (data === null) {
      scanned.push({ path: source.path, status: 'unparseable' })
      continue
    }
    scanned.push({ path: source.path, status: 'parsed' })
    entries.push(...flattenEntries(data))
  }

  // Detect enabled MCP servers and local tool plugins.
  const mcps = []
  const pluginReports = []
  for (const entry of entries) {
    if (isMcpEntry(entry) && isEntryEnabled(entry)) {
      const mcp = extractMcp(entry)
      if (mcp) mcps.push(mcp)
      else warn(`MCP entry "${entry.name}" has no usable config (missing serverName/map) — skipped, its tools will be absent`)
    }
    if (typeof entry?.name === 'string') {
      for (const plugin of KNOWN_HOST_PLUGINS) {
        if (plugin.match.test(entry.name) && isEntryEnabled(entry) && entry.config?.enabled !== false) {
          pluginReports.push({ label: pluginLabel(plugin), tools: [...plugin.tools] })
        }
      }
    }
  }

  // Resolve exact MCP tool names into the detection inventory D.
  const inventory = new Set()
  const mcpReports = []
  for (const mcp of mcps) {
    const result = await resolveMCP(mcp)
    for (const tool of result.tools) inventory.add(`mcp__${mcp.serverName}__${tool}`)
    mcpReports.push({
      serverName: mcp.serverName,
      transport: mcp.transport,
      count: result.tools.length,
      source: result.source,
      error: result.error,
    })
  }
  for (const plugin of pluginReports) {
    for (const tool of plugin.tools) inventory.add(tool)
  }

  // 技能检测走全局语义（cwd 传 null，只扫用户级两根）：state.skills 是全局
  // 视角的用户级技能，不再跟随进程启动目录（GUI 场景下启动目录没有「当前
  // 项目」含义）；工作区视角的项目级技能由插件路由按工作区目录另行检测。
  // cwd 入参保留不动（patch 扫描外的其余用途与透传照旧）。
  const skills = detectSkills(dshHome, null)
  const staticBase = {}
  for (const role of ROLES) staticBase[role] = blocks.get(role).names
  const suggested = smartDefaults(mcpReports, inventory, staticBase)

  // ── 运行时事实合并（可选；CLI/无运行时不传 runtimeFacts，整段零开销跳过）──
  // preset 自带名（restrictBase + 各角色 staticBase）之外的运行时工具叫 extras，
  // 全部并进 inventory，UI 的角色候选 = blocks + inventory 立即可见；extra 里
  // mcp__<server>__<tool> 形态的按 server 补一份 runtime 来源的 mcpReports
  // （已有文件握手 report 的 server 不动）；pluginEntries 里非内置包（避开
  // @deepseek-ai/*、dsh-client*、cordis）的条目补进 pluginReports（工具数不填，
  // 无归属信息；白名单命中的以白名单精确清单优先）。整段 try/catch：任何一步
  // 失败只降级为少识别一部分，绝不影响文件扫描兜底结果。
  if (runtimeFacts !== null && Array.isArray(runtimeFacts.toolNames)) {
    try {
      // 1) preset 自带名称全集（注意 staticBase 的值是数组）
      const presetUniverse = new Set([...restrictBase, ...Object.values(staticBase).flat()])
      // 2) extras = 运行时注册表里 preset 未覆盖的名字（去重、保序）
      const extras = []
      for (const name of runtimeFacts.toolNames) {
        if (typeof name !== 'string' || name === '') continue
        if (!presetUniverse.has(name) && !extras.includes(name)) extras.push(name)
      }
      // 3) extras 全部并入检测库存 D
      for (const name of extras) inventory.add(name)

      // 4) extras 里 mcp__<server>__<tool> 按 server 分组补 mcpReports
      //    （非贪婪正则取第一个 __ 分隔：前缀为 server、后缀为 tool；
      //    server 名自带 '_' 时仅影响展示分组，不影响 inventory 本体）
      const runtimeMcp = new Map()
      for (const name of extras) {
        const m = /^mcp__(.+?)__(.+)$/.exec(name)
        if (m) {
          const group = runtimeMcp.get(m[1])
          if (group) group.push(name)
          else runtimeMcp.set(m[1], [name])
        }
      }
      for (const [serverName, names] of runtimeMcp) {
        if (mcpReports.some((r) => r.serverName === serverName)) continue // 握手结果优先
        mcpReports.push({ serverName, transport: undefined, count: names.length, source: 'runtime', error: undefined })
      }

      // 5) 运行时插件条目补进 pluginReports（过滤内置包避免刷屏）
      if (Array.isArray(runtimeFacts.pluginEntries) && runtimeFacts.pluginEntries.length > 0) {
        for (const e of runtimeFacts.pluginEntries) {
          const moduleName = typeof e?.moduleName === 'string' ? e.moduleName : ''
          if (moduleName === '') continue
          if (moduleName.startsWith('@deepseek-ai/')) continue
          if (moduleName.includes('dsh-client')) continue
          if (moduleName.includes('cordis')) continue
          if (pluginReports.some((p) => p.label === moduleName)) continue // 白名单已覆盖
          pluginReports.push({ label: moduleName, tools: [], runtime: true })
        }
      }
    } catch (err) {
      warn(`runtime facts merge failed (skipped, file-scan results kept): ${err?.message ?? err}`)
    }
  }

  // 预设安装轨道探测（declarative = 0.1.7+ 声明行轨 / directory = ≤0.1.6 目录
  // 扫描轨）。运行时事实里带 presetSystem（Web 插件对宿主服务的实时探测）时
  // 直接采信零开销；CLI / 首装链路没有运行时事实，走 dsh --version + 文件探测
  //（见 preset-system.detectPresetSystem 的降级链）。
  const presetSystem = await detectPresetSystem({ dshHome, runtimeSystem: runtimeFacts?.presetSystem ?? null })

  // 已落盘 preset 目录扫描（编排类）：.agent-presets 下的 orchestrator 基础
  // preset 与 orchestrator-<slug> 工作区专属 preset。扫描失败（目录尚不存在、
  // 无读权限等）一律降级为空列表，绝不影响检测结果本体；generateAndInstall
  // 成功落盘后以它为对账清单做孤儿工作区 preset 回收。两轨的产物目录同名同
  // 位置（.agent-presets/<presetId>/），这一扫描天然覆盖两轨的 installed 判定。
  const installedPresets = listOrchestratorPresetIds(dshHome)

  return {
    dshHome,
    cwd,
    dstDir,
    dstAgentFile,
    configFile,
    yamlMod,
    srcText,
    restrictSrc,
    blocks,
    personaBlocks,
    restrictBase,
    existing,
    effectiveProfile,
    scanned,
    mcpReports,
    pluginReports,
    inventory,
    skills,
    staticBase,
    suggested,
    // 已落盘的编排类 preset 目录名列表（含基础 orchestrator 与各工作区专属），
    // 供 UI 的 workspaceMeta 对账「该工作区 preset 是否已生成」。
    installedPresets,
    // 预设安装轨道（generateAndInstall 据此双轨收尾；serializeState 透传给面板）
    presetSystem,
    // 主 persona 尾部追加的默认常量（配置键 main_agent_persona_extra 缺省值）：
    // 供 UI state（serializeState → /api/paoding/state）展示与「恢复默认」用。
    mainPersonaExtraDefault: DEFAULT_MAIN_AGENT_PERSONA_EXTRA,
    // 运行时事实透传（原字段一个未动，仅追加；未传 runtimeFacts 时为空值，
    // serializeState 与既有消费者均按缺省处理，零回归）
    runtimePlugins: runtimeFacts?.pluginEntries ?? [],
    runtimeOk: !!runtimeFacts?.ok,
    runtimeError: runtimeFacts?.error ?? null,
  }
}

/**
 * SRC preset.yml 显示元数据（name / description / order）：声明行轨把这些值
 * 写进 home patch 声明行的 config，取值口径与目录轨写 preset.yml 完全同源
 * （name 可被 main_agent_display_name / 工作区派生名覆盖，见 generateAndInstall
 * 调用处）。解析实现已沉到 preset-system.readPresetDirMeta（迁移对账同源复用）。
 */
function readPresetMeta() {
  return readPresetDirMeta(SRC_DIR)
}

/**
 * Compose, validate and (unless dry-run) install the generated preset from an
 * assignments object. Shared by the CLI and the visual config UI.
 * Returns { text, roleResults, staleNote, wrote, presetId, presetSystem }.
 *
 * 破坏性落盘护栏：配置读取失败直接抛错中止（不静默降级 prev=null 继续装）；
 * 配置缺失（prev=null）而目标 preset 目录已存在时同样拒绝重建。落盘成功后对
 * state.installedPresets 做孤儿工作区 preset 回收（不被 workspaces 引用的
 * orchestrator-<slug> 目录 rmSync + warn；基础 preset 永不清）。
 *
 * 预设安装双轨收尾（wrote=true 才动，dry-run 零副作用）：
 *   - declarative（0.1.7+，目录扫描机制已删）：把本 preset 以一条 `- insert:`
 *     声明行 upsert 进 $DSH_HOME/cordis.patch.yml 托管块（restrict.mjs 用绝对
 *     file: URL）；孤儿工作区回收处同步撤对应声明行——目录与行同生同灭。
 *   - directory（≤0.1.6）：上面落盘即完成；home patch 里若有残留托管声明块
 *    （宿主刚从 0.1.7 降级等场景）整块撤下自愈——残留声明行会让 profile 启动
 *     失败。
 *
 * workspacePath（可选）：传工作区绝对路径时生成落到 orchestrator-<slug> 独立
 * preset 目录（slug 由磁盘配置现有 workspaces 键 ∪ 本路径统一分配，同名目录
 * 冲突自动加 hash 后缀），preset 显示名按 main_agent_display_name >
 * （工作区预设派生名）「SRC 名·目录名」取值，
 * 存盘只把该条目并进配置 workspaces 段（顶层字段维持磁盘现状）；不传（null）
 * 走全局路径，落点与存盘行为和旧版完全一致。
 */
export function generateAndInstall(state, assignments, { dryRun = false, saveConfigOnWrite = false, workspacePath = null } = {}) {
  const { srcText, blocks, personaBlocks, inventory, restrictBase, yamlMod, dshHome, configFile, scanned, effectiveProfile } = state

  // assignments 剥污染键：profile / workspaces 不属于目标字段，UI/CLI 透传
  // 一律丢弃，防其混进生成的 preset 或覆盖配置文件里对应的段。
  assignments = stripNonTargetKeys(assignments)

  // 预设安装轨道（collectState 已探测；缺省按目录轨兜底——安全侧，理由见
  // preset-system 模块头注释）
  const presetSystem = state.presetSystem ?? 'directory'

  // 工作区定位：路径归一（容忍尾斜杠 / 相对写法），空值一律视为全局。
  const wsPath = workspacePath === null || workspacePath === undefined || workspacePath === ''
    ? null
    : path.normalize(path.resolve(workspacePath))
  let dstDir = state.dstDir
  let presetId = 'orchestrator'

  // 配置现状读取（下方 slug 分配与 saveConfig 合并共用这一次，避免双读漂移）：
  // 读失败（存在但解析不了 / 权限错）直接抛错中止 —— 旧版静默降级 prev=null 后
  // 继续 rmSync / 覆写配置，等于对着不可信状态做破坏性落盘，已收紧为硬错误。
  let prev = null
  try {
    prev = loadConfig(configFile, yamlMod)
  } catch (err) {
    throw new Error(`现有配置 ${configFile} 读取失败，已中止（未做任何落盘）: ${err.message}`)
  }

  if (wsPath !== null) {
    // slug 取自磁盘配置的 workspaces 键集合 ∪ 本路径（prev 已在上方统一读取）：
    // 整组统一分配才能让同 basename 的冲突方都拿到稳定的 hash 后缀。
    const wsPaths = Object.keys(prev?.workspaces ?? {})
    if (!wsPaths.includes(wsPath)) wsPaths.push(wsPath)
    presetId = presetIdOf(assignSlugs(wsPaths).get(wsPath))
    dstDir = path.join(dshHome, '.agent-presets', presetId)
  }
  const dstAgentFile = path.join(dstDir, 'agent.cordis.yml')

  // Pre-read the SKILL.md metas of the skills selected for the main-agent
  // persona (soft rows via main_agent_skills + optional hard inlining via
  // main_agent_skills_inline; union, deduped).  技能按生成目标解析：工作区
  // 目标用该工作区目录（wsPath，已归一为绝对路径）追加项目级两根，可解析该
  // 工作区项目根里的技能（SKILL.md 绝对路径写进 persona，供主 agent read 按
  // 需读）；全局目标传 null 只解析用户级。Names whose file is missing
  // simply do not enter the map — composeGenerated warns about them.
  const skillCwd = wsPath
  const softNames = (assignments?.main_agent_skills ?? []).filter((n) => typeof n === 'string' && n !== '')
  const hardNames = (assignments?.main_agent_skills_inline ?? []).filter((n) => typeof n === 'string' && n !== '')
  const mainAgentSkillMetas = {}
  for (const name of [...new Set([...softNames, ...hardNames])]) {
    const hit = findSkillMeta(name, dshHome, skillCwd)
    if (hit) mainAgentSkillMetas[name] = hit
  }

  // Compose the generated config; a composition error is a hard error.
  //（这层包装无增值，让 composeGenerated 的原始错误直接上抛。）
  const composed = composeGenerated(srcText, blocks, personaBlocks, assignments, inventory, restrictBase, mainAgentSkillMetas)
  const generatedText = composed.text
  const roleResults = composed.roleResults

  // Validate the generated YAML before writing anything.
  if (yamlMod) {
    // `!!js <expr>` 是 cordis 的 JS 表达式标签（tool-bash / tool-pwsh 的平台开关
    // 用）。本校验只关心结构合法性、不求值表达式：dsh loadYaml 的默认 schema 未
    // 注册该标签，直接解析会对每行打 TAG_RESOLVE_FAILED 噪音警告。这里在「校验
    // 副本」上把 !!js 标量换成占位 true 再解析；生成文本原样写入，表达式求值仍
    // 由 cordis 装载时完成，语义零影响。
    const validateText = generatedText.replace(/!!js\s+[^\r\n]*/g, 'true')
    try {
      yamlMod.parse(validateText)
    } catch (err) {
      throw new Error(`generated agent.cordis.yml fails yaml validation: ${err.message}`)
    }
  }

  // Freshness note: any parsed patch file modified after the last generated
  // agent.cordis.yml means the user should rerun the installer after changes.
  let staleNote = false
  if (existsSync(dstAgentFile)) {
    const targetMtime = statSync(dstAgentFile).mtimeMs
    staleNote = scanned.some(
      (s) => s.status === 'parsed' && existsSync(s.path) && statSync(s.path).mtimeMs > targetMtime,
    )
  }

  // preset.yml 显示名，两级优先：main_agent_display_name（仅显示名键，persona
  // 身份行不可改名）> 工作区预设派生名（wsPath 非空且未设显示名时取
  // 「SRC preset.yml 的 name 值·工作区目录名」，让预设选择器能分清多个工作区）；
  // 全局路径未设显示名时维持 SRC 原名（行为与旧版一致）。displayNameSource
  // 记住显示名来自哪个键：找不到可替换的 name: 行时 warn 按真实来源归因
  // （派生名不来自任何键，单独措辞）。
  let displayName = normalizeRoleName(assignments?.main_agent_display_name ?? null, 'main_agent_display_name')
  let displayNameSource = displayName !== null ? 'main_agent_display_name' : null
  if (displayName === null && wsPath !== null) {
    try {
      const srcPresetText = readFileSync(path.join(SRC_DIR, 'preset.yml'), 'utf8')
      const m = /^name:[ \t]*(.+?)[ \t]*$/m.exec(srcPresetText)
      if (m) displayName = `${m[1]}·${path.basename(wsPath)}`
    } catch {
      /* SRC preset 不可读 / 无 name 行：维持原名不改 */
    }
  }

  let wrote = false
  if (!dryRun) {
    // 破坏性落盘护栏：配置不可信（读取失败已在上方抛错中止；此处 prev=null =
    // 配置文件缺失）而目标 preset 目录已存在时，拒绝 rmSync 重建与随后的配置
    // 覆写 —— 对着未知状态动刀可能毁掉用户仅存的落盘 preset。全新安装（无配置
    // 且无目录）不受影响，仍照常装。
    if (prev === null && existsSync(dstDir)) {
      throw new Error(
        `配置文件 ${configFile} 缺失但 preset 目录已存在（${dstDir}），已拒绝破坏性重建；` +
          '请先恢复配置文件，或手动删除该目录后重试',
      )
    }
    mkdirSync(path.join(dshHome, '.agent-presets'), { recursive: true })
    rmSync(dstDir, { recursive: true, force: true })
    mkdirSync(dstDir, { recursive: true })
    for (const name of ['preset.yml', 'restrict.mjs']) {
      const src = path.join(SRC_DIR, name)
      const dst = path.join(dstDir, name)
      if (name === 'preset.yml' && displayName !== null) {
        // 显示名非空（配置了 main_agent_display_name 或工作区预设派生名）：读
        // SRC 文本、把首个（非注释的）顶层 `name:` 行值替换为安全 yaml 标量
        //（含 ':' / '#' 等时单引号包裹转义），其余字节原样；chmod 与下方一致。
        const presetText = readFileSync(src, 'utf8')
        const next = presetText.replace(/^name:.*$/m, `name: ${yamlScalar(displayName)}`)
        if (next === presetText) {
          warn(`preset.yml: 未找到可替换的顶层 name: 行（${displayNameSource ?? '工作区派生显示名'} 未生效），已按原样写入`)
        }
        writeFileSync(dst, next)
      } else {
        copyFileSync(src, dst)
      }
      chmodSync(dst, statSync(src).mode & 0o777) // preserve source permissions
    }
    writeFileSync(path.join(dstDir, 'agent.cordis.yml'), generatedText)
    chmodSync(path.join(dstDir, 'agent.cordis.yml'), statSync(path.join(SRC_DIR, 'agent.cordis.yml')).mode & 0o777)
    if (saveConfigOnWrite) {
      // 合并写盘（prev 已在函数开头读过，读失败早已中止，此处不做二次静默降
      // 级）：全局应用只写顶层目标字段、workspaces 段原样保留；工作区应用只把
      // 该条目并进 workspaces 段、顶层字段（含 profile）维持磁盘现状——两个对
      // 象互不踩。顶层字段经 normalizeTargetFields 保留键存在性标记
      // （has_main_agent_extra），老配置没有的键保存后仍缺省。
      const next = wsPath === null
        ? {
            profile: effectiveProfile,
            ...normalizeTargetFields(assignments),
            workspaces: prev?.workspaces ?? {},
          }
        : {
            profile: prev?.profile ?? effectiveProfile,
            ...normalizeTargetFields(prev),
            workspaces: { ...(prev?.workspaces ?? {}), [wsPath]: normalizeTargetFields(assignments) },
          }
      saveConfig(configFile, next)
    }
    wrote = true
  }

  // ── 孤儿工作区 preset 回收（成功落盘后对账）──
  // installedPresets 里 orchestrator-<slug> 形态、且不被配置 workspaces 任一条目
  // （含本次并入的 wsPath）引用的目录按孤儿回收（rmSync + warn 行）。护栏：基础
  // preset（orchestrator）与本次刚重建的 dstDir 永不清；prev 不可信（null，配置
  // 缺失 / 未读到）时整体跳过 —— 没有可信引用清单可对账，宁可残留也不误删；
  // 删除失败只 warn 保留，绝不让回收拖垮本次安装结果。
  if (wrote && prev !== null && Array.isArray(state.installedPresets)) {
    const wsEntries = Object.keys(prev.workspaces ?? {})
    if (wsPath !== null && !wsEntries.includes(wsPath)) wsEntries.push(wsPath)
    const referenced = new Set([...assignSlugs(wsEntries).values()].map(presetIdOf))
    for (const name of state.installedPresets) {
      if (name === 'orchestrator' || referenced.has(name)) continue
      const dir = path.join(dshHome, '.agent-presets', name)
      if (dir === dstDir) continue // 本次刚写出的目标目录绝不清
      if (!existsSync(dir)) continue // 扫描后已被外部删除：无事可做
      try {
        rmSync(dir, { recursive: true, force: true })
        warn(`孤儿工作区 preset 已回收: ${dir}（配置 workspaces 已无引用）`)
      } catch (err) {
        warn(`孤儿工作区 preset 回收失败（已保留）: ${dir}: ${err?.message ?? err}`)
        continue
      }
      if (presetSystem === 'declarative') {
        // 声明行轨：目录回收了，home patch 托管块里的对应声明行同步撤下——
        // 目录与行必须同生同灭，否则 0.1.7 宿主会挂出一个指向已删目录的 preset。
        try {
          stripHomePatchRows(dshHome, [presetRowId(name)])
        } catch (err) {
          warn(`孤儿 preset 的声明行撤除失败（${presetRowId(name)}）: ${err?.message ?? err}`)
        }
      }
    }
  }

  // ── 预设安装双轨收尾（wrote=true 才动；dry-run 零副作用）────────────────
  // declarative（0.1.7+）：目录扫描机制已删，必须把本 preset 以一条 `- insert:`
  // 声明行写进 home patch 托管块才算安装完成（preset 元信息与写 preset.yml 同
  // 源：显示名取 displayName ?? SRC preset.yml 的 name，description / order 取
  // SRC；restrict.mjs 用绝对 file: URL——声明行没有「相对 preset 目录」语义）。
  // directory（≤0.1.6）：上面落盘即完成；home patch 里若有残留托管声明块
  //（宿主刚从 0.1.7 降级等场景）整块撤下自愈——残留声明行会让 profile 启动失败。
  if (wrote) {
    if (presetSystem === 'declarative') {
      const meta = readPresetMeta()
      upsertHomePatchRows(dshHome, [
        buildPresetRowText({
          presetId,
          name: displayName ?? meta.name,
          description: meta.description,
          order: meta.order,
          agentYmlText: generatedText,
          restrictFileUrl: pathToFileURL(path.join(dstDir, 'restrict.mjs')).href,
        }),
      ])
    } else if (readHomePatchRows(dshHome).length > 0) {
      stripHomePatchRows(dshHome, null)
      warn('cordis.patch.yml 检出 dsh-paoding 声明块，但当前宿主是目录扫描轨（DSH ≤ 0.1.6），已整块撤下（残留声明行会导致 profile 启动失败）')
    }
  }

  return { text: generatedText, roleResults, staleNote, wrote, presetId, presetSystem }
}
