/**
 * ensurePresetInstalled 决策树回归（node:test，禁网络；禁依赖真实 $DSH_HOME /
 * DSH_PAODING_CONFIG / PATH 上的真 dsh——轨道探测在本文件里走 $DSH_HOME 单数
 * 包文件探测 rung，dsh --version rung 用假 PATH 中和）。
 *
 * 钉死的核心场景：**只升 dsh 不动插件**（标记版本照旧吻合、宿主轨道翻转、
 * 旧格式标记无轨道行）→ 声明行按磁盘产物补写、preset 内容字节不动、不整盘
 * 重生成——2026-09-24 本机 0.1.6→0.1.7 升级后主子代理静默消失事故的根因路径。
 * 另覆盖：首装两轨、幂等跳过（字节级不动）、声明行被外部删除后的对账补行、
 * 宿主降级撤块、产物不全目录跳过、shouldAbort 不写盘。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { ensurePresetInstalled } from '../plugins/paoding-config-ui/api-core.mjs'
import { readHomePatchRows } from '../tools/lib/preset-system.mjs'
import { normalizeTargetFields, saveConfig } from '../tools/lib/config.mjs'

/** 与真实包版本无关的生成器版本（决策只看相等性）。 */
const GEN = '0.9.9-test'

/** 空白隔离环境：临时 dshHome + 指向其内的配置文件路径。 */
function freshEnv(tag) {
  const dshHome = mkdtempSync(path.join(os.tmpdir(), `dsh-paoding-ensure-${tag}-`))
  return { dshHome, configFile: path.join(dshHome, 'dsh-paoding.config.yml'), patchFile: path.join(dshHome, 'cordis.patch.yml') }
}

/** 声明轨宿主：装上单数包 @deepseek-ai/dsh-agent-preset（0.1.7 组件）。 */
function makeDeclarative(dshHome) {
  mkdirSync(path.join(dshHome, 'node_modules', '@deepseek-ai', 'dsh-agent-preset'), { recursive: true })
}

/** directory 宿主：撤掉单数包（其余探测 rung 均被中和）。 */
function makeDirectory(dshHome) {
  rmSync(path.join(dshHome, 'node_modules', '@deepseek-ai', 'dsh-agent-preset'), { recursive: true, force: true })
}

/** 中和 PATH + 指定配置文件的运行环境包装（用毕还原）。 */
async function withEnv(configFile, fn) {
  const prevPath = process.env.PATH
  const prevConfig = process.env.DSH_PAODING_CONFIG
  process.env.PATH = '/nonexistent-dsh-paoding-test'
  process.env.DSH_PAODING_CONFIG = configFile
  try {
    return await fn()
  } finally {
    process.env.PATH = prevPath
    if (prevConfig === undefined) delete process.env.DSH_PAODING_CONFIG
    else process.env.DSH_PAODING_CONFIG = prevConfig
  }
}

/** withEnv + 假宿主版本（DSH_PAODING_FAKE_HOST_VERSION 探测钩子，用毕还原）。 */
async function withHostVersion(configFile, version, fn) {
  const prevFake = process.env.DSH_PAODING_FAKE_HOST_VERSION
  process.env.DSH_PAODING_FAKE_HOST_VERSION = version
  try {
    return await withEnv(configFile, fn)
  } finally {
    if (prevFake === undefined) delete process.env.DSH_PAODING_FAKE_HOST_VERSION
    else process.env.DSH_PAODING_FAKE_HOST_VERSION = prevFake
  }
}

const markerFileOf = (dshHome) => path.join(dshHome, '.agent-presets', 'orchestrator', '.generator-version')
const roleRestrictFileOf = (dshHome, presetId = 'orchestrator') => path.join(dshHome, '.agent-presets', presetId, 'role-restrict.mjs')
const agentFileOf = (dshHome, presetId = 'orchestrator') => path.join(dshHome, '.agent-presets', presetId, 'agent.cordis.yml')
const labelsFileOf = (dshHome, presetId = 'orchestrator') => path.join(dshHome, '.agent-presets', presetId, 'delegation-labels.mjs')

