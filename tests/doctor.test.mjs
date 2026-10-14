/**
 * `dsh-paoding doctor` 只读体检回归测试（node:test）。
 *
 * 禁网络 / 不依赖真实 $DSH_HOME：临时 dshHome，按项摆好（或刻意摆坏）前置事实，
 * 断言 runDoctor 的结构化 items 与退出码语义。轨道 / 宿主版本探测在本机 dsh
 * 存在与否两种环境下都能过：相关断言只盯摆坏的事实，不假设探测结果。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { collectState, generateAndInstall } from '../tools/install.mjs'
import { runDoctor } from '../tools/lib/doctor.mjs'
import {
  MANAGED_BEGIN,
  MANAGED_END,
  detectHostVersionTriple,
  formatGeneratorMarker,
  isDeclarativeTriple,
  isPtcWorkerHost,
  presetRowId,
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
