/**
 * `dsh-paoding doctor` 只读体检回归测试（node:test）。
 *
 * 禁网络 / 不依赖真实 $DSH_HOME：临时 dshHome，按项摆好（或刻意摆坏）前置事实，
 * 断言 runDoctor 的结构化 items 与退出码语义。轨道 / 宿主版本探测在本机 dsh
 * 存在与否两种环境下都能过：相关断言只盯摆坏的事实，不假设探测结果。
 *
 * 本文件同时覆盖生命周期闭环（与体检共用判据）：doctor --fix（孤儿目录 /
 * 孤儿声明行的自动清理、备份、非 TTY 防呆）与 uninstall（托管块 / 预设目录 /
 * 版本标记清理，--purge 与默认保留配置）。防呆退出码用 spawnSync 子进程钉死
 *（子进程 stdin 恒为管道，不依赖测试运行器的 stdio 形态）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { collectState, generateAndInstall } from '../tools/install.mjs'
import { runDoctor } from '../tools/lib/doctor.mjs'
import { presetIdOf, assignSlugs } from '../tools/lib/workspaces.mjs'
import {
  MANAGED_BEGIN,
  MANAGED_END,
  detectHostVersionTriple,
  formatGeneratorMarker,
  isDeclarativeTriple,
  isPtcWorkerHost,
  presetRowId,
  readHomePatchRows,
  upsertHomePatchRows,
} from '../tools/lib/preset-system.mjs'
import { main, parseArgs } from '../tools/lib/cli.mjs'

/** 空白隔离环境：临时 dshHome（无 patch 文件 → 不握手），无既有配置文件。 */
function freshEnv(tag = 'doctor') {
  const dshHome = mkdtempSync(path.join(os.tmpdir(), `dsh-paoding-${tag}-`))
  const configFile = path.join(dshHome, 'dsh-paoding.config.yml')
  return { dshHome, configFile }
}

const findItem = (report, label, re) => report.items.find((i) => i.label === label && re.test(i.detail))

const ORPHAN_ROW_TEXT = [
  `    - id: ${presetRowId('orchestrator-wsfoo')}`,
  "      name: '@deepseek-ai/dsh-agent-preset'",
  '      config:',
  '        id: orchestrator-wsfoo',
  '        name: "foo"',
].join('\n')

test('干净机器：各项降级为跳过，不炸、无 error、退出码 0', async () => {
  const { dshHome, configFile } = freshEnv()
  const report = await runDoctor({ dshHome, configFile })
  assert.equal(report.hasErrors, false, `干净机器不应有 error：${JSON.stringify(report.items)}`)
  const skips = report.items.filter((i) => i.status === 'skip')
  for (const label of ['配置文件', '声明行托管块', '版本标记']) {
    assert.ok(skips.some((i) => i.label === label), `「${label}」应有 – 跳过项`)
  }
})

test('托管块损坏（有 BEGIN 无 END）：error 级发现，hasErrors=true', async () => {
  const { dshHome, configFile } = freshEnv()
  writeFileSync(path.join(dshHome, 'cordis.patch.yml'), `${MANAGED_BEGIN}\n  - insert: []\n`)
  const report = await runDoctor({ dshHome, configFile })
  const item = findItem(report, '声明行托管块', /损坏/)
  assert.ok(item, '应点名托管块损坏')
  assert.equal(item.status, 'error')
  assert.equal(report.hasErrors, true)
})

test('孤儿声明行（指向已删目录）：warn 并点名 rowId，不算 error', async () => {
  const { dshHome, configFile } = freshEnv()
  upsertHomePatchRows(dshHome, [ORPHAN_ROW_TEXT])
  const report = await runDoctor({ dshHome, configFile })
  const item = findItem(report, '声明行托管块', /孤儿声明行/)
  assert.ok(item, '应报孤儿声明行')
  assert.equal(item.status, 'warn')
  assert.ok(item.detail.includes('preset-orchestrator-wsfoo'), `应点名 rowId：${item.detail}`)
  assert.equal(report.hasErrors, false)
})