test('首装（无标记）：directory 宿主整盘重生成，标记记版本+轨道，不写声明行', async () => {
  const { dshHome, configFile } = freshEnv('fresh-dir')
  await withEnv(configFile, async () => {
    const r = await ensurePresetInstalled({ dshHome, generatorVersion: GEN })
    assert.equal(r.installed, true)
    assert.ok(existsSync(agentFileOf(dshHome)), 'preset 三件套应落盘')
    assert.ok(existsSync(labelsFileOf(dshHome)), 'delegation-labels.mjs 应随 restrict.mjs 一起落盘')
    assert.equal(readFileSync(markerFileOf(dshHome), 'utf8'), `${GEN}\ndirectory\nworker-thread\ninline\n`)
    assert.deepEqual(readHomePatchRows(dshHome), [], 'directory 轨不得写声明行')
    assert.ok(existsSync(configFile), 'fresh 安装应落基础模板配置')
  })
})

test('首装（无标记）：declarative 宿主重生成 + 写声明行；再跑幂等跳过（字节不动）', async () => {
  const { dshHome, configFile, patchFile } = freshEnv('fresh-decl')
  makeDeclarative(dshHome)
  await withEnv(configFile, async () => {
    const r = await ensurePresetInstalled({ dshHome, generatorVersion: GEN })
    assert.equal(r.installed, true)
    assert.equal(readFileSync(markerFileOf(dshHome), 'utf8'), `${GEN}\ndeclarative\nworker-thread\ninline\n`)
    assert.deepEqual(readHomePatchRows(dshHome), [{ rowId: 'preset-orchestrator', presetId: 'orchestrator' }])

    // 幂等：版本轨道一致 + 行齐 → 跳过，marker 与 patch 字节级不动
    const markerBefore = readFileSync(markerFileOf(dshHome), 'utf8')
    const patchBefore = readFileSync(patchFile, 'utf8')
    const agentBefore = readFileSync(agentFileOf(dshHome), 'utf8')
    const r2 = await ensurePresetInstalled({ dshHome, generatorVersion: GEN })
    assert.equal(r2.installed, false)
    assert.ok(!Array.isArray(r2.backfilled) || r2.backfilled.length === 0)
    assert.equal(readFileSync(markerFileOf(dshHome), 'utf8'), markerBefore)
    assert.equal(readFileSync(patchFile, 'utf8'), patchBefore)
    assert.equal(readFileSync(agentFileOf(dshHome), 'utf8'), agentBefore)
  })
})

test('事故主路径：只升 dsh 不动插件（旧格式标记 + 轨道翻转）→ 补声明行，内容零重生成', async () => {
  const { dshHome, configFile } = freshEnv('upgrade')
  await withEnv(configFile, async () => {
    // 0.1.6 时代落盘：directory 宿主首装（版本即当前版本，标记吻合）
    await ensurePresetInstalled({ dshHome, generatorVersion: GEN })
    // 再放一个工作区 preset 目录（模拟 orchestrator-obsidian），改名以示区分
    const ws = path.join(dshHome, '.agent-presets', 'orchestrator-ws1')
    cpSync(path.join(dshHome, '.agent-presets', 'orchestrator'), ws, { recursive: true })
    const presetYml = path.join(ws, 'preset.yml')
    writeFileSync(presetYml, readFileSync(presetYml, 'utf8').replace(/^name:.*$/m, 'name: 编排模式·ws1'))
    // 旧格式标记（0.3.4 及以前：单行版本、无轨道行）——事故现场的标记形态
    writeFileSync(markerFileOf(dshHome), `${GEN}\n`)

    const agentBefore = readFileSync(agentFileOf(dshHome), 'utf8')
    const wsAgentBefore = readFileSync(agentFileOf(dshHome, 'orchestrator-ws1'), 'utf8')

    // 宿主升 0.1.7（声明轨）后首次启动
    makeDeclarative(dshHome)
    const r = await ensurePresetInstalled({ dshHome, generatorVersion: GEN })
    assert.equal(r.installed, false, '版本一致：不得整盘重生成')
    assert.deepEqual([...(r.backfilled ?? [])].sort(), ['orchestrator', 'orchestrator-ws1'])
    assert.equal(readFileSync(agentFileOf(dshHome), 'utf8'), agentBefore, 'preset 内容字节不动')
    assert.equal(readFileSync(agentFileOf(dshHome, 'orchestrator-ws1'), 'utf8'), wsAgentBefore)
    assert.equal(readFileSync(markerFileOf(dshHome), 'utf8'), `${GEN}\ndeclarative\nworker-thread\ninline\n`, '标记升级为带轨道格式')
    assert.deepEqual(readHomePatchRows(dshHome).map((x) => x.presetId).sort(), ['orchestrator', 'orchestrator-ws1'])
  })
})

