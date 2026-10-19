/**
 * CLI 层：参数解析与帮助（parseArgs / printHelp）、检测报告（printReport）与
 * 主流程（main，供 tools/install.mjs 直接运行）。
 *
 * 官方安装通道是 DSH 插件通道（dsh plugin --profile web add dsh-paoding），
 * npm 包不再携带 CLI 入口；本 CLI 仅作仓库内不宣传的开发兜底（--auto /
 * --dry-run / --config / --help）。交互模式已整块移除：可视化配置走插件通道
 * 自带的 Web 配置器（侧栏底部「庖丁配置」入口）。
 *
 * 依赖 util（ROLES / SRC_DIR / PROFILE_NAME_RE）、config（normalizeRoleName）、
 * host（removedReason）、state（PRESET_ASIS_FILES / collectState /
 * generateAndInstall）、alloc（autoAssignments，--auto 语义与插件首装共享）、
 * health（captureWarnings / healthCheck，--dry-run 报告的结构化体检）、
 * doctor（runDoctor，doctor 子命令的只读体检）、lifecycle（uninstall 与
 * doctor --fix 共用的清理原语与判据）、version（getVersionInfo，main 收尾的
 * 新版提示）、yaml（loadYaml，--fix 的配置对账读法）以及 node:os / node:path /
 * node:readline/promises。
 */
import { homedir } from 'node:os'
import path from 'node:path'
import readline from 'node:readline/promises'
import { PROFILE_NAME_RE, ROLES, SRC_DIR } from './util.mjs'
import { normalizeRoleName } from './config.mjs'
import { loadYaml } from './yaml.mjs'
import { removedReason } from './host.mjs'
import { PRESET_ASIS_FILES, collectState, generateAndInstall } from './state.mjs'
import { autoAssignments } from './alloc.mjs'
import { captureWarnings, healthCheck } from './health.mjs'
import { runDoctor } from './doctor.mjs'
import {
  cleanupPaodingArtifacts,
  foreignPresetDirsRemaining,
  loadConfigForReconcile,
  orphanManagedRows,
  planUninstall,
  removeConfigAndBackups,
  workspacePresetOrphans,
} from './lifecycle.mjs'
import { getVersionInfo } from './version.mjs'

// ── CLI ─────────────────────────────────────────────────────────────────────

export function printHelp() {
  console.log(`dsh-paoding installer — dev fallback installer for the orchestrator preset
(host-aware tool filtering)

官方安装通道是 DSH 插件通道（本 CLI 仅作仓库内开发兜底，不作宣传）：

  dsh plugin --profile web add dsh-paoding

可视化配置随插件通道自带：DSH Web 侧栏底部「庖丁配置」入口。

Usage:
  node tools/install.mjs [options]
  node tools/install.mjs doctor [options]
  node tools/install.mjs uninstall [options]

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
  --dry-run          Print the detection report, the generated allow lists and
                     the config health check without writing anything; exit 0.
  --suggest          Fresh install without a config file: seed smart defaults
                     from the detected host/MCP tools instead of the base
                     template (host tools are folded in automatically).
  --purge            uninstall 专用：连配置文件与其 .bak* 备份一起删（默认保留）。
  --yes              uninstall / doctor --fix 专用：跳过逐类确认直接执行；
                     非交互终端（非 TTY）下没带 --yes 时只列计划不落盘，退出码 2。
  --fix              doctor 专用：体检后自动修两类可安全处理的问题（孤儿工作区
                     预设目录、孤儿/过期声明行），其余发现只给处理建议不代做。
  --help             Show this help and exit.

Subcommands:
  doctor             Read-only health check of the local install (config file,
                     preset track vs host version, managed patch rows, orphan
                     workspace presets, config drift, version marker) and a
                     summary; exit 1 only on error-level findings.
  doctor --fix       体检并清理：只自动修 --fix 所述两类，输出逐项标注
                     「已修 / 需手动」；托管块清理写盘前自动备份 .bak-1。
  uninstall          清理庖丁写进宿主目录的东西：cordis.patch.yml 托管声明块、
                     .agent-presets 下的 orchestrator* 预设目录、.generator-version
                     标记。默认保留 dsh-paoding.config.yml 及其备份（用户数据），
                     --purge 才连配置一起删。不碰插件包自身——包本体用
                     dsh plugin remove dsh-paoding 卸载。

Environment:
  DSH_HOME           Directory holding cordis.patch.yml etc. (default: $HOME/.dsh)

With --auto and no config file, a base template is written: only the dsh
built-in tools stay enabled — add host/MCP tools afterwards via the 庖丁配置
entry at the sidebar bottom (visual config UI from the plugin channel).
Pass --suggest to fall back to the smart defaults that fold detected host
tools in automatically.`)
}

