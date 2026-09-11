/**
 * CLI 层：参数解析与帮助（parseArgs / printHelp）、检测报告（printReport）、
 * --config-ui 挂载（ensureConfigUiMount，含 npx 分布式载荷自愈）与主流程
 * （main，供 tools/install.mjs 直接运行与 bin/dsh-paoding.mjs（npx 入口）调用）。
 * 依赖 util（REPO_ROOT / ROLES / SRC_DIR / warn）、config（normalizeMainAgentName）、
 * host（removedReason）、state（collectState / generateAndInstall）、wizard
 * （runWizard）与 alloc（resolveAssignments / baseAssignments）以及
 * node:fs / node:os / node:path。
 */
import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { REPO_ROOT, ROLES, SRC_DIR, warn } from './util.mjs'
import { normalizeMainAgentName } from './config.mjs'
import { removedReason } from './host.mjs'
import { collectState, generateAndInstall } from './state.mjs'
import { runWizard } from './wizard.mjs'
import { baseAssignments, resolveAssignments } from './alloc.mjs'

// ── CLI ─────────────────────────────────────────────────────────────────────

export function printHelp() {
  console.log(`dsh-paoding installer — installs the orchestrator preset with host-aware tool filtering

Usage:
  node tools/install.mjs [options]
  ./install.sh [options]
  npx dsh-paoding [options]
  npm exec dsh-paoding -- [options]

Options:
  --profile <name>   Profile whose patch layer is scanned (default: web).
                     Reads $DSH_HOME/profiles/<name>/cordis.patch.yml; skipped
                     when the file does not exist.
  --patch <file>     Extra patch file(s) to scan, in addition to the home and
                     profile layers (repeatable).
  --config <file>    Configuration file with role/tool assignments
                     (default: $DSH_HOME/dsh-paoding.config.yml).
  --auto             Non-interactive: apply the config file when present,
                     otherwise apply the base template (or --suggest smart
                     defaults on a fresh install). Required when stdin is
                     not a TTY.
  --wizard           Force the interactive wizard even when stdin is not a TTY
                     (reads answers from stdin).
  --dry-run          Print the detection report and the generated allow lists
                     without writing anything; exit 0.
  --suggest          Fresh install without a config file: seed smart defaults
                     from the detected host/MCP tools instead of the base
                     template (host tools are folded in automatically).
  --no-ui            npx entry only: skip mounting the config UI (the npx
                     entry mounts it by default; --config-ui wins when both
                     are given).
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
installing.  The npx entry (bin/dsh-paoding.mjs) defaults to
--auto --config-ui for a quick non-interactive install.  With --auto and no
config file, a base template is written: only the dsh built-in tools stay
enabled — add host/MCP tools afterwards in 设置 → 庖丁配置 (or the wizard).
Pass --suggest to fall back to the smart defaults that fold detected host
tools in automatically.`)
}