test('声明行被外部删除（版本轨道均一致）→ 对账补行，标记字节不变', async () => {
  const { dshHome, configFile, patchFile } = freshEnv('row-deleted')
  makeDeclarative(dshHome)
  await withEnv(configFile, async () => {
    await ensurePresetInstalled({ dshHome, generatorVersion: GEN })
    const markerBefore = readFileSync(markerFileOf(dshHome), 'utf8')
    rmSync(patchFile) // 用户重建 home patch 等场景：托管块整块丢失
    const r = await ensurePresetInstalled({ dshHome, generatorVersion: GEN })
    assert.deepEqual(r.backfilled, ['orchestrator'])
    assert.equal(readHomePatchRows(dshHome).length, 1)
    assert.equal(readFileSync(markerFileOf(dshHome), 'utf8'), markerBefore, '轨道没变：标记重写同内容')
  })
})

test('宿主降级（declarative→directory、声明行残留）→ 整盘重生成并撤块', async () => {
  const { dshHome, configFile } = freshEnv('downgrade')
  makeDeclarative(dshHome)
  await withEnv(configFile, async () => {
    await ensurePresetInstalled({ dshHome, generatorVersion: GEN })
    assert.ok(readHomePatchRows(dshHome).length > 0, '前置：声明行在场')
    makeDirectory(dshHome)
    const r = await ensurePresetInstalled({ dshHome, generatorVersion: GEN })
    assert.equal(r.installed, true, '残留声明行会让 0.1.6 profile 启动失败，必须走重生成撤块')
    assert.deepEqual(readHomePatchRows(dshHome), [])
    assert.equal(readFileSync(markerFileOf(dshHome), 'utf8'), `${GEN}\ndirectory\nworker-thread\ninline\n`)
  })
})

test('产物不全的工作区目录：补行跳过、不拖垮其余', async () => {
  const { dshHome, configFile } = freshEnv('broken-ws')
  makeDeclarative(dshHome)
  await withEnv(configFile, async () => {
    await ensurePresetInstalled({ dshHome, generatorVersion: GEN })
    const base = path.join(dshHome, '.agent-presets', 'orchestrator')
    // 只有一个不全的工作区目录：缺 restrict.mjs / preset.yml
    const ws2 = path.join(dshHome, '.agent-presets', 'orchestrator-ws2')
    mkdirSync(ws2, { recursive: true })
    cpSync(path.join(base, 'agent.cordis.yml'), path.join(ws2, 'agent.cordis.yml'))
    rmSync(path.join(dshHome, 'cordis.patch.yml')) // 清掉行，逼出补行路径
    const r = await ensurePresetInstalled({ dshHome, generatorVersion: GEN })
    assert.ok(!r.error, `不得报错: ${r.error}`)
    assert.deepEqual(r.backfilled, ['orchestrator'], '不全目录跳过、健全目录照补')
    assert.ok(!readHomePatchRows(dshHome).some((x) => x.presetId === 'orchestrator-ws2'))
  })
})

test('shouldAbort：插件已卸载 → 中止且不写盘', async () => {
  const { dshHome, configFile } = freshEnv('abort')
  await withEnv(configFile, async () => {
    const r = await ensurePresetInstalled({ dshHome, generatorVersion: GEN, shouldAbort: () => true })
    assert.equal(r.installed, false)
    assert.equal(r.reason, '插件已卸载（dispose），本次 preset 生成中止')
    assert.ok(!existsSync(path.join(dshHome, '.agent-presets')), '中止后不得有任何落盘')
  })
})

// ── workflow worker 形态换代（宿主版本探测 → 生成期换行 → 标记 v3 第三行）────

// 假宿主包 + 子进程驱动：把 driver 脚本放进形如 dsh/lib/ 的假宿主包内，argv[1]
// 向上一级命中假 package.json → detectHostVersionTriple 的 argv rung 精确命中
// 伪造宿主版本（父进程无法改自身 argv，只能 spawn）。PATH 一律中和，禁真 dsh。
const HOST_VERSION_PTC = '0.2.0-rc.2' // ≥0.1.6：workflow-ptc
const HOST_VERSION_WORKER_THREAD = '0.1.5-rc.3' // 0.1.5：workflow-worker-thread