test('目录轨宿主 + 声明行残留：warn（0.1.6 profile 启动会失败）', async () => {
  const { dshHome, configFile } = freshEnv()
  upsertHomePatchRows(dshHome, [ORPHAN_ROW_TEXT])
  // 钉死轨道为 directory（模拟 ≤0.1.6 宿主），与真实探测解耦
  const state = await collectState({ dshHome, configFile, cwd: dshHome, runtimeFacts: { presetSystem: 'directory' } })
  const report = await runDoctor({ dshHome, configFile, state })
  const item = findItem(report, '声明行托管块', /目录轨/)
  assert.ok(item, '目录轨 + 声明行残留应告警')
  assert.equal(item.status, 'warn')
})

test('孤儿工作区预设目录：配置名册对账，未引用的 orchestrator-* warn', async () => {
  const { dshHome, configFile } = freshEnv()
  mkdirSync(path.join(dshHome, '.agent-presets', 'orchestrator-abc'), { recursive: true })
  mkdirSync(path.join(dshHome, '.agent-presets', 'orchestrator-keep'), { recursive: true })
  writeFileSync(
    configFile,
    ['profile: web', 'roles: {}', 'workspaces:', '  /tmp/dsh-paoding-doctor-ws:', '    roles: {}', ''].join('\n'),
  )
  const report = await runDoctor({ dshHome, configFile })
  const item = findItem(report, '工作区预设目录', /孤儿目录/)
  assert.ok(item, '应报孤儿目录')
  assert.equal(item.status, 'warn')
  assert.ok(item.detail.includes('orchestrator-abc'), `孤儿应点名 orchestrator-abc：${item.detail}`)
  assert.ok(!/orchestrator-keep[、，]/.test(item.detail) && !item.detail.endsWith('orchestrator-keep'), '在册目录不应列为孤儿')
})

test('版本标记：缺失 warn；版本不符 warn；与当前环境一致则 ok', async () => {
  const { dshHome, configFile } = freshEnv()
  const state = await collectState({ dshHome, configFile, cwd: dshHome })
  // saveConfigOnWrite：fresh 装机同时落基础模板配置 + preset 目录（0.3.x 对
  // 「有 preset 目录但无配置」拒装，先落配置才不被守卫拦下）
  generateAndInstall(state, structuredClone(state.suggested), { saveConfigOnWrite: true })
  const presetDir = path.join(dshHome, '.agent-presets', 'orchestrator')
  const markerFile = path.join(presetDir, '.generator-version')

  // ① 装了预设但没有标记（面板 re-apply rmSync 后的常态）：warn 不炸
  let report = await runDoctor({ dshHome, configFile })
  assert.ok(findItem(report, '版本标记', /缺失或不可解析/), '缺标记应 warn')

  // ② 版本不符（升级后旧标记）：warn 点名两个版本
  writeFileSync(markerFile, formatGeneratorMarker('0.0.1', state.presetSystem, 'worker-thread'))
  report = await runDoctor({ dshHome, configFile })
  const stale = findItem(report, '版本标记', /标记版本 0\.0\.1/)
  assert.ok(stale, '旧版本标记应 warn')
  assert.ok(stale.detail.includes('0.0.1'))

  // ③ 与当前环境完全一致（版本 / 轨道 / worker 形态都按同源探测写）：ok
  const hostTriple = detectHostVersionTriple()
  const track = hostTriple !== null && isDeclarativeTriple(hostTriple) ? 'declarative' : 'directory'
  const worker = hostTriple !== null && isPtcWorkerHost(hostTriple) ? 'ptc' : 'worker-thread'
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  writeFileSync(markerFile, formatGeneratorMarker(version, track, worker))
  report = await runDoctor({ dshHome, configFile })
  const item = report.items.find((i) => i.label === '版本标记')
  assert.equal(item.status, 'ok', `同源标记应 ok：${item.detail}`)
})

