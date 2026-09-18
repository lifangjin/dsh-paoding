/**
 * CLI 层：参数解析与帮助（parseArgs / printHelp）、检测报告（printReport）与
 * 主流程（main，供 tools/install.mjs 直接运行）。
 *
 * 官方安装通道是 DSH 插件通道（dsh plugin --profile web add dsh-paoding），
 * npm 包不再携带 CLI 入口；本 CLI 仅作仓库内不宣传的开发兜底（--auto /
 * --dry-run / --config / --help）。交互模式已整块移除：可视化配置走插件通道
 * 自带的 Web 配置器（设置 → 庖丁配置）。
 *
 * 依赖 util（ROLES / SRC_DIR / PROFILE_NAME_RE）、config（normalizeRoleName）、
 * host（removedReason）、state（collectState /
 * generateAndInstall）、alloc（autoAssignments，--auto 语义与插件首装共享）、
 * version（getVersionInfo，main 收尾的新版提示）以及 node:os / node:path。
 */
import { homedir } from 'node:os'
import path from 'node:path'
import { PROFILE_NAME_RE, ROLES, SRC_DIR } from './util.mjs'
import { normalizeRoleName } from './config.mjs'
import { removedReason } from './host.mjs'
import { collectState, generateAndInstall } from './state.mjs'
import { autoAssignments } from './alloc.mjs'
import { getVersionInfo } from './version.mjs'

// ── CLI ─────────────────────────────────────────────────────────────────────

export function printHelp() {
  console.log(`dsh-paoding installer — dev fallback installer for the orchestrator preset
(host-aware tool filtering)

官方安装通道是 DSH 插件通道（本 CLI 仅作仓库内开发兜底，不作宣传）：

  dsh plugin --profile web add dsh-paoding

可视化配置随插件通道自带：DSH Web 设置 → 庖丁配置。

Usage:
  node tools/install.mjs [options]

Options:
  --profile <name>   Profile whose patch layer is scanned (default: web).
                     Reads $DSH_HOME/profiles/<name>/cordis.patch.yml; skipped
                     when the file does not exist.
  --patch <file>     Extra patch file(s) to scan, in addition to the home and
                     profile layers (repeatable).
  --config <file>    Configuration file with role/tool assignments
                     (default: $DSH_HOME/dsh-paoding.config.yml).
  --auto             Non-interactive: apply the config file when present,
                     otherwise apply the base template (--suggest seeds smart
                     defaults on a fresh install instead).
  --dry-run          Print the detection report and the generated allow lists
                     without writing anything; exit 0.
  --suggest          Fresh install without a config file: seed smart defaults
                     from the detected host/MCP tools instead of the base
                     template (host tools are folded in automatically).
  --help             Show this help and exit.

Environment:
  DSH_HOME           Directory holding cordis.patch.yml etc. (default: $HOME/.dsh)

With --auto and no config file, a base template is written: only the dsh
built-in tools stay enabled — add host/MCP tools afterwards in 设置 → 庖丁配置
(visual config UI from the plugin channel).  Pass --suggest to fall back to
the smart defaults that fold detected host tools in automatically.`)
}

// --profile 值白名单：与 bin/dsh-paoding.mjs 共用同一份 PROFILE_NAME_RE（抽在
// util 防两处漂移）。profile 名会被拼进 dsh 子进程命令行，解析源头只收常规名称。
function assertProfileName(value) {
  if (!PROFILE_NAME_RE.test(value)) {
    throw new Error(`error: --profile 只收常规名称（字母数字开头，仅限 [A-Za-z0-9._-]）: ${value}`)
  }
}