async function runEnsureInFakeHost(hostVersion, dshHome, configFile) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-paoding-fakehost-'))
  const fake = path.join(root, `dsh-${hostVersion}`)
  mkdirSync(path.join(fake, 'lib'), { recursive: true })
  writeFileSync(path.join(fake, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: hostVersion }))
  const modUrl = new URL('../plugins/paoding-config-ui/api-core.mjs', import.meta.url).href
  const driver = path.join(fake, 'lib', 'driver.mjs')
  writeFileSync(driver, [
    `import { ensurePresetInstalled } from ${JSON.stringify(modUrl)}`,
    `const r = await ensurePresetInstalled({ dshHome: ${JSON.stringify(dshHome)}, generatorVersion: ${JSON.stringify(GEN)} })`,
    'process.stdout.write(JSON.stringify(r))',
    '',
  ].join('\n'))
  const { spawnSync } = await import('node:child_process')
  const res = spawnSync(process.execPath, [driver], {
    encoding: 'utf8',
    env: { ...process.env, PATH: '/nonexistent-dsh-paoding-test', DSH_PAODING_CONFIG: configFile },
  })
  assert.equal(res.status, 0, `driver 应正常退出（stderr: ${res.stderr}）`)
  return JSON.parse(res.stdout)
}

test('worker 形态: 0.2.0 宿主首装 → 产物含 workflow-ptc、无旧包行，标记第三行记 ptc；再跑幂等', async () => {
  const { dshHome, configFile } = freshEnv('worker-ptc')
  const r = await runEnsureInFakeHost(HOST_VERSION_PTC, dshHome, configFile)
  assert.equal(r.installed, true)
  const agentText = readFileSync(agentFileOf(dshHome), 'utf8')
  assert.ok(agentText.includes('- id: workflow-ptc'), '0.2.0 宿主产物缺 workflow-ptc 行')
  assert.ok(!agentText.includes("'@deepseek-ai/dsh-workflow-worker-thread'"), '0.2.0 宿主产物残留旧包行')
  assert.equal(readFileSync(markerFileOf(dshHome), 'utf8'), `${GEN}\ndeclarative\nptc\ninline\n`)
  // 幂等：worker 形态一致 → 轻量路径，字节不动
  const agentBefore = agentText
  const r2 = await runEnsureInFakeHost(HOST_VERSION_PTC, dshHome, configFile)
  assert.equal(r2.installed, false)
  assert.equal(readFileSync(agentFileOf(dshHome), 'utf8'), agentBefore)
})

test('worker 形态: 0.1.5 宿主保留 worker-thread 行；v2 旧标记 + 0.2.0 宿主 → 整盘重生成换代', async () => {
  const { dshHome, configFile } = freshEnv('worker-migrate')
  // 0.1.5 时代：产物保留源模板 worker-thread 行，标记第三行记 worker-thread
  const r = await runEnsureInFakeHost(HOST_VERSION_WORKER_THREAD, dshHome, configFile)
  assert.equal(r.installed, true)
  assert.ok(readFileSync(agentFileOf(dshHome), 'utf8').includes("'@deepseek-ai/dsh-workflow-worker-thread'"))
  assert.equal(readFileSync(markerFileOf(dshHome), 'utf8'), `${GEN}\ndirectory\nworker-thread\ninline\n`)
  // 模拟旧版插件写的 v2 标记（无第三行）
  writeFileSync(markerFileOf(dshHome), `${GEN}\ndirectory\n`)
  // 宿主升 0.2.0：worker 形态分叉 → 整盘重生成，产物换代 + 标记升 v3
  const r2 = await runEnsureInFakeHost(HOST_VERSION_PTC, dshHome, configFile)
  assert.equal(r2.installed, true, 'worker 形态分叉必须整盘重生成')
  const agentText = readFileSync(agentFileOf(dshHome), 'utf8')
  assert.ok(agentText.includes('- id: workflow-ptc'), '重生成后仍缺 workflow-ptc 行')
  assert.ok(!agentText.includes("'@deepseek-ai/dsh-workflow-worker-thread'"), '重生成后残留旧包行')
  assert.equal(readFileSync(markerFileOf(dshHome), 'utf8'), `${GEN}\ndeclarative\nptc\ninline\n`)
})