test('预设漂移复用：一致 → ok；手改落盘 → warn「落后于配置」', async () => {
  const { dshHome, configFile } = freshEnv()
  const state = await collectState({ dshHome, configFile, cwd: dshHome })
  generateAndInstall(state, structuredClone(state.suggested), {})
  let report = await runDoctor({ dshHome, configFile })
  const okItem = report.items.find((i) => i.label === '预设漂移')
  assert.ok(okItem, '应有预设漂移项')
  assert.equal(okItem.status, 'ok', `刚装完应判一致：${okItem.detail}`)

  const file = path.join(dshHome, '.agent-presets', 'orchestrator', 'agent.cordis.yml')
  writeFileSync(file, readFileSync(file, 'utf8') + '\n# 手改痕迹\n')
  report = await runDoctor({ dshHome, configFile })
  const drift = report.items.find((i) => i.label === '预设漂移')
  assert.equal(drift.status, 'warn')
  assert.match(drift.detail, /落后于配置，重新应用即同步/)
})

test('配置文件不可解析：error 级，且工作区对账降级跳过', async () => {
  const { dshHome, configFile } = freshEnv()
  // 顶层列表：js-yaml 与内置兜底解析器都会拒绝（expected a mapping）
  writeFileSync(configFile, '- a\n- b\n')
  const report = await runDoctor({ dshHome, configFile })
  const item = findItem(report, '配置文件', /无法解析/)
  assert.ok(item, '应报配置不可解析')
  assert.equal(item.status, 'error')
  assert.equal(report.hasErrors, true)
  const ws = report.items.find((i) => i.label === '工作区预设目录')
  assert.equal(ws.status, 'skip', '配置不可用时对账应跳过')
})

