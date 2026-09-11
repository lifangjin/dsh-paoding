/**
 * CLI 层：参数解析与帮助（parseArgs / printHelp）、检测报告（printReport）、
 * --config-ui 挂载（ensureConfigUiMount）与主流程（main）。install.mjs 被直接
 * 运行时由此模块的 main() 真正驱动。
 * 依赖 util（REPO_ROOT / ROLES / SRC_DIR）、config（normalizeMainAgentName）、
 * host（removedReason）、state（collectState / generateAndInstall）、wizard
 * （runWizard）与 alloc（resolveAssignments）以及 node:fs / node:os / node:path。
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { REPO_ROOT, ROLES, SRC_DIR } from './util.mjs'
import { normalizeMainAgentName } from './config.mjs'
import { removedReason } from './host.mjs'
import { collectState, generateAndInstall } from './state.mjs'
import { runWizard } from './wizard.mjs'
import { resolveAssignments } from './alloc.mjs'

// ── CLI ─────────────────────────────────────────────────────────────────────

export function printHelp() {
  console.log(`dsh-paoding installer — installs the orchestrator preset with host-aware tool filtering

Usage:
  node tools/install.mjs [options]
  ./install.sh [options]

Options:
  --profile <name>   Profile whose patch layer is scanned (default: web).
                     Reads $DSH_HOME/profiles/<name>/cordis.patch.yml; skipped
                     when the file does not exist.
  --patch <file>     Extra patch file(s) to scan, in addition to the home and
                     profile layers (repeatable).
  --config <file>    Configuration file with role/tool assignments
                     (default: $DSH_HOME/dsh-paoding.config.yml).
  --auto             Non-interactive: apply the config file when present,
                     otherwise apply smart default assignments.  Required when
                     stdin is not a TTY.
  --wizard           Force the interactive wizard even when stdin is not a TTY
                     (reads answers from stdin).
  --dry-run          Print the detection report and the generated allow lists
                     without writing anything; exit 0.
  --config-ui        Also mount the visual config UI into the DSH Settings
                     page: symlink plugins/paoding-config-ui into
                     $DSH_HOME/node_modules and ensure the cordis.patch.yml
                     row (id: paoding-config-ui) is enabled. Requires a DSH
                     restart to take effect.
  --help             Show this help and exit.

Environment:
  DSH_HOME           Directory holding cordis.patch.yml etc. (default: $HOME/.dsh)

Without --auto, an interactive wizard runs (when stdin is a TTY): it detects
enabled MCP servers / plugins / skills, lets you assign tools to the default
role agents or create custom sub-agents, and writes the config file before
installing.  With --auto and no config file, smart defaults match the static
preset exactly (zero regression).`)
}

export function parseArgs(argv) {
  const opts = { profile: null, patches: [], dryRun: false, help: false, auto: false, wizard: false, config: undefined, configUi: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') {
      opts.help = true
    } else if (arg === '--dry-run') {
      opts.dryRun = true
    } else if (arg === '--auto') {
      opts.auto = true
    } else if (arg === '--wizard') {
      opts.wizard = true
    } else if (arg === '--config-ui') {
      opts.configUi = true
    } else if (arg === '--config') {
      const value = argv[++i]
      if (value === undefined || value.startsWith('--')) {
        throw new Error('error: --config requires a file path')
      }
      opts.config = value
    } else if (arg.startsWith('--config=')) {
      opts.config = arg.slice('--config='.length)
    } else if (arg === '--profile') {
      const value = argv[++i]
      if (value === undefined || value.startsWith('--')) {
        throw new Error('error: --profile requires a value')
      }
      opts.profile = value
    } else if (arg.startsWith('--profile=')) {
      opts.profile = arg.slice('--profile='.length)
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
      const sourceLabel =
        r.source === 'static' ? 'static table' : r.source === 'handshake' ? 'live handshake' : 'handshake failed'
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
    console.log('\nnote: 检测到 patch 配置在本次安装后有过修改，改动后请重跑 ./install.sh')
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

// ── config UI mount (--config-ui) ──────────────────────────────────────────
//
// 借鉴 dsh-better-sidebar 的设置页整合机制（DSH 0.1.1-rc.1 实测通过）：
//   - 插件以包名安装进 $DSH_HOME/node_modules，patch 行 `name: <包名>` 即可被
//     cordis Loader 解析；dsh-client-modules 节点半扫描该包 package.json 的
//     `dsh.client` 声明 + exports["./client"]，把 client bundle 编入
//     __DSH_BOOT__ 并服务 /plugins/<包名>/client.js；
//   - 浏览器内核为 manifest 里每个插件创建 loader 条目并激活（不依赖谁 require），
//     bundle 以 window.__ModuleLoader__.load({id: <包名>, factory}) 注册；
//   - 客户端 apply() 经 ctx.slots.inject("settings.section") + slots.register()
//     把分区挂进 DSH 设置壳（id/order/label 驱动导航），与 ui-settings-general
//     的 general 分区同款模式；
//   - Node 半路由带信任围栏（/api/paoding 长于 /api 前缀会绕开网关围栏）。

/** 幂等挂载配置 UI：symlink 进 $DSH_HOME/node_modules + 启用 patch 行。 */
export function ensureConfigUiMount(dshHome, dryRun) {
  const pluginDir = path.join(REPO_ROOT, 'plugins', 'paoding-config-ui')
  const linkDir = path.join(dshHome, 'node_modules')
  const linkTarget = path.join(linkDir, 'paoding-config-ui')
  const patchFile = path.join(dshHome, 'cordis.patch.yml')

  if (dryRun) {
    console.log(`[config-ui] 将挂载: ${linkTarget} -> ${pluginDir}`)
    console.log(`[config-ui] 将启用 patch 行: id: paoding-config-ui (${patchFile})`)
    return
  }

  // 1) symlink（已存在且指向正确则跳过）
  if (!existsSync(pluginDir)) {
    throw new Error(`config-ui 插件目录不存在: ${pluginDir}`)
  }
  if (existsSync(linkTarget)) {
    const real = realpathSync(linkTarget)
    if (real !== realpathSync(pluginDir)) {
      throw new Error(`config-ui 已安装为其它来源（${real}）；删除 ${linkTarget} 后重试`)
    }
  } else {
    mkdirSync(linkDir, { recursive: true })
    symlinkSync(pluginDir, linkTarget, 'dir')
    console.log(`[config-ui] symlink: ${linkTarget} -> ${pluginDir}`)
  }

  // 2) patch 行（幂等：已启用跳过；注释块则取消注释；缺失则追加）
  if (!existsSync(patchFile)) {
    writeFileSync(patchFile, '', 'utf8')
  }
  let patch = readFileSync(patchFile, 'utf8')

  // 已启用的挂载行存在？
  const enabledRow = /\n- insert:\n\s+- id: paoding-config-ui\s*\n\s+name: \S+\s*\n?$/.test('\n' + patch)
  const hasAnyRow = /(^|\n)\s*#?\s*- insert:\s*\n\s*#?\s+- id: paoding-config-ui/.test(patch)

  if (!hasAnyRow) {
    const block =
      '\n# ============================================================\n' +
      '# paoding-config-ui — DSH Web 设置页内嵌可视化配置器\n' +
      '# （install.sh --config-ui 自动挂载；停用：整段注释后重启 DSH）\n' +
      '# ============================================================\n' +
      '- insert:\n' +
      '    - id: paoding-config-ui\n' +
      '      name: paoding-config-ui\n'
    patch += block
    writeFileSync(patchFile, patch, 'utf8')
    console.log(`[config-ui] patch 已追加: ${patchFile}`)
    return
  }

  if (!enabledRow) {
    // 取消注释三行挂载（保留其上的注释块）
    const uncomment = (text) =>
      text
        .replace(/(^|\n)#- insert:/g, '$1- insert:')
        .replace(/(^|\n)#\s+- id: paoding-config-ui/g, '$1    - id: paoding-config-ui')
        .replace(/(^|\n)#\s+name: paoding-config-ui/g, '$1      name: paoding-config-ui')
    const next = uncomment(patch)
    if (next === patch) {
      throw new Error('config-ui patch 行存在但无法自动启用，请手动编辑 ' + patchFile)
    }
    writeFileSync(patchFile, next, 'utf8')
    console.log(`[config-ui] patch 行已启用: ${patchFile}`)
    return
  }

  console.log('[config-ui] 已挂载（幂等跳过）')
}

// ── main ────────────────────────────────────────────────────────────────────

export async function main() {
  let opts
  try {
    opts = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error(err.message)
    return 1
  }
  if (opts.help) {
    printHelp()
    return 0
  }

  const dshHome = process.env.DSH_HOME || path.join(homedir(), '.dsh')
  const configFile = opts.config || path.join(dshHome, 'dsh-paoding.config.yml')

  // Run the shared detection pipeline (patch scan, MCP handshake, plugins,
  // skills, smart defaults). Failures are hard errors.
  const state = await collectState({
    dshHome,
    configFile,
    profile: opts.profile,
    patches: opts.patches,
    cwd: process.cwd(),
  })
  const {
    srcText,
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
    dstDir,
    dstAgentFile,
  } = state

  // Decide the interaction mode: the wizard runs whenever stdin is a TTY and
  // the user did not ask for --auto (it seeds from the existing config when
  // present); otherwise apply the config / smart defaults non-interactively.
  const interactive = opts.wizard || (!opts.auto && process.stdin.isTTY)
  let assignments = null
  let wizardRan = false
  if (interactive) {
    assignments = await runWizard({
      inventory,
      mcpReports,
      pluginReports,
      skills,
      staticBase,
      suggested,
      existingConfig: existing,
      personaBlocks,
      srcText,
      restrictBase,
    })
    if (assignments === null) return 0
    wizardRan = true
  } else if (opts.auto || existing || opts.dryRun) {
    assignments = resolveAssignments(existing, suggested, staticBase)
  } else {
    console.error(
      'error: interactive wizard requires a terminal. Run with --auto for a non-interactive install, ' +
        'or --config <file> to apply an existing config file. (--dry-run works without a TTY.)',
    )
    return 1
  }

  // Compose, validate and (unless dry-run) install via the shared generator.
  let composed
  try {
    composed = generateAndInstall(state, assignments, { dryRun: opts.dryRun, saveConfigOnWrite: wizardRan })
  } catch (err) {
    console.error(`error: ${err.message}`)
    return 1
  }
  const generatedText = composed.text
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
  if (wizardRan) {
    console.log(`\n配置已写入 ${configFile}（改后重跑 ./install.sh --auto 应用）`)
  }
  const customRoles = Object.keys(assignments.roles).filter((n) => !ROLES.includes(n))
  if (customRoles.length > 0) {
    console.log(`自定义角色: ${customRoles.join(', ')}（toolName 已注入主 agent restrict config.allow）`)
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
  const namedMainAgent = normalizeMainAgentName(assignments.main_agent_name ?? null)
  if (namedMainAgent !== null) {
    console.log(`主 agent 名称: ${namedMainAgent}`)
  }

  // Optional: mount the visual config UI into the DSH Settings page.
  if (opts.configUi) {
    try {
      ensureConfigUiMount(dshHome, opts.dryRun)
      if (!opts.dryRun) {
        console.log('[config-ui] 完成。重启 DSH（dsh web）后在 设置 → 庖丁配置 中打开。')
      }
    } catch (err) {
      console.error(`error: config-ui 挂载失败: ${err.message}`)
      return 1
    }
  }
  return 0
}