// ── 0.2.1 角色行换代（agentPreset 形态）──────────────────────────────────────

test('0.2.1 宿主首装（declarative）：agentPreset 角色形态落盘 + role-restrict.mjs 随源清单落盘 + 标记第四行', async () => {
  const { dshHome, configFile, patchFile } = freshEnv('fresh-021')
  makeDeclarative(dshHome)
  await withHostVersion(configFile, '0.2.1', async () => {
    const r = await ensurePresetInstalled({ dshHome, generatorVersion: GEN })
    assert.equal(r.installed, true)
    const agentText = readFileSync(agentFileOf(dshHome), 'utf8')
    assert.ok(agentText.includes('- id: paoding-role-search_external'), '角色子预设行应落盘')
    assert.ok(agentText.includes('agentPreset: paoding-role-search_external'), '委派行应带 agentPreset 引用')
    assert.ok(!/        persona: \|-/.test(agentText), '0.2.1 形态不得残留内联角色 persona（0.2.1 宿主 apply 必炸）')
    assert.ok(existsSync(roleRestrictFileOf(dshHome)), 'role-restrict.mjs 应随 PRESET_ASIS_FILES 落盘')
    // 完整组合：角色子预设自带 standard 基础行（6 空格缩进 = plugins 条目层级；
    // 0.2.1 显式选择 preset 时子 agent 不继承父 preset）
    assert.ok(agentText.includes('\n      - id: tool-bash'), '角色子预设应自带 standard 基础行')
    // fake 0.2.1 → worker=ptc、roles=agent-preset，标记四行齐
    assert.equal(readFileSync(markerFileOf(dshHome), 'utf8'), `${GEN}\ndeclarative\nptc\nagent-preset\n`)
    // 声明行文本应把 role-restrict 行绝对化为 file: URL（agentYmlText 引用了该行）
    const patchText = readFileSync(patchFile, 'utf8')
    assert.ok(patchText.includes('role-restrict.mjs') && patchText.includes('file://'), '声明行缺 role-restrict file: URL')
  })
})

test('事故新路径：宿主 0.2.0→0.2.1 只升 dsh 不动插件（标记版本/轨道/worker 全吻合，roles=inline）→ 整盘重生成换角色形状', async () => {
  const { dshHome, configFile } = freshEnv('upgrade-021')
  makeDeclarative(dshHome)
  // 0.2.0 时代落盘：内联形状 + 标记 roles=inline
  await withHostVersion(configFile, '0.2.0', async () => {
    const r = await ensurePresetInstalled({ dshHome, generatorVersion: GEN })
    assert.equal(r.installed, true)
    assert.equal(readFileSync(markerFileOf(dshHome), 'utf8'), `${GEN}\ndeclarative\nptc\ninline\n`)
    assert.ok(/        persona: \|-/.test(readFileSync(agentFileOf(dshHome), 'utf8')), '0.2.0 落盘应为内联形状')
  })
  // 宿主升 0.2.1：标记 roles 与宿主所需分叉 → 轻量路径不可用，整盘重生成
  await withHostVersion(configFile, '0.2.1', async () => {
    const r = await ensurePresetInstalled({ dshHome, generatorVersion: GEN })
    assert.equal(r.installed, true, '角色行形态换代应触发整盘重生成')
    const agentText = readFileSync(agentFileOf(dshHome), 'utf8')
    assert.ok(agentText.includes('agentPreset: paoding-role-search_external'), '重生成后应为 agentPreset 形态')
    assert.ok(!/        persona: \|-/.test(agentText), '重生成后不得残留内联角色 persona')
    assert.equal(readFileSync(markerFileOf(dshHome), 'utf8'), `${GEN}\ndeclarative\nptc\nagent-preset\n`)
    // 幂等：版本轨道 worker roles 全吻合后 → 跳过，字节不动
    const agentBefore = readFileSync(agentFileOf(dshHome), 'utf8')
    const r2 = await ensurePresetInstalled({ dshHome, generatorVersion: GEN })
    assert.equal(r2.installed, false)
    assert.equal(readFileSync(agentFileOf(dshHome), 'utf8'), agentBefore)
  })
})