export function parseArgs(argv) {
  const opts = { profile: null, patches: [], dryRun: false, help: false, auto: false, config: undefined, suggest: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') {
      opts.help = true
    } else if (arg === '--dry-run') {
      opts.dryRun = true
    } else if (arg === '--auto') {
      opts.auto = true
    } else if (arg === '--suggest') {
      // fresh 安装时用智能默认（自动纳入检测到的 host 工具）而非基础模板。
      opts.suggest = true
    } else if (arg === '--config') {
      const value = argv[++i]
      if (value === undefined || value.startsWith('--')) {
        throw new Error('error: --config requires a file path')
      }
      opts.config = value
    } else if (arg.startsWith('--config=')) {
      // 等号形式同样校验空串（--config= 与缺值同款报错）。
      const value = arg.slice('--config='.length)
      if (value === '') {
        throw new Error('error: --config requires a file path')
      }
      opts.config = value
    } else if (arg === '--profile') {
      const value = argv[++i]
      if (value === undefined || value.startsWith('--')) {
        throw new Error('error: --profile requires a value')
      }
      assertProfileName(value)
      opts.profile = value
    } else if (arg.startsWith('--profile=')) {
      // 等号形式：空串与缺值同款报错；值同样过 PROFILE_NAME_RE 白名单。
      const value = arg.slice('--profile='.length)
      if (value === '') {
        throw new Error('error: --profile requires a value')
      }
      assertProfileName(value)
      opts.profile = value
    } else if (arg === '--patch') {
      const value = argv[++i]
      if (value === undefined || value.startsWith('--')) {
        throw new Error('error: --patch requires a file path')
      }
      opts.patches.push(value)
    } else if (arg.startsWith('--patch=')) {
      opts.patches.push(arg.slice('--patch='.length))
    } else {
      throw new Error(`error: unknown option: ${arg}\nrun with --help for usage`)
    }
  }
  return opts
}

// ── report & install ────────────────────────────────────────────────────────

export function printReport({ scanned, mcpReports, pluginReports, roleResults, dstDir, dryRun, staleNote, mainAgent }) {
  const pad = (s, n) => String(s).padEnd(n)
  console.log('dsh-paoding installer — orchestrator preset (host-aware tool filtering)')
  console.log(`  preset source : ${SRC_DIR}`)
  console.log(`  target        : ${dstDir}${dryRun ? '  [dry-run: nothing will be written]' : ''}`)
  console.log()
  console.log('patch layers scanned:')
  for (const s of scanned) {
    const status =
      s.status === 'parsed' ? '' : s.status === 'missing' ? '  (skipped: not found)' : '  (skipped: unparseable)'
    console.log(`  - ${s.path}${status}`)
  }
  console.log()
  console.log('detected host tools:')
  if (mcpReports.length > 0) {
    console.log('  mcp servers:')
    for (const r of mcpReports) {
      // 来源标签：runtime（运行时注册表合并，见 state.collectState 的 runtimeFacts
      // 段）排最前，与握手 / 静态表并列展示，不再误落「handshake failed」档。
      const sourceLabel =
        r.source === 'runtime' ? 'runtime registry'
        : r.source === 'static' ? 'static table'
        : r.source === 'handshake' ? 'live handshake'
        : 'handshake failed'
      const count = r.error ? `0 tools (${r.error})` : `${r.count} tool${r.count === 1 ? '' : 's'}`
      console.log(`    ${pad(r.serverName, 16)}${pad(r.transport ?? '-', 20)}${count}  (${sourceLabel})`)
    }
  } else {
    console.log('  mcp servers: none enabled')
  }
  if (pluginReports.length > 0) {
    console.log('  local plugins:')
    for (const p of pluginReports) {
      console.log(`    ${pad(p.label, 16)}${pad('plugin', 20)}${p.tools.join(', ')}  (enabled)`)
    }
  } else {
    console.log('  local plugins: none detected')
  }
  console.log()
  console.log('role allow lists (intent -> kept):')
  for (const rr of roleResults) {
    console.log(`  ${pad(rr.role, 16)} ${rr.intent.length} -> ${rr.kept.length}`)
  }
  if (mainAgent) {
    console.log(`  ${pad('主 agent', 16)} ${mainAgent.baseCount} 基础 + ${mainAgent.extra.length} 追加 − ${mainAgent.removed.length} 移除`)
    if (mainAgent.removed.length > 0) console.log(`    removed: ${mainAgent.removed.join(', ')}`)
  }
  const removed = roleResults.flatMap((rr) =>
    rr.removed.map((name) => ({ role: rr.role, name, reason: removedReason(name, mcpReports) })),
  )
  if (removed.length > 0) {
    console.log('  removed (would fail tools.restrict() at runtime if left in):')
    for (const r of removed) {
      console.log(`    - [${r.role}] ${r.name}  (${r.reason})`)
    }
  } else {
    console.log('  removed: none — every host-dependent allow entry is enabled')
  }
  if (staleNote) {
    console.log('\nnote: 检测到 patch 配置在本次安装后有过修改，改动后请重跑 node tools/install.mjs --auto')
  }
  console.log()
  console.log(
    `${dryRun ? '[dry-run] would write' : 'wrote'} ${path.join(dstDir, 'agent.cordis.yml')}` +
      (dryRun ? '' : ' (allow lists rewritten)'),
  )
  console.log(`${dryRun ? '[dry-run] would copy' : 'copied'} preset.yml, restrict.mjs as-is`)
  if (!dryRun) {
    console.log()
    console.log('next steps:')
    console.log('  1. restart the dsh host (or create a new session)')
    console.log('  2. pick 「编排模式 (Orchestrator)」 in the new-session preset selector')
    console.log('     (or set it as default in Settings → Agent Presets)')
    console.log('  3. ask the main agent a task; it will self-answer internal file')
    console.log('     searches and delegate web research / design / implementation via')
    console.log('     the search_external / design / implement tools')
  }
  console.log()
  console.log(`uninstall: rm -rf "${dstDir}"`)
}

