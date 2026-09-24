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

const markerFileOf = (dshHome) => path.join(dshHome, '.agent-presets', 'orchestrator', '.generator-version')
const agentFileOf = (dshHome, presetId = 'orchestrator') => path.join(dshHome, '.agent-presets', presetId, 'agent.cordis.yml')

test('首装（无标记）：directory 宿主整盘重生成，标记记版本+轨道，不写声明行', async () => {
  const { dshHome, configFile } = freshEnv('fresh-dir')
  await withEnv(configFile, async () => {
    const r = await ensurePresetInstalled({ dshHome, generatorVersion: GEN })
    assert.equal(r.installed, true)
    assert.ok(existsSync(agentFileOf(dshHome)), 'preset 三件套应落盘')
    assert.equal(readFileSync(markerFileOf(dshHome), 'utf8'), `${GEN}\ndirectory\n`)
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
    assert.equal(readFileSync(markerFileOf(dshHome), 'utf8'), `${GEN}\ndeclarative\n`)
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
    assert.equal(readFileSync(markerFileOf(dshHome), 'utf8'), `${GEN}\ndeclarative\n`, '标记升级为带轨道格式')
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
    assert.equal(readFileSync(markerFileOf(dshHome), 'utf8'), `${GEN}\ndirectory\n`)
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