test('防毒兜底：磁盘产物被回滚成内联形状而标记已换代吻合 → 补行守卫拒写旧形状、标记产物不动', async () => {
  const { dshHome, configFile, patchFile } = freshEnv('poison-belt')
  makeDeclarative(dshHome)
  await withHostVersion(configFile, '0.2.1', async () => {
    // 首装：新形状 + v4 标记（roles=agent-preset）
    const r0 = await ensurePresetInstalled({ dshHome, generatorVersion: GEN })
    assert.equal(r0.installed, true)

    // 毒化磁盘：产物整体回滚成内联形状（模拟旧备份还原 / 手改），标记不动，
    // patch 行清空（行缺失才走 ensure 轻量路径的补行）
    writeFileSync(agentFileOf(dshHome), readFileSync(new URL('../presets/orchestrator/agent.cordis.yml', import.meta.url), 'utf8'))
    writeFileSync(patchFile, '')

    const r = await ensurePresetInstalled({ dshHome, generatorVersion: GEN })
    assert.equal(r.installed, false)
    assert.ok(!Array.isArray(r.backfilled) || r.backfilled.length === 0, '防毒守卫应拒绝按内联产物补行')
    const patchText = readFileSync(patchFile, 'utf8')
    assert.ok(!/        persona: \|-\n/.test(patchText), '内联 persona 行不得被补回 patch（0.2.1 宿主 apply 必炸）')
    assert.ok(!patchText.includes('toolFilter:'), '内联 toolFilter 不得被补回 patch')
    // 等待整盘重生成换代：标记与磁盘毒产物都不该被轻量路径改动
    assert.equal(readFileSync(markerFileOf(dshHome), 'utf8'), `${GEN}\ndeclarative\nptc\nagent-preset\n`)
  })
})

test('v3 三行标记（旧插件自愈痕迹）+ 0.2.1 宿主：roles 视为不符 → 整盘重生成换角色形状', async () => {
  const { dshHome, configFile } = freshEnv('v3-marker-021')
  makeDeclarative(dshHome)
  // 0.2.0 时代落盘内联形状
  await withHostVersion(configFile, '0.2.0', async () => {
    const r = await ensurePresetInstalled({ dshHome, generatorVersion: GEN })
    assert.equal(r.installed, true)
  })
  // 回写旧插件的三行标记（roles 行缺失 = 旧生成器自愈产物）
  writeFileSync(markerFileOf(dshHome), `${GEN}\ndeclarative\nptc\n`)
  assert.ok(/        persona: \|-\n/.test(readFileSync(agentFileOf(dshHome), 'utf8')), '前置：磁盘为内联形状')

  await withHostVersion(configFile, '0.2.1', async () => {
    const r = await ensurePresetInstalled({ dshHome, generatorVersion: GEN })
    assert.equal(r.installed, true, '三行标记在 0.2.1 宿主上应触发整盘重生成')
    const agentText = readFileSync(agentFileOf(dshHome), 'utf8')
    assert.ok(agentText.includes('agentPreset: paoding-role-search_external'), '重生成后应为 agentPreset 形态')
    assert.ok(!/        persona: \|-\n/.test(agentText), '重生成后不得残留内联角色 persona')
    assert.equal(readFileSync(markerFileOf(dshHome), 'utf8'), `${GEN}\ndeclarative\nptc\nagent-preset\n`)
  })
})