// ── main ────────────────────────────────────────────────────────────────────

/**
 * 主流程。argv 缺省取 process.argv.slice(2)（tools/install.mjs 直接运行）。
 * 交互模式已随安装通道收敛整块移除：无 --auto（且非只读的 --dry-run）在参数
 * 解析后、collectState 之前直接拒绝并指路（免做无谓的 MCP 握手 / patch 扫描）
 * —— 非交互装走 --auto，可视化配置走插件通道的 Web 配置器。
 */
export async function main({ argv = process.argv.slice(2) } = {}) {
  let opts
  try {
    opts = parseArgs(argv)
  } catch (err) {
    console.error(err.message)
    return 1
  }
  if (opts.help) {
    printHelp()
    return 0
  }

  // 无 --auto 直接拒绝（交互模式已删）：--dry-run 只读不动盘，放行作检测预览。
  // 门禁放在 collectState 之前：被拒路径不做任何检测 / 握手，快速失败。
  if (!opts.auto && !opts.dryRun) {
    console.error(
      'error: 交互安装已移除——请用 --auto 非交互安装；可视化配置请安装插件：' +
        'dsh plugin --profile web add dsh-paoding',
    )
    return 1
  }

  const dshHome = process.env.DSH_HOME || path.join(homedir(), '.dsh')
  const configFile = opts.config || path.join(dshHome, 'dsh-paoding.config.yml')

  // Run the shared detection pipeline (patch scan, MCP handshake, plugins,
  // skills, smart defaults). Failures are hard errors: 与下方 generateAndInstall
  // 同款 try/catch 收敛（error: ... 到 stderr、exit 1），不再裸堆栈。
  let state
  try {
    state = await collectState({
      dshHome,
      configFile,
      profile: opts.profile,
      patches: opts.patches,
      cwd: process.cwd(),
    })
  } catch (err) {
    console.error(`error: ${err.message}`)
    return 1
  }
  const {
    restrictBase,
    existing,
    scanned,
    mcpReports,
    pluginReports,
    staticBase,
    suggested,
    dstDir,
  } = state
  // --auto 语义与插件首装 ensurePresetInstalled 共用同一构造（alloc.autoAssignments，
  // 防两处逻辑漂移）：既有配置 → 按配置合成（不变）；fresh（无配置）→ 默认基础
  // 模板（仅 dsh 基础工具），--suggest 恢复智能默认自动纳入。--dry-run fresh
  // 同样按此计算但不落盘。
  const assignments = autoAssignments({ existing, suggested, staticBase, suggest: opts.suggest })

  // Compose, validate and (unless dry-run) install via the shared generator.
  // saveConfigOnWrite：fresh 非交互安装把基础模板落进配置文件（显式
  // main_agent_extra: [] 锚定「未开启 host 工具」）；existing 路径绝不覆写
  // 用户配置文件。
  let composed
  try {
    composed = generateAndInstall(state, assignments, {
      dryRun: opts.dryRun,
      saveConfigOnWrite: !existing && !opts.dryRun,
    })
  } catch (err) {
    console.error(`error: ${err.message}`)
    return 1
  }
  const roleResults = composed.roleResults
  const staleNote = composed.staleNote

  printReport({
    scanned,
    mcpReports,
    pluginReports,
    roleResults,
    dstDir,
    dryRun: opts.dryRun,
    staleNote,
    mainAgent: {
      baseCount: restrictBase.length,
      extra: assignments.main_agent_extra ?? [],
      removed: assignments.main_agent_remove ?? [],
    },
  })
  if (!existing && !opts.dryRun) {
    // fresh 非交互安装：提示基础模板已落盘、host/MCP 工具去哪补（--suggest 可
    // 恢复智能默认自动纳入）。
    console.log(
      `\n基础模板已写入 ${configFile}：默认仅 dsh 基础工具，重启后在 设置 → 庖丁配置` +
        `里自定义 host/MCP 工具。`,
    )
  }
  const customRoles = Object.keys(assignments.roles).filter((n) => !ROLES.includes(n))
  if (customRoles.length > 0) {
    console.log(`自定义角色: ${customRoles.join(', ')}（toolName 已注入主 agent restrict config.allow）`)
  }
  // 可续角色摘要（roles.<toolName>.background_mode = 'continuable'，内置与自定义
  // 角色一并列出；roles_remove 命中的角色其 background_mode 已被生成层忽略，不列）。
  // 全部缺省（one-shot）时不打行，保持输出安静。
  const removedRoleSet = new Set(assignments.roles_remove ?? [])
  const continuableRoles = Object.entries(assignments.roles ?? {})
    .filter(([toolName, role]) => role?.background_mode === 'continuable' && !removedRoleSet.has(toolName))
    .map(([toolName]) => toolName)
  if (continuableRoles.length > 0) {
    console.log(`可续角色（continuable）: ${continuableRoles.join(', ')}（委派失败先用 send_message 就地续修）`)
  }
  const skillAssignments = Object.entries(assignments.skills ?? {}).filter(([, roleList]) => roleList.length > 0)
  if (skillAssignments.length > 0) {
    console.log(`技能引导: ${skillAssignments.map(([s, r]) => `${s} → ${r.join(', ')}`).join('；')}`)
  }
  const mainAgentSkills = (assignments.main_agent_skills ?? []).filter((n) => typeof n === 'string' && n !== '')
  if (mainAgentSkills.length > 0) {
    console.log(`主 agent 技能(read 按需): ${mainAgentSkills.join(', ')}`)
  }
  const mainAgentInlineSkills = (assignments.main_agent_skills_inline ?? []).filter((n) => typeof n === 'string' && n !== '')
  if (mainAgentInlineSkills.length > 0) {
    console.log(`主 agent 技能(内联): ${mainAgentInlineSkills.join(', ')}`)
  }
  const removedBuiltins = (assignments.roles_remove ?? []).filter((role) => ROLES.includes(role))
  if (removedBuiltins.length > 0) {
    console.log(`内置角色已删除: ${removedBuiltins.join(', ')}（委派行、主 persona 引用与 restrict allow 已一并移除）`)
  }
  // 主 agent 显示名（main_agent_display_name）：仅 preset 显示名，persona 身份行不可改名。
  const namedMainAgentDisplay = normalizeRoleName(assignments.main_agent_display_name ?? null, 'main_agent_display_name')
  if (namedMainAgentDisplay !== null) {
    console.log(`主 agent 显示名: ${namedMainAgentDisplay}（仅 preset 显示名，不动 persona 身份行）`)
  }

  // 版本提示（best-effort，收尾最后一行、在既有输出之后，不改变退出码与输出
  // 顺序）：对比 GitHub latest release，有新版才打印；超时 2 秒，检测失败
  // （断网 / 限流 / 解析异常）完全静默。--help / 参数错误等早退路径不检测，
  // 此处已是安装 / 应用完成之后。
  try {
    const info = await getVersionInfo({ timeoutMs: 2000 })
    if (info.updateAvailable && info.latest) {
      console.log(
        `\n💡 发现新版本 ${info.latest}（当前 v${info.current}）：` +
          `${info.releaseUrl || 'https://github.com/lifangjin/dsh-paoding/releases/latest'}`,
      )
    }
  } catch {
    /* 静默：版本检测的任何意外都不影响安装结果 */
  }
  return 0
}
