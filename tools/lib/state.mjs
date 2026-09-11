/**
 * 公共状态管线：collectState（patch 分层扫描 / MCP 工具名解析 / 插件与技能检测 /
 * smart defaults，含可选 runtimeFacts 合并）与 generateAndInstall（compose +
 * yaml 校验 + dst 目录落盘 + saveConfig）。install.mjs 的公共导出
 * （collectState / generateAndInstall）即来自本模块。
 * 依赖 util / yaml / config / host / skills / spans / compose / alloc 与
 * node:fs / node:path；被 cli 与 plugins/paoding-config-ui 引用。
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
import { DEFAULT_MAIN_AGENT_PERSONA_EXTRA, ROLES, SRC_DIR, warn } from './util.mjs'
import { flattenEntries, loadYaml, parsePatchFile } from './yaml.mjs'
import { loadConfig, normalizeMainAgentName, saveConfig, yamlScalar } from './config.mjs'
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

/**
 * Reusable state collection for the CLI and the visual config UI.
 * Runs the whole detection pipeline (patch scan, MCP handshakes, plugin and
 * skill detection, smart defaults) and returns everything the generator needs,
 * without writing anything or prompting. Throws on hard errors.
 *
 * `runtimeFacts`（可选，仅 Web 配置器经 ctx 传入）是运行时优先的补充事实：
 * { ok, error?, pluginEntries, toolNames }，来自 plugins/paoding-config-ui/
 * runtime-inventory.mjs。不传时整段合并逻辑跳过，行为与旧版完全一致；传入时
 * 把 preset 未覆盖的运行时工具并进 inventory / mcpReports / pluginReports，
 * 让 bundle 形态加载的插件（@hyzyn/dsh-codegraph、dsh-mnemon 等）也能被识别。
 * 文件扫描路径（KNOWN_HOST_PLUGINS 白名单等）始终保持为兜底，不动。
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
  let restrictBase
  try {
    restrictBase = extractMainAgentAllow(restrictSrc)
  } catch (err) {
    throw new Error(err.message)
  }

  // Load the existing config (null when absent); its profile wins unless an
  // explicit profile was given.
  let existing = null
  try {
    existing = loadConfig(configFile, yamlMod)
  } catch (err) {
    throw new Error(err.message)
  }
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

  const skills = detectSkills(dshHome, cwd)
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
 * Compose, validate and (unless dry-run) install the generated preset from an
 * assignments object. Shared by the CLI and the visual config UI.
 * Returns { text, roleResults, staleNote, wrote }.
 */
export function generateAndInstall(state, assignments, { dryRun = false, saveConfigOnWrite = false } = {}) {
  const { srcText, blocks, personaBlocks, inventory, restrictBase, yamlMod, dshHome, cwd, dstDir, dstAgentFile, configFile, scanned, effectiveProfile } = state

  // Pre-read the SKILL.md metas of the skills selected for the main-agent
  // persona (soft rows via main_agent_skills + optional hard inlining via
  // main_agent_skills_inline; union, deduped).  Names whose file is missing
  // simply do not enter the map — composeGenerated warns about them.
  const softNames = (assignments?.main_agent_skills ?? []).filter((n) => typeof n === 'string' && n !== '')
  const hardNames = (assignments?.main_agent_skills_inline ?? []).filter((n) => typeof n === 'string' && n !== '')
  const mainAgentSkillMetas = {}
  for (const name of [...new Set([...softNames, ...hardNames])]) {
    const hit = findSkillMeta(name, dshHome, cwd)
    if (hit) mainAgentSkillMetas[name] = hit
  }

  // Compose the generated config; a composition error is a hard error.
  let composed
  try {
    composed = composeGenerated(srcText, blocks, personaBlocks, assignments, inventory, restrictBase, mainAgentSkillMetas)
  } catch (err) {
    throw new Error(err.message)
  }
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

  let wrote = false
  if (!dryRun) {
    mkdirSync(path.join(dshHome, '.agent-presets'), { recursive: true })
    rmSync(dstDir, { recursive: true, force: true })
    mkdirSync(dstDir, { recursive: true })
    for (const name of ['preset.yml', 'restrict.mjs']) {
      const src = path.join(SRC_DIR, name)
      const dst = path.join(dstDir, name)
      const mainAgentName = normalizeMainAgentName(assignments?.main_agent_name ?? null)
      if (name === 'preset.yml' && mainAgentName !== null) {
        // main_agent_name 非空：preset 显示名改为配置名。读 SRC 文本、把首个
        // （非注释的）顶层 `name:` 行值替换为安全 yaml 标量（含 ':' / '#' 等时
        // 单引号包裹转义），其余字节原样；chmod 与下方一致。
        const presetText = readFileSync(src, 'utf8')
        const next = presetText.replace(/^name:.*$/m, `name: ${yamlScalar(mainAgentName)}`)
        if (next === presetText) {
          warn('preset.yml: 未找到可替换的顶层 name: 行（main_agent_name 未生效），已按原样写入')
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
      saveConfig(configFile, { profile: effectiveProfile, ...assignments })
    }
    wrote = true
  }

  return { text: generatedText, roleResults, staleNote, wrote }
}