// --profile 值白名单：与 bin/dsh-paoding.mjs 共用同一份 PROFILE_NAME_RE（抽在
// util 防两处漂移）。profile 名会被拼进 dsh 子进程命令行，解析源头只收常规名称。
function assertProfileName(value) {
  if (!PROFILE_NAME_RE.test(value)) {
    throw new Error(`error: --profile 只收常规名称（字母数字开头，仅限 [A-Za-z0-9._-]）: ${value}`)
  }
}

export function parseArgs(argv) {
  const opts = { command: 'install', profile: null, patches: [], dryRun: false, help: false, auto: false, config: undefined, suggest: false, purge: false, yes: false, fix: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === 'doctor') {
      // 子命令：doctor = 只读体检（--fix 升级为「体检并修」）；缺省 install
      //（原 installer 主流程）。位置参数只认 doctor / uninstall 两个，其余仍按
      // 未知选项报错；--help / --profile / --config 等照常解析，子命令分支共用。
      opts.command = 'doctor'
    } else if (arg === 'uninstall') {
      // 子命令：uninstall = 清理庖丁写进宿主目录的东西（不动插件包自身）。
      opts.command = 'uninstall'
    } else if (arg === '--help' || arg === '-h') {
      opts.help = true
    } else if (arg === '--dry-run') {
      opts.dryRun = true
    } else if (arg === '--auto') {
      opts.auto = true
    } else if (arg === '--suggest') {
      // fresh 安装时用智能默认（自动纳入检测到的 host 工具）而非基础模板。
      opts.suggest = true
    } else if (arg === '--purge') {
      // 仅 uninstall：连配置文件与其备份一起删（默认保留用户配置）。
      opts.purge = true
    } else if (arg === '--yes') {
      // uninstall / doctor --fix：跳过逐类确认直接执行；非 TTY 无 --yes 时
      // 只列计划不落盘（防呆）。
      opts.yes = true
    } else if (arg === '--fix') {
      // 仅 doctor：对体检发现里可安全自动修的两类动手（孤儿目录、孤儿声明行）。
      opts.fix = true
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

export function printReport({ scanned, mcpReports, pluginReports, roleResults, dstDir, dryRun, staleNote, mainAgent, health = null }) {
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
  if (health !== null) {
    // 配置体检小节（--dry-run 报告专属；health 为 null 时不打印，--auto 输出
    // 保持原样）。条目结构与面板 preview/apply 响应的 warnings 字段同源
    //（tools/lib/health.mjs healthCheck）。
    console.log()
    console.log('config health (体检):')
    if (health.length === 0) {
      console.log('  ✔ 未发现问题')
    } else {
      for (const h of health) {
        const mark = h.level === 'error' ? '✘' : h.level === 'warn' ? '⚠' : 'ℹ'
        console.log(`  ${mark} ${h.code} — ${h.message}`)
      }
    }
  }
  if (staleNote) {
    console.log('\nnote: 检测到 patch 配置在本次安装后有过修改，改动后请重跑 node tools/install.mjs --auto')
  }
  console.log()
  console.log(
    `${dryRun ? '[dry-run] would write' : 'wrote'} ${path.join(dstDir, 'agent.cordis.yml')}` +
      (dryRun ? '' : ' (allow lists rewritten)'),
  )
  console.log(`${dryRun ? '[dry-run] would copy' : 'copied'} ${PRESET_ASIS_FILES.join(', ')} as-is`)
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

/** doctor 子命令的人读报告：每行「✔/✘/⚠/– 项目 — 一句说明」，结尾汇总。
 *  渲染与检查本体分离（tools/lib/doctor.mjs 只产结构化 items，便于测试）。 */
export function printDoctorReport(report, { dshHome, configFile }) {
  const marks = { ok: '✔', error: '✘', warn: '⚠', skip: '–' }
  console.log('dsh-paoding doctor — 安装体检（只读，不改任何文件）')
  console.log(`  DSH_HOME : ${dshHome}`)
  console.log(`  配置文件 : ${configFile}`)
  console.log()
  for (const { status, label, detail } of report.items) {
    console.log(`${marks[status] ?? '·'} ${label} — ${detail}`)
  }
  const count = (status) => report.items.filter((i) => i.status === status).length
  const errors = count('error')
  const warns = count('warn')
  console.log()
  if (errors > 0) {
    console.log(`汇总: ${report.items.length} 项检查，${errors} 项错误（✘）${warns > 0 ? `、${warns} 项警告（⚠）` : ''}——请先处理 ✘ 再使用；详细说明见 docs/installation.md 排查节`)
  } else if (warns > 0) {
    console.log(`汇总: ${report.items.length} 项检查，无错误；${warns} 项警告（⚠）不影响使用，可按各行说明处理`)
  } else {
    console.log(`汇总: ${report.items.length} 项检查全部正常`)
  }
}

// ── 生命周期清理（uninstall / doctor --fix）────────────────────────────────
//
// 「怎么删」全部在 lib/lifecycle.mjs（判据与 doctor 同源）；这里只做三件事：
// 计划打印、确认口径（--yes 直干 / TTY 逐类问 / 非 TTY 防呆拒做）、结果汇报。

/** 非 TTY（管道 / 重定向）下逐类确认问不了，只能列计划等显式 --yes。 */
function stdinIsTTY() {
  return Boolean(process.stdin?.isTTY)
}

/** 逐类确认（仅 TTY 调用）：回车 / 非 y 一律视为拒绝——删东西默认说不。 */
async function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase()
    return answer === 'y' || answer === 'yes'
  } finally {
    rl.close()
  }
}

/** 包本体卸载提示（uninstall 收尾专用）：插件包的卸载通道只有 dsh plugin
 *  remove，本命令绝不碰自己的包目录。 */
function printPluginRemovalHint() {
  console.log()
  console.log('收尾：插件包本体走插件通道卸载——')
  console.log('  dsh plugin remove dsh-paoding')
  console.log('（desktop profile 由 Electron 守卫拦着，请在 DSH 面板 / 宿主侧处理）')
}

/** uninstall 的计划打印（防呆拒做时同一份，见 runUninstall）。 */
function printUninstallPlan(plan, { purge }) {
  console.log('dsh-paoding uninstall — 清理庖丁写进宿主目录的东西（不碰插件包自身）')
  console.log(`  DSH_HOME : ${plan.dshHome}`)
  console.log(`  配置文件 : ${plan.configFile}`)
  console.log()
  console.log('将清理：')
  if (plan.blockPresent && !plan.blockCorrupt) {
    console.log(`  - ${plan.patchFile} 里的托管声明块（${plan.blockRowCount} 条声明行；写前备份 ${path.basename(plan.patchFile)}.bak-1）`)
  }
  if (plan.blockCorrupt) {
    console.log('  - 托管声明块已损坏（有起始标记无结束标记）：自动清理做不了，需手工整块删除或补回结束标记')
  }
  if (plan.presetDirs.length > 0 || plan.markerExists) {
    const markerNote = plan.markerExists ? '（含版本标记 .generator-version）' : ''
    console.log(`  - 预设目录 ${plan.presetDirs.join('、') || '（无）'}${markerNote}`)
  }
  if (purge && (plan.configExists || plan.configBackups.length > 0)) {
    const backups = plan.configBackups.length > 0 ? ` 及 ${plan.configBackups.length} 个 .bak* 备份` : ''
    console.log(`  - 配置文件 ${plan.configFile}${backups}（--purge）`)
  }
  console.log('将保留：')
  if (!purge && (plan.configExists || plan.configBackups.length > 0)) {
    console.log(`  - 配置文件 ${plan.configFile}${plan.configBackups.length > 0 ? ` 及 ${plan.configBackups.length} 个 .bak* 备份` : ''}（用户数据；--purge 才删）`)
  }
  const foreign = foreignPresetDirsRemaining(plan.dshHome)
  if (foreign.length > 0) {
    console.log(`  - .agent-presets 下非庖丁目录：${foreign.join('、')}`)
  }
}

/** uninstall 主流程，返回退出码。 */
async function runUninstall({ dshHome, configFile, purge, yes }) {
  const plan = planUninstall({ dshHome, configFile })

  // 无事可做：不打扰确认（反正一个字节都不会动），直接交代现状。
  const hasWork =
    plan.blockPresent ||
    plan.presetDirs.length > 0 ||
    plan.markerExists ||
    (purge && (plan.configExists || plan.configBackups.length > 0))
  if (!hasWork) {
    console.log('dsh-paoding uninstall — 宿主目录里没有庖丁的安装产物（托管声明块、orchestrator* 预设目录、版本标记均不在场），无事可做。')
    if (plan.configExists) console.log(`配置已保留在 ${configFile}，确认不要可手动删（连同 .bak* 备份）。`)
    printPluginRemovalHint()
    return 0
  }

  printUninstallPlan(plan, { purge })

  // 防呆：非交互终端问不了，宁可不做——列出计划，等显式 --yes。
  if (!yes && !stdinIsTTY()) {
    console.error()
    console.error('当前不是交互终端且未加 --yes：只列计划不执行，重跑时加 --yes 确认。')
    return 2
  }

  // 逐类确认（--yes 跳过；损坏块不进确认——自动路径反正删不动，按需手工报）。
  let doBlock = plan.blockPresent && !plan.blockCorrupt
  let doDirs = plan.presetDirs.length > 0
  let doConfig = purge && (plan.configExists || plan.configBackups.length > 0)
  if (!yes) {
    if (doBlock) doBlock = await confirm(`移除 ${plan.patchFile} 里的庖丁托管声明块？`)
    if (doDirs) doDirs = await confirm(`删除预设目录 ${plan.presetDirs.join('、')}？`)
    if (doConfig) {
      doConfig = await confirm(
        `删除配置文件及其备份（${configFile}${plan.configBackups.length > 0 ? ` + ${plan.configBackups.length} 个 .bak*` : ''}）？`,
      )
    }
  }

  const cleanup = cleanupPaodingArtifacts(dshHome, {
    stripBlock: doBlock,
    removeDirIds: doDirs ? plan.presetDirs : [],
  })

  console.log()
  if (plan.blockCorrupt) {
    console.log(`⚠ 托管声明块损坏（有起始标记无结束标记），自动清理已跳过——请手工补回结束标记或整块删除 ${plan.patchFile}`)
  } else if (doBlock) {
    if (cleanup.blockRemoved) {
      console.log(`✓ 已移除托管声明块${cleanup.backupPath ? `（原文件备份：${cleanup.backupPath}）` : ''}`)
    } else {
      console.log(`⚠ 托管声明块未能移除，请检查 ${plan.patchFile}`)
    }
  }
  if (doDirs && cleanup.removedDirs.length > 0) {
    console.log(`✓ 已删除预设目录：${cleanup.removedDirs.join('、')}${plan.markerExists ? '，版本标记 .generator-version 随目录一并删除' : ''}`)
  }
  if (cleanup.markerRemoved) {
    console.log('✓ 已删除版本标记 .generator-version')
  }
  for (const failure of cleanup.dirFailures) {
    console.log(`⚠ 预设目录删除失败：${failure.id}（${failure.error}）——请手工处理`)
  }

  if (purge) {
    if (doConfig) {
      const removed = removeConfigAndBackups(configFile)
      if (removed.length > 0) {
        console.log(`✓ 已删除配置文件及其备份（${removed.length} 个文件）`)
      }
    } else if (plan.configExists || plan.configBackups.length > 0) {
      console.log(`ℹ 配置未删（未确认）：${configFile}`)
    }
  } else if (plan.configExists || plan.configBackups.length > 0) {
    console.log(`ℹ 配置已保留在 ${configFile}，确认不要可手动删（连同 .bak* 备份）。`)
  }

  printPluginRemovalHint()

  const failed =
    cleanup.dirFailures.length > 0 ||
    plan.blockCorrupt ||
    (doBlock && !cleanup.blockRemoved)
  return failed ? 1 : 0
}

/** doctor --fix 对「预设漂移」这类体检行文的补充建议：各行 detail 多数自带
 *  处理建议，这里只补体检行文没点到的 --auto 路径，不逐行复读。 */
const DOCTOR_FIX_HINTS = {
  预设漂移: '（或运行 dsh-paoding --auto 重新生成）',
}

/** doctor --fix 主流程，返回退出码：全量只读体检（runDoctor，与不带 --fix 的
 *  doctor 同一份诊断）→ 可修两类动手 → 逐项标注「已修 / 需手动」。可修判据
 *  与 doctor 同源（lifecycle 的孤儿目录 / 孤儿声明行两个函数），不另立标准。 */
async function runDoctorFix({ dshHome, configFile, profile, yes }) {
  const report = await runDoctor({ dshHome, configFile, profile })

  // 配置存在但不可解析时目录对账不可信（doctor 该项同样降级 skip）——只报不修。
  const reconcile = loadConfigForReconcile(configFile, loadYaml(dshHome))
  const dirsReconcilable = !reconcile.exists || reconcile.usable
  const orphanDirIds = dirsReconcilable ? workspacePresetOrphans(dshHome, reconcile.config).orphans : []
  const orphanRowIds = orphanManagedRows(dshHome).map((row) => row.rowId)

  let doDirs = orphanDirIds.length > 0
  let doRows = orphanRowIds.length > 0

  // 防呆：非交互终端问不了——只列将修什么，等显式 --yes（退出码 2）。
  const planOnly = !yes && !stdinIsTTY()
  if (!planOnly && !yes) {
    if (doDirs) doDirs = await confirm(`删除孤儿预设目录 ${orphanDirIds.join('、')}？`)
    if (doRows) doRows = await confirm(`撤下孤儿声明行 ${orphanRowIds.join('、')}？`)
  }

  const cleanup = planOnly
    ? null
    : cleanupPaodingArtifacts(dshHome, {
        pruneRowIds: doRows ? orphanRowIds : [],
        removeDirIds: doDirs ? orphanDirIds : [],
      })
  const dirsFixed = cleanup !== null && doDirs && cleanup.removedDirs.length > 0
  const rowsFixed = cleanup !== null && doRows && cleanup.prunedRowIds.length > 0

  const marks = { ok: '✔', error: '✘', warn: '⚠', skip: '–' }
  console.log(planOnly
    ? 'dsh-paoding doctor --fix — 体检完成，以下为可自动修复项（未执行）'
    : 'dsh-paoding doctor --fix — 体检并清理可自动修复的问题')
  console.log(`  DSH_HOME : ${dshHome}`)
  console.log(`  配置文件 : ${configFile}`)
  console.log()
  let fixedCount = 0
  let manualCount = 0
  for (const item of report.items) {
    const dirsHit = item.label === '工作区预设目录' && /孤儿目录|全部视为孤儿/.test(item.detail) && (dirsFixed || (planOnly && doDirs))
    const rowsHit = item.label === '声明行托管块' && /孤儿声明行/.test(item.detail) && (rowsFixed || (planOnly && doRows))
    if (dirsHit) {
      fixedCount++
      const what = planOnly ? orphanDirIds.join('、') : cleanup.removedDirs.join('、')
      const rowNote = planOnly ? '' : '；受影响声明行已同步撤下'
      console.log(`✓ ${planOnly ? '将修' : '已修'} ${item.label} — ${planOnly ? '将删除' : '已删除'}孤儿目录 ${what}${rowNote}`)
    } else if (rowsHit) {
      fixedCount++
      const what = planOnly ? orphanRowIds.join('、') : cleanup.prunedRowIds.join('、')
      const backupNote = planOnly ? '' : `（patch 原文件备份：${cleanup.backupPath ?? '无'}）`
      console.log(`✓ ${planOnly ? '将修' : '已修'} ${item.label} — ${planOnly ? '将撤下' : '已撤下'}孤儿声明行 ${what}${backupNote}`)
    } else if (item.status === 'warn' || item.status === 'error') {
      manualCount++
      const hint = DOCTOR_FIX_HINTS[item.label] ?? ''
      console.log(`${marks[item.status] ?? '·'} 需手动 ${item.label} — ${item.detail}${hint}`)
    } else {
      console.log(`${marks[item.status] ?? '·'} ${item.label} — ${item.detail}`)
    }
  }
  console.log()
  if (planOnly) {
    console.error('当前不是交互终端且未加 --yes：只列将修什么不执行，重跑时加 --yes 确认。')
    return 2
  }
  console.log(`汇总: ${report.items.length} 项检查，已修 ${fixedCount} 项${manualCount > 0 ? `，需手动 ${manualCount} 项（见 ⚠/✘ 行）` : ''}`)
  return report.hasErrors ? 1 : 0
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

  // 旗标与子命令的配属校验：装错地方的旗标直接报错（与未知选项同款 exit 1），
  // 不静默忽略——静默会让用户以为 --purge / --fix 生效了。
  if (opts.fix && opts.command !== 'doctor') {
    console.error('error: --fix 仅 doctor 子命令支持')
    return 1
  }
  if (opts.purge && opts.command !== 'uninstall') {
    console.error('error: --purge 仅 uninstall 子命令支持')
    return 1
  }
  if (opts.yes && !(opts.command === 'uninstall' || (opts.command === 'doctor' && opts.fix))) {
    console.error('error: --yes 仅 uninstall / doctor --fix 支持')
    return 1
  }

  // doctor 子命令：只读体检（--fix 升级为「体检并修」），不走 --auto 门禁
  //（门禁仅拦会动盘的安装主流程），也不用 collectState 的全量检测——runDoctor
  // 内部按项自行探测与降级。
  if (opts.command === 'doctor') {
    const dshHome = process.env.DSH_HOME || path.join(homedir(), '.dsh')
    const configFile = opts.config || path.join(dshHome, 'dsh-paoding.config.yml')
    if (opts.fix) {
      return runDoctorFix({ dshHome, configFile, profile: opts.profile, yes: opts.yes })
    }
    const report = await runDoctor({ dshHome, configFile, profile: opts.profile })
    printDoctorReport(report, { dshHome, configFile })
    return report.hasErrors ? 1 : 0
  }

  // uninstall 子命令：清理庖丁写进宿主目录的东西（托管块 / 预设目录 / 标记），
  // 确认口径与退出码见 runUninstall。
  if (opts.command === 'uninstall') {
    const dshHome = process.env.DSH_HOME || path.join(homedir(), '.dsh')
    const configFile = opts.config || path.join(dshHome, 'dsh-paoding.config.yml')
    return runUninstall({ dshHome, configFile, purge: opts.purge, yes: opts.yes })
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
  // --dry-run 顺路做一次结构化体检（captureWarnings 抓生成期告警 + healthCheck，
  // 产物 dryRunResult 直喂体检零重跑；models 缺省 null，CLI 不做模型目录发现）：
  // health 条目由 printReport 的新小节打印。--auto 路径不体检，输出保持原样。
  let composed
  let healthItems = null
  try {
    if (opts.dryRun) {
      const [result, generationWarnings] = captureWarnings(() =>
        generateAndInstall(state, assignments, { dryRun: true, saveConfigOnWrite: false }),
      )
      composed = result
      healthItems = healthCheck({ state, assignments, dryRunResult: composed, generationWarnings }).items
    } else {
      composed = generateAndInstall(state, assignments, {
        dryRun: false,
        saveConfigOnWrite: !existing,
      })
    }
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
    health: healthItems,
  })
  if (!existing && !opts.dryRun) {
    // fresh 非交互安装：提示基础模板已落盘、host/MCP 工具去哪补（--suggest 可
    // 恢复智能默认自动纳入）。
    console.log(
      `\n基础模板已写入 ${configFile}：默认仅 dsh 基础工具，重启后在侧栏底部「庖丁配置」入口` +
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