test('CLI：parseArgs 认 doctor 子命令；main doctor 干净 0 / 托管块损坏 1', async () => {
  assert.equal(parseArgs(['doctor']).command, 'doctor')
  assert.equal(parseArgs([]).command, 'install')

  const { dshHome, configFile } = freshEnv('doctor-cli')
  const prevHome = process.env.DSH_HOME
  process.env.DSH_HOME = dshHome
  try {
    assert.equal(await main({ argv: ['doctor', '--config', configFile] }), 0, '干净机器退出码 0')
    writeFileSync(path.join(dshHome, 'cordis.patch.yml'), `${MANAGED_BEGIN}\n  - insert: []\n`)
    assert.equal(await main({ argv: ['doctor'] }), 1, '托管块损坏退出码 1')
  } finally {
    if (prevHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prevHome
    rmSync(dshHome, { recursive: true, force: true })
  }
})

test('工作区预设形态漂移：0.2.1 宿主 + 内联工作区产物 → warn 点名 presetId，新形态目录不点名', async () => {
  const { dshHome, configFile } = freshEnv('ws-stale')
  mkdirSync(path.join(dshHome, '.agent-presets', 'orchestrator-inline'), { recursive: true })
  writeFileSync(path.join(dshHome, '.agent-presets', 'orchestrator-inline', 'agent.cordis.yml'), 'x\n        persona: |-\n          p\n')
  mkdirSync(path.join(dshHome, '.agent-presets', 'orchestrator-modern'), { recursive: true })
  writeFileSync(path.join(dshHome, '.agent-presets', 'orchestrator-modern', 'agent.cordis.yml'), 'x\n        agentPreset: paoding-role-implement\n')
  writeFileSync(
    configFile,
    [
      'profile: web',
      'roles: {}',
      'workspaces:',
      '  /tmp/inline:',
      '    roles: {}',
      '  /tmp/modern:',
      '    roles: {}',
      '',
    ].join('\n'),
  )
  const prevFake = process.env.DSH_PAODING_FAKE_HOST_VERSION
  process.env.DSH_PAODING_FAKE_HOST_VERSION = '0.2.1-rc.2'
  try {
    const report = await runDoctor({ dshHome, configFile })
    const item = findItem(report, '工作区预设目录', /角色行形态与宿主所需 agent-preset 不符/)
    assert.ok(item, `应报工作区形态漂移：${JSON.stringify(report.items)}`)
    assert.equal(item.status, 'warn')
    assert.ok(item.detail.includes('orchestrator-inline'), `应点名漂移目录：${item.detail}`)
    assert.ok(item.detail.includes('0.2.1'), '应提示 0.2.1 守卫背景')
    assert.ok(!item.detail.includes('orchestrator-modern'), '新形态目录不应点名')
  } finally {
    if (prevFake === undefined) delete process.env.DSH_PAODING_FAKE_HOST_VERSION
    else process.env.DSH_PAODING_FAKE_HOST_VERSION = prevFake
  }
})

// ── 生命周期闭环：doctor --fix 与 uninstall ──────────────────────────────────
//
// 判据与只读体检同源（lib/lifecycle.mjs），这里钉的是行为契约：删什么、留什么、
// 备份在哪、防呆退出码，以及「绝不动插件包自身」的口径。

/** main() 的进程内驱动：接管 console 三路输出（返回供断言），退出码原样返回。 */
async function captureMain(argv) {
  const logs = []
  const errors = []
  const orig = { log: console.log, error: console.error, warn: console.warn }
  console.log = (...a) => logs.push(a.join(' '))
  console.error = (...a) => errors.push(a.join(' '))
  console.warn = (...a) => errors.push(a.join(' '))
  try {
    return { code: (await main({ argv })) ?? 0, logs, errors }
  } finally {
    console.log = orig.log
    console.error = orig.error
    console.warn = orig.warn
  }
}

/** DSH_HOME 钉到临时目录的前提下跑 main（跑完恢复原值）。 */
async function captureMainIn(dshHome, argv) {
  const prevHome = process.env.DSH_HOME
  process.env.DSH_HOME = dshHome
  try {
    return await captureMain(argv)
  } finally {
    if (prevHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prevHome
  }
}

/** 摆一条合法声明行文本（config.id 即 presetId）。 */
function rowText(presetId, rowId = presetRowId(presetId)) {
  return [
    `    - id: ${rowId}`,
    "      name: '@deepseek-ai/dsh-agent-preset'",
    '      config:',
    `        id: ${presetId}`,
    '        name: "x"',
  ].join('\n')
}

/** 摆一个「装过」的现场：基础预设目录 + 版本标记 + 工作区目录 + 托管块 + 配置及备份。 */
function plantInstalledHome(tag) {
  const dshHome = mkdtempSync(path.join(os.tmpdir(), `dsh-paoding-${tag}-`))
  const presetDir = path.join(dshHome, '.agent-presets', 'orchestrator')
  mkdirSync(presetDir, { recursive: true })
  writeFileSync(path.join(presetDir, '.generator-version'), '0.4.5\ndeclarative\nptc\nagent-preset\n')
  writeFileSync(path.join(presetDir, 'agent.cordis.yml'), '# 产物占位\n')
  mkdirSync(path.join(dshHome, '.agent-presets', 'orchestrator-xyz'), { recursive: true })
  mkdirSync(path.join(dshHome, '.agent-presets', 'liangshen'), { recursive: true }) // 非庖丁目录
  const patchFile = path.join(dshHome, 'cordis.patch.yml')
  writeFileSync(patchFile, '# 用户自己的 patch 行\n')
  upsertHomePatchRows(dshHome, [rowText('orchestrator')])
  const configFile = path.join(dshHome, 'dsh-paoding.config.yml')
  writeFileSync(configFile, 'profile: web\nroles: {}\n')
  writeFileSync(`${configFile}.bak-20260930`, '旧配置\n')
  return { dshHome, configFile, patchFile, presetDir }
}

test('CLI：parseArgs 认 uninstall 与 --purge / --yes / --fix', () => {
  assert.equal(parseArgs(['uninstall']).command, 'uninstall')
  const un = parseArgs(['uninstall', '--purge', '--yes'])
  assert.equal(un.purge, true)
  assert.equal(un.yes, true)
  const fix = parseArgs(['doctor', '--fix', '--yes'])
  assert.equal(fix.command, 'doctor')
  assert.equal(fix.fix, true)
  assert.equal(fix.yes, true)
})

test('doctor --fix --yes：孤儿工作区目录被删、在册目录保留，退出码 0', async () => {
  const { dshHome, configFile } = freshEnv('fix-dirs')
  const wsPath = '/tmp/dsh-paoding-fix-ws'
  const keepId = presetIdOf(assignSlugs([wsPath]).get(wsPath))
  mkdirSync(path.join(dshHome, '.agent-presets', 'orchestrator-abc'), { recursive: true })
  mkdirSync(path.join(dshHome, '.agent-presets', keepId), { recursive: true })
  writeFileSync(
    configFile,
    ['profile: web', 'roles: {}', 'workspaces:', `  ${wsPath}:`, '    roles: {}', ''].join('\n'),
  )
  const { code } = await captureMainIn(dshHome, ['doctor', '--fix', '--yes'])
  assert.equal(code, 0)
  assert.ok(!existsSync(path.join(dshHome, '.agent-presets', 'orchestrator-abc')), '孤儿目录应被删除')
  assert.ok(existsSync(path.join(dshHome, '.agent-presets', keepId)), '配置在册目录必须保留')
})

test('doctor --fix --yes：干净目录无事可做，不落任何盘', async () => {
  const { dshHome } = freshEnv('fix-clean')
  const { code, logs } = await captureMainIn(dshHome, ['doctor', '--fix', '--yes'])
  assert.equal(code, 0)
  assert.ok(logs.join('\n').includes('已修 0 项'), '汇总应说明没有可修项')
  assert.ok(!existsSync(path.join(dshHome, `cordis.patch.yml.bak-1`)), '没动盘就不该留备份')
})

test('doctor --fix --yes：孤儿/过期声明行被撤（含指向已不存在目录的历史旧 insert），写前备份 .bak-1、块外内容原样', async () => {
  const { dshHome } = freshEnv('fix-rows')
  const presetDir = path.join(dshHome, '.agent-presets', 'orchestrator')
  mkdirSync(presetDir, { recursive: true }) // orchestrator 行指向的目录在：必须保留
  const patchFile = path.join(dshHome, 'cordis.patch.yml')
  writeFileSync(patchFile, '# 用户自己的 patch 行\n') // 托管块外先摆一行用户内容
  upsertHomePatchRows(dshHome, [
    rowText('orchestrator'),
    rowText('orchestrator-wsfoo'), // 目录已删：孤儿行
    rowText('paoding-config-ui', 'preset-paoding-config-ui'), // 历史遗留旧 insert：指向早已不存在的目录
  ])
  const before = readFileSync(patchFile, 'utf8')
  const { code, logs } = await captureMainIn(dshHome, ['doctor', '--fix', '--yes'])
  assert.equal(code, 0)
  const after = readFileSync(patchFile, 'utf8')
  assert.ok(after.includes(presetRowId('orchestrator') + '\n'), '指向存在目录的声明行必须保留')
  assert.ok(!after.includes('orchestrator-wsfoo'), '孤儿声明行应被撤下')
  assert.ok(!after.includes('paoding-config-ui'), '历史遗留旧 insert 应被清理')
  assert.ok(after.startsWith('# 用户自己的 patch 行'), '托管块外的用户内容一字节不动')
  const backup = readFileSync(patchFile + '.bak-1', 'utf8')
  assert.equal(backup, before, '备份应是改动前原貌')
  assert.ok(logs.join('\n').includes('已修 1 项'), `应汇总已修 1 项：${logs.join('\n')}`)
})

test('uninstall --yes：托管块/预设目录/版本标记消失，配置及备份保留，非庖丁目录不动', async () => {
  const { dshHome, configFile, patchFile, presetDir } = plantInstalledHome('uninstall')
  const { code, logs } = await captureMainIn(dshHome, ['uninstall', '--yes'])
  const text = logs.join('\n')
  assert.equal(code, 0)
  assert.ok(!existsSync(presetDir), '基础预设目录应被删除')
  assert.ok(!existsSync(path.join(dshHome, '.agent-presets', 'orchestrator-xyz')), '工作区预设目录应被删除')
  assert.ok(existsSync(path.join(dshHome, '.agent-presets', 'liangshen')), '非庖丁目录绝不能动')
  assert.ok(!existsSync(path.join(presetDir, '.generator-version')) && !existsSync(
    path.join(dshHome, '.agent-presets', 'orchestrator', '.generator-version'),
  ), '版本标记应随目录一并删除')
  const patch = readFileSync(patchFile, 'utf8')
  assert.ok(!patch.includes(MANAGED_BEGIN), '托管块应整块移除')
  assert.equal(patch, '# 用户自己的 patch 行\n', '托管块外的用户内容原样保留')
  assert.ok(existsSync(configFile), '默认保留配置文件（用户数据）')
  assert.ok(existsSync(`${configFile}.bak-20260930`), '默认保留配置备份')
  assert.ok(text.includes(`配置已保留在 ${configFile}`), '应打印配置保留提示')
  assert.ok(text.includes('dsh plugin remove dsh-paoding'), '应打印包本体卸载提示')
})

test('uninstall --yes --purge：配置与 .bak* 备份一并删除', async () => {
  const { dshHome, configFile } = plantInstalledHome('purge')
  const { code, logs } = await captureMainIn(dshHome, ['uninstall', '--yes', '--purge'])
  assert.equal(code, 0)
  assert.ok(!existsSync(configFile), '--purge 应删除配置文件')
  assert.ok(!existsSync(`${configFile}.bak-20260930`), '--purge 应删除配置备份')
  assert.ok(!logs.join('\n').includes('配置已保留在'), '--purge 下不该再提示保留')
})

test('uninstall --yes：干净目录无事可做，退出码 0', async () => {
  const { dshHome } = freshEnv('uninstall-clean')
  const { code } = await captureMainIn(dshHome, ['uninstall', '--yes'])
  assert.equal(code, 0)
})

test('非 TTY 无 --yes：uninstall / doctor --fix 只列计划不落盘，退出码 2', () => {
  const { dshHome } = freshEnv('guard')
  mkdirSync(path.join(dshHome, '.agent-presets', 'orchestrator-abc'), { recursive: true })
  upsertHomePatchRows(dshHome, [ORPHAN_ROW_TEXT])
  const entry = fileURLToPath(new URL('../tools/install.mjs', import.meta.url))
  const env = { ...process.env, DSH_HOME: dshHome }
  const dir = path.join(dshHome, '.agent-presets', 'orchestrator-abc')
  const patchFile = path.join(dshHome, 'cordis.patch.yml')

  const un = spawnSync(process.execPath, [entry, 'uninstall'], { env, encoding: 'utf8' })
  assert.equal(un.status, 2, `uninstall 防呆退出码应为 2，实际 ${un.status}：${un.stderr}`)
  assert.ok(un.stderr.includes('--yes'), '应提示需要显式 --yes')
  assert.ok(existsSync(dir), '防呆路径绝不能删目录')
  assert.ok(readFileSync(patchFile, 'utf8').includes(MANAGED_BEGIN), '防呆路径绝不能动托管块')

  const fix = spawnSync(process.execPath, [entry, 'doctor', '--fix'], { env, encoding: 'utf8' })
  assert.equal(fix.status, 2, `doctor --fix 防呆退出码应为 2，实际 ${fix.status}：${fix.stderr}`)
  assert.ok(existsSync(dir), '防呆路径绝不能删目录')
  assert.ok(
    readHomePatchRows(dshHome).some((row) => row.rowId === 'preset-orchestrator-wsfoo'),
    '防呆路径绝不能撤声明行',
  )
})

test('doctor --fix 非 TTY 加 --yes 照常执行（子进程全链路）', () => {
  const { dshHome } = freshEnv('guard-yes')
  mkdirSync(path.join(dshHome, '.agent-presets', 'orchestrator-abc'), { recursive: true })
  const entry = fileURLToPath(new URL('../tools/install.mjs', import.meta.url))
  const env = { ...process.env, DSH_HOME: dshHome }
  const run = spawnSync(process.execPath, [entry, 'doctor', '--fix', '--yes'], { env, encoding: 'utf8' })
  assert.equal(run.status, 0, `应执行成功，实际 ${run.status}：${run.stderr}`)
  assert.ok(!existsSync(path.join(dshHome, '.agent-presets', 'orchestrator-abc')), '--yes 应真正删除孤儿目录')
})