test('工作区预设形态换代：宿主 0.2.0→0.2.1 整盘重生成后，存量 orchestrator-<slug> 产物同步换代', async () => {
  const { dshHome, configFile, patchFile } = freshEnv('ws-migrate')
  makeDeclarative(dshHome)
  const wsPath = path.join(dshHome, 'projects', 'obsidian')
  mkdirSync(wsPath, { recursive: true })
  const roleAssignment = { roles: { implement: { persona: '实现角色', tools: ['read', 'edit'] } } }
  saveConfig(configFile, {
    profile: null,
    ...normalizeTargetFields(roleAssignment),
    workspaces: { [wsPath]: normalizeTargetFields(roleAssignment) },
  })

  // 0.2.0 时代：基础 preset 内联形状落盘；工作区产物是旧版插件应用后的内联形状
  //（ensure 只管基础盘，工作区盘用 cpSync 造）
  await withHostVersion(configFile, '0.2.0', async () => {
    const r = await ensurePresetInstalled({ dshHome, generatorVersion: GEN })
    assert.equal(r.installed, true)
    assert.ok(/        persona: \|-\n/.test(readFileSync(agentFileOf(dshHome), 'utf8')), '前置：基础盘为内联形状')
  })
  const wsDir = path.join(dshHome, '.agent-presets', 'orchestrator-obsidian')
  cpSync(path.join(dshHome, '.agent-presets', 'orchestrator'), wsDir, { recursive: true })
  assert.ok(/        persona: \|-\n/.test(readFileSync(path.join(wsDir, 'agent.cordis.yml'), 'utf8')), '前置：工作区盘为内联形状')

  // 宿主升 0.2.1-rc.2：基础整盘重生成，工作区产物随自愈换代（配置段原样保留）
  await withHostVersion(configFile, '0.2.1-rc.2', async () => {
    const r = await ensurePresetInstalled({ dshHome, generatorVersion: GEN })
    assert.equal(r.installed, true)
    assert.deepEqual(r.migratedPresets, ['orchestrator-obsidian'], '工作区预设应随自愈换代')
    assert.ok(r.reason.includes('工作区预设角色行已换代'), `reason 应点名换代：${r.reason}`)
    const wsAgent = readFileSync(path.join(wsDir, 'agent.cordis.yml'), 'utf8')
    assert.ok(wsAgent.includes('agentPreset: paoding-role-implement'), '工作区委派行应带 agentPreset 引用')
    assert.ok(!/        persona: \|-\n/.test(wsAgent), '工作区产物不得残留内联 persona（0.2.1 守卫必炸）')
    assert.ok(existsSync(roleRestrictFileOf(dshHome, 'orchestrator-obsidian')), 'role-restrict.mjs 应随工作区落盘')
    // 声明行：基础 + 工作区两行齐、无内联形状行
    const rowIds = readHomePatchRows(dshHome).map((r2) => r2.rowId).sort()
    assert.deepEqual(rowIds, ['preset-orchestrator', 'preset-orchestrator-obsidian'])
    const patchText = readFileSync(patchFile, 'utf8')
    assert.ok(!patchText.includes('toolFilter:'), 'patch 不得残留内联 toolFilter')
    // 配置 workspaces 段原样保留（只换代产物，不回写配置）
    const configText = readFileSync(configFile, 'utf8')
    assert.ok(configText.includes(wsPath), '配置 workspaces 条目应原样保留')
    // 基础盘同步换代（同一轮自愈）
    assert.ok(!/        persona: \|-\n/.test(readFileSync(agentFileOf(dshHome), 'utf8')), '基础盘应为 agentPreset 形态')

    // 幂等：形态齐了再跑 → 跳过、字节不动、无 migratedPresets
    const wsBefore = readFileSync(path.join(wsDir, 'agent.cordis.yml'), 'utf8')
    const r2 = await ensurePresetInstalled({ dshHome, generatorVersion: GEN })
    assert.equal(r2.installed, false)
    assert.ok(!Array.isArray(r2.migratedPresets) || r2.migratedPresets.length === 0, '形态吻合不应再动工作区盘')
    assert.equal(readFileSync(path.join(wsDir, 'agent.cordis.yml'), 'utf8'), wsBefore)
  })
})

test('宿主 0.2.1-rc.1（守卫未落地）：标记 roles=inline 与所需 inline 相符 → 轻量路径跳过，不换代', async () => {
  const { dshHome, configFile } = freshEnv('rc1-light')
  makeDeclarative(dshHome)
  await withHostVersion(configFile, '0.2.0', async () => {
    const r = await ensurePresetInstalled({ dshHome, generatorVersion: GEN })
    assert.equal(r.installed, true)
  })
  await withHostVersion(configFile, '0.2.1-rc.1', async () => {
    const r = await ensurePresetInstalled({ dshHome, generatorVersion: GEN })
    assert.equal(r.installed, false, 'rc.1 宿主所需形态仍是 inline，不该重生成')
    assert.ok(/        persona: \|-\n/.test(readFileSync(agentFileOf(dshHome), 'utf8')), '内联产物应原样保留')
    assert.equal(readFileSync(markerFileOf(dshHome), 'utf8'), `${GEN}\ndeclarative\nptc\ninline\n`, '标记不动')
  })
})