export function parseArgs(argv) {
  const opts = { profile: null, patches: [], dryRun: false, help: false, auto: false, wizard: false, config: undefined, configUi: false, noUi: false, suggest: false }
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
    } else if (arg === '--no-ui') {
      // 仅 bin（npx 入口）有意义：跳过 bin 默认注入的 --config-ui；与
      // --config-ui 同传时后者优先（configUi 已为 true，注入逻辑自然跳过）。
      opts.noUi = true
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
  // 仓库检出（含 .git）直接 symlink 仓库内插件目录；npm 包 / tarball / git 依赖
  // 安装不含 .git，运行目录随时可能被 npx 缓存回收 —— 先把整包载荷复制到
  // $DSH_HOME/dsh-paoding/（稳定位置）再挂载，缓存清掉后 symlink 也不悬空。
  // 插件 api-core.mjs 以相对路径 import '../../tools/install.mjs'，故必须整包
  // 复制（tools/ + presets/ + plugins/ + package.json），不能只拷 plugins/。
  const devCheckout = existsSync(path.join(REPO_ROOT, '.git'))
  const payloadDir = path.join(dshHome, 'dsh-paoding')
  // 自愈载荷内再运行（REPO_ROOT 已在 payload 里）：源即目标，跳过复制，仅保证
  // symlink 指向 payload —— 否则 rmSync 会先删掉正在运行的包。比较走 realpath：
  // REPO_ROOT 可能带 /private 前缀（macOS /var 符号链接），字符串比对会失配。
  let selfHosted = false
  if (!devCheckout) {
    try {
      const realPayload = path.join(realpathSync(dshHome), 'dsh-paoding')
      const realRoot = realpathSync(REPO_ROOT)
      selfHosted = realRoot === realPayload || realRoot.startsWith(realPayload + path.sep)
    } catch {
      /* dshHome 尚不存在等：按非 selfHosted 处理 */
    }
  }
  const pluginDir = devCheckout || selfHosted
    ? path.join(REPO_ROOT, 'plugins', 'paoding-config-ui')
    : path.join(payloadDir, 'plugins', 'paoding-config-ui')
  const linkDir = path.join(dshHome, 'node_modules')
  const linkTarget = path.join(linkDir, 'paoding-config-ui')
  const patchFile = path.join(dshHome, 'cordis.patch.yml')

  if (dryRun) {
    if (!devCheckout && !selfHosted) {
      console.log(`[config-ui] 将复制到 ${payloadDir} 再挂载（npx/npm 包形态：整包载荷进稳定位置，防缓存清理悬空）`)
    }
    console.log(`[config-ui] 将挂载: ${linkTarget} -> ${pluginDir}`)
    console.log(`[config-ui] 将启用 patch 行: id: paoding-config-ui (${patchFile})`)
    return
  }

  if (!devCheckout && !selfHosted) {
    // 整包复制（先删后建 = 幂等刷新载荷；bin 缺失跳过）。
    console.log(`[config-ui] distributed copy: ${REPO_ROOT} → ${payloadDir}`)
    rmSync(payloadDir, { recursive: true, force: true })
    mkdirSync(payloadDir, { recursive: true })
    for (const dir of ['tools', 'presets', 'bin', 'plugins']) {
      const from = path.join(REPO_ROOT, dir)
      if (existsSync(from)) cpSync(from, path.join(payloadDir, dir), { recursive: true })
    }
    copyFileSync(path.join(REPO_ROOT, 'package.json'), path.join(payloadDir, 'package.json'))
  }

  // 1) symlink（已存在且指向正确则跳过）
  if (!existsSync(pluginDir)) {
    throw new Error(`config-ui 插件目录不存在: ${pluginDir}`)
  }
  let linkStat = null
  try {
    linkStat = lstatSync(linkTarget)
  } catch {
    /* 不存在：首次挂载 */
  }
  if (linkStat !== null && !linkStat.isSymbolicLink()) {
    // 真实目录（用户自装/解包安装）不动，保持原有报错文案。
    const real = realpathSync(linkTarget)
    if (real !== realpathSync(pluginDir)) {
      throw new Error(`config-ui 已安装为其它来源（${real}）；删除 ${linkTarget} 后重试`)
    }
  } else if (linkStat !== null) {
    // 符号链接：指向正确 → 幂等跳过；指向别处或悬空（lstat 命中但 realpath
    // 抛错，典型为旧 npx 缓存被清）→ 删除重建（迁移自愈）。
    let real = null
    try {
      real = realpathSync(linkTarget)
    } catch {
      real = null
    }
    if (real !== realpathSync(pluginDir)) {
      unlinkSync(linkTarget)
      mkdirSync(linkDir, { recursive: true })
      symlinkSync(pluginDir, linkTarget, 'dir')
      warn(`config-ui 旧 symlink 指向 ${real ?? '<已失效>'}，已重建 -> ${pluginDir}`)
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

/**
 * 主流程。argv 缺省取 process.argv.slice(2)（tools/install.mjs 直接运行，行为
 * 与旧版逐字一致）；bin=true 由 npx 入口（bin/dsh-paoding.mjs）传入 —— 注入
 * 快速安装默认值：非交互（TTY 也不进 wizard，先装完基础版，自定义留给 Web
 * 配置器）+ 默认挂载配置 UI。用户显式旗标优先（--wizard / --no-ui 不覆盖）。
 */
export async function main({ argv = process.argv.slice(2), bin = false } = {}) {
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
  if (bin) {
    if (!opts.wizard) opts.auto ||= true
    if (!opts.noUi) opts.configUi = true
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
    // 既有配置 → 按配置合成（不变）；fresh（无配置）→ 默认基础模板（仅 dsh
    // 基础工具，host/MCP 工具留给 Web 配置器 / 向导显式开启），--suggest 恢复
    // 智能默认自动纳入。--dry-run fresh 同样按此计算但不落盘。
    assignments = existing
      ? resolveAssignments(existing, suggested, staticBase)
      : opts.suggest
        ? suggested
        : baseAssignments(staticBase)
  } else {
    console.error(
      'error: interactive wizard requires a terminal. Run with --auto for a non-interactive install, ' +
        'or --config <file> to apply an existing config file. (--dry-run works without a TTY.)',
    )
    return 1
  }

  // Compose, validate and (unless dry-run) install via the shared generator.
  // saveConfigOnWrite：wizard 路径写用户选择（原行为）；fresh 非交互安装把基础
  // 模板落进配置文件（显式 main_agent_extra: [] 锚定「未开启 host 工具」）；
  // existing 路径绝不覆写用户配置文件。
  let composed
  try {
    composed = generateAndInstall(state, assignments, {
      dryRun: opts.dryRun,
      saveConfigOnWrite: wizardRan || (!existing && !opts.dryRun),
    })
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
  } else if (!existing && !opts.dryRun) {
    // fresh 非交互安装：提示基础模板已落盘、host/MCP 工具去哪补（--suggest 可
    // 恢复智能默认自动纳入）。
    console.log(
      `\n基础模板已写入 ${configFile}：默认仅 dsh 基础工具，重启后在 设置 → 庖丁配置` +
        `（或 npx dsh-paoding --wizard）里自定义 host/MCP 工具。`,
    )
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
