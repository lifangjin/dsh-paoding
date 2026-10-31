/**
 * patch 层感知与写盘校验回归（node:test，禁网络；禁依赖真实 $DSH_HOME /
 * DSH_PAODING_CONFIG / PATH 上的真 dsh——dshHome / patch 文件一律临时目录）。
 * 背景：Android compat 壳（DeepSeekHarnessCompat）每次 boot 重写 home 层
 * cordis.patch.yml 并把声明行显示元数据压平成「- id: 显示名 (英文名)」+ 深缩
 * 进键的坏行，宿主在任何插件代码运行前死于 YAML 解析（dsh-maoying#1 同款问
 * 题）。钉死的场景：
 *   - 层判定链：config patch_layer > DSH_PAODING_PATCH_LAYER > compat 壳探测 >
 *     缺省 home；argv --profile 胜过配置 profile 键；
 *   - generateAndInstall / ensurePresetInstalled 声明行落目标层 + reconcile 撤
 *     home 遗留块 + 第二次运行零写盘（自愈不空转）；
 *   - 写盘校验回滚：文件已含坏行时 upsert / strip 抛错且字节一字节不动（防止
 *     把宿主启动必死的文件留在盘上）；
 *   - findSuspectPresetRows 坏行探测（块外才扫、块内自家声明行不误报）；
 *   - reconcilePatchLayers 用户内容逐字节保留；
 *   - 双层清理（managedBlockStateAll / cleanupPaodingArtifacts / planUninstall）。
 *
 * 校验回滚测试需要真实 yaml 包（宿主解析口径；内置回退解析器 lenient，挡不住
 * 坏缩进）：yamlFixtureOf 解析序 DSH_PAODING_TEST_YAML_DIR 环境变量 > 仓库
 * node_modules > ~/.dsh/node_modules（宿主自带 yaml v2）；解析不到时相关用例
 * skip 并说明——其他用例不依赖 yaml。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  MANAGED_BEGIN,
  MANAGED_END,
  buildPresetRowText,
  findSuspectPresetRows,
  isCompatShellLike,
  readHomePatchRows,
  reconcilePatchLayers,
  resolvePatchTargetLayer,
  stripHomePatchRows,
  upsertHomePatchRows,
} from '../tools/lib/preset-system.mjs'
import { cleanupPaodingArtifacts, managedBlockState, managedBlockStateAll, planUninstall } from '../tools/lib/lifecycle.mjs'
import { ensurePresetInstalled } from '../plugins/paoding-config-ui/api-core.mjs'
import { collectState, generateAndInstall } from '../tools/install.mjs'
import { loadConfig, normalizeConfig, serializeConfig } from '../tools/lib/config.mjs'

const GEN = '0.9.9-test'

// ── 环境 fixture ─────────────────────────────────────────────────────────────

/** 空白隔离环境：临时 dshHome（无 patch / 无配置 / 无 profiles 目录）。 */
function freshEnv(tag) {
  const dshHome = mkdtempSync(path.join(os.tmpdir(), `dsh-paoding-layer-${tag}-`))
  return {
    dshHome,
    configFile: path.join(dshHome, 'dsh-paoding.config.yml'),
    patchFile: path.join(dshHome, 'cordis.patch.yml'),
    profilesDir: path.join(dshHome, 'profiles'),
    profilePatchFile: (name = 'web') => path.join(dshHome, 'profiles', name, 'cordis.patch.yml'),
  }
}

/** 声明轨宿主：装上单数包 @deepseek-ai/dsh-agent-preset（0.1.7 组件）。 */
function makeDeclarative(dshHome) {
  mkdirSync(path.join(dshHome, 'node_modules', '@deepseek-ai', 'dsh-agent-preset'), { recursive: true })
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

/** 写配置文件（手写确定性文本；patchLayerRaw 模拟用户手编的非法值）。 */
function writeConfig(configFile, { patchLayer = null, profile = null, patchLayerRaw = null } = {}) {
  const lines = []
  if (profile !== null) lines.push(`profile: ${profile}`)
  if (patchLayerRaw !== null) lines.push(`patch_layer: ${patchLayerRaw}`)
  else if (patchLayer !== null) lines.push(`patch_layer: ${patchLayer}`)
  mkdirSync(path.dirname(configFile), { recursive: true })
  writeFileSync(configFile, (lines.length > 0 ? lines.join('\n') + '\n' : ''), 'utf8')
}

// ── yaml fixture（宿主解析口径；解析不到相关用例 skip）───────────────────────

let yamlFixtureDir = process.env.DSH_PAODING_TEST_YAML_DIR ?? null
if (!yamlFixtureDir) {
  try {
    yamlFixtureDir = path.dirname(createRequire(import.meta.url).resolve('yaml/package.json'))
  } catch {
    const homeYaml = path.join(os.homedir(), '.dsh', 'node_modules', 'yaml')
    yamlFixtureDir = existsSync(path.join(homeYaml, 'package.json')) ? homeYaml : null
  }
}
const YAML_AVAILABLE = yamlFixtureDir !== null

/** 把真实 yaml 包装进 fixture dshHome/node_modules（loadYaml 的解析口径）。 */
function installYamlFixture(dshHome) {
  cpSync(yamlFixtureDir, path.join(dshHome, 'node_modules', 'yaml'), { recursive: true, dereference: true })
}

/** maoying 坏行形状：显示名压平进 id 位 + 8 空格深缩进键（宿主 yaml 直接 fatal）。 */
const MAOYING_BAD_ROWS = [
  '- id: 内阁首辅 (Orchestrator)',
  '        name: "内阁首辅"',
  '        description: "按角色分工的编排架构"',
].join('\n')

/** 构造一条合法 preset 声明行文本（同 preset-system.test 口径）。 */
function sampleRow({ presetId = 'orchestrator' } = {}) {
  return buildPresetRowText({
    presetId,
    name: `编排模式 (Orchestrator)`,
    description: '按角色分工的编排架构',
    order: 5,
    agentYmlText: [
      '- id: persona',
      "  name: '@deepseek-ai/dsh-persona'",
      '  config:',
      '    prefix: |-',
      '      第一行',
      '',
      '      第三行',
      '- id: orchestrator-restrict',
      '  name: ./restrict.mjs',
    ].join('\n'),
    restrictFileUrl: pathToFileURL(`/tmp/${presetId}/restrict.mjs`).href,
  })
}

// ── 1. 层判定链 ──────────────────────────────────────────────────────────────

test('resolvePatchTargetLayer: 缺省 home 层；argv --profile 胜过 config profile 键', () => {
  const { dshHome } = freshEnv('resolve-default')
  assert.deepEqual(resolvePatchTargetLayer(dshHome, { argv: [] }), {
    layer: 'home',
    profileName: 'web',
    patchPath: path.join(dshHome, 'cordis.patch.yml'),
    legacyPatchPath: path.join(dshHome, 'profiles', 'web', 'cordis.patch.yml'),
  })
  // --profile <name> 空格形态与 --profile=<name> 等号形态都吃；argv 优先于配置键。
  assert.equal(resolvePatchTargetLayer(dshHome, { argv: ['node', 'dsh-paoding', '--profile', 'desktop'], config: { profile: 'web' } }).profileName, 'desktop')
  assert.equal(resolvePatchTargetLayer(dshHome, { argv: ['node', 'x', '--profile=cli-profile'], config: { profile: 'web' } }).profileName, 'cli-profile')
  // 无 argv 显式时回落配置 profile 键，再回落 'web'。
  assert.equal(resolvePatchTargetLayer(dshHome, { argv: [], config: { profile: 'panel' } }).profileName, 'panel')
  // 路径穿越形状的 profile 名回落 'web'（profile 名要拼进 patch 路径）。
  assert.equal(resolvePatchTargetLayer(dshHome, { argv: ['--profile', '../evil'], config: null }).profileName, 'web')
})

test('resolvePatchTargetLayer: config patch_layer 优先于环境变量，非法值 warn 回落自动判定', async (t) => {
  const { dshHome } = freshEnv('resolve-config')
  await t.test('config 钉 profile', () => {
    assert.equal(resolvePatchTargetLayer(dshHome, { argv: [], config: { patch_layer: 'profile' } }).layer, 'profile')
  })
  await t.test('config 钉 home 胜过 compat 壳探测（容器路径 dshHome）', () => {
    const containerHome = '/data/user/0/com.example/files/payload/dshhome'
    assert.equal(resolvePatchTargetLayer(containerHome, { argv: [], config: { patch_layer: 'home' } }).layer, 'home')
  })
  await t.test('非法 config 值忽略，环境变量接管', async () => {
    const prev = process.env.DSH_PAODING_PATCH_LAYER
    process.env.DSH_PAODING_PATCH_LAYER = 'profile'
    try {
      assert.equal(resolvePatchTargetLayer(dshHome, { argv: [], config: { patch_layer: 'sideways' } }).layer, 'profile')
    } finally {
      if (prev === undefined) delete process.env.DSH_PAODING_PATCH_LAYER
      else process.env.DSH_PAODING_PATCH_LAYER = prev
    }
  })
  await t.test('环境变量也非法 → 自动判定（非 compat 壳 home）', async () => {
    const prev = process.env.DSH_PAODING_PATCH_LAYER
    process.env.DSH_PAODING_PATCH_LAYER = 'nope'
    try {
      assert.equal(resolvePatchTargetLayer(dshHome, { argv: [], config: null }).layer, 'home')
    } finally {
      if (prev === undefined) delete process.env.DSH_PAODING_PATCH_LAYER
      else process.env.DSH_PAODING_PATCH_LAYER = prev
    }
  })
})

test('isCompatShellLike: android 平台 / 容器路径命中，darwin 本机路径不命中', () => {
  assert.equal(isCompatShellLike({ platform: 'android', dshHomePath: '/home/x/.dsh' }), true)
  assert.equal(isCompatShellLike({ platform: 'darwin', dshHomePath: '/data/user/0/com.example/files/payload/dshhome' }), true)
  assert.equal(isCompatShellLike({ platform: 'darwin', dshHomePath: '/data/local/tmp/dsh' }), false, '^/data/(user|data)/ 才算容器路径')
  assert.equal(isCompatShellLike({ platform: 'darwin', dshHomePath: '/Users/x/.dsh' }), false)
  // 缺省注入当前进程事实：macOS 开发机不算 compat 壳。
  assert.equal(isCompatShellLike({ dshHomePath: '/Users/x/.dsh' }), process.platform === 'android')
})

test('compat 壳环境缺省落 profile 层（容器路径 dshHome / android 平台）', () => {
  const containerHome = '/data/user/0/com.example/files/payload/dshhome'
  const target = resolvePatchTargetLayer(containerHome, { argv: [], config: null })
  assert.equal(target.layer, 'profile')
  assert.equal(target.patchPath, path.join(containerHome, 'profiles', 'web', 'cordis.patch.yml'))
  assert.equal(target.legacyPatchPath, path.join(containerHome, 'cordis.patch.yml'))
  const androidTarget = resolvePatchTargetLayer('/home/x/.dsh', { argv: [], config: null, platform: 'android' })
  assert.equal(androidTarget.layer, 'profile')
})

// ── 2. 默认 home 层零改动（旧调用点零回归）──────────────────────────────────

test('缺省（无配置 / 非 compat 壳）：声明行落 home 层，不建 profiles 目录', async () => {
  const { dshHome, patchFile, profilesDir } = freshEnv('default-home')
  upsertHomePatchRows(dshHome, [sampleRow()])
  assert.ok(existsSync(patchFile), 'home 层 patch 应落盘')
  assert.equal(readHomePatchRows(dshHome).length, 1)
  assert.equal(existsSync(profilesDir), false, 'home 层缺省不得物化 profiles 目录')
  // 尾参 opts 缺省 = home：显式传 { layer: 'home' } 结果一致。
  upsertHomePatchRows(dshHome, [sampleRow({ presetId: 'orchestrator-ws' })], { layer: 'home', profileName: 'web' })
  assert.equal(readHomePatchRows(dshHome).length, 2)
})

// ── 3. patch_layer: profile 全管线（generateAndInstall + reconcile 撤遗留）──

test('config patch_layer: profile → generateAndInstall 落 profile 层 + 撤 home 遗留块', async () => {
  const { dshHome, configFile, patchFile, profilePatchFile } = freshEnv('config-profile')
  // 预置 home 层遗留块（compat 壳从 home 迁移场景）+ 用户内容。
  writeFileSync(patchFile, '# 用户内容，必须保留\n', 'utf8')
  upsertHomePatchRows(dshHome, [sampleRow({ presetId: 'orchestrator-stale' })])
  assert.equal(readHomePatchRows(dshHome).length, 1, '预置：home 层有遗留行')
  writeConfig(configFile, { patchLayer: 'profile' })
  makeDeclarative(dshHome)
  await withHostVersion(configFile, '0.2.3', async () => {
    const state = await collectState({ dshHome, configFile, runtimeFacts: null })
    const r = generateAndInstall(state, state.existing ?? {}, { dryRun: false, saveConfigOnWrite: false })
    assert.equal(r.wrote, true)
  })
  // 目标层：profile 层有行、可读回（readHomePatchRows 读目标层）。
  const opts = { layer: 'profile', profileName: 'web' }
  assert.equal(readHomePatchRows(dshHome, opts).length, 1, 'profile 层应有本次声明行')
  assert.ok(readFileSync(profilePatchFile(), 'utf8').includes(MANAGED_BEGIN))
  // home 层：遗留托管块被 reconcile 撤下，用户内容逐字节保留。
  const homeText = readFileSync(patchFile, 'utf8')
  assert.ok(!homeText.includes(MANAGED_BEGIN), 'home 层遗留托管块应被撤下')
  assert.ok(homeText.startsWith('# 用户内容，必须保留\n'), 'home 层用户内容保留')
  assert.equal(readHomePatchRows(dshHome).length, 0)
})

// ── 4. 环境变量钉层（用毕还原）───────────────────────────────────────────────

test('DSH_PAODING_PATCH_LAYER=profile 环境变量钉层（无配置）', async (t) => {
  const { dshHome, patchFile, profilePatchFile } = freshEnv('env-profile')
  const prev = process.env.DSH_PAODING_PATCH_LAYER
  process.env.DSH_PAODING_PATCH_LAYER = 'profile'
  try {
    const target = resolvePatchTargetLayer(dshHome, { argv: [], config: null })
    assert.equal(target.layer, 'profile')
    upsertHomePatchRows(dshHome, [sampleRow()], { layer: target.layer, profileName: target.profileName })
    assert.ok(existsSync(profilePatchFile()), '声明行应落 profile 层')
    assert.equal(existsSync(patchFile), false, 'home 层不应被写')
    assert.equal(readHomePatchRows(dshHome, { layer: 'profile', profileName: 'web' }).length, 1)
    assert.equal(readHomePatchRows(dshHome).length, 0, 'home 层读不到（行在 profile 层）')
  } finally {
    if (prev === undefined) delete process.env.DSH_PAODING_PATCH_LAYER
    else process.env.DSH_PAODING_PATCH_LAYER = prev
  }
  await t.test('环境变量还原后判定回 home', () => {
    assert.equal(resolvePatchTargetLayer(freshEnv('env-restored').dshHome, { argv: [], config: null }).layer, 'home')
  })
})

// ── 5. patch_layer 配置键规范化与往返 ────────────────────────────────────────

test('patch_layer 配置键：非法值 warn 回未设置；serializeConfig 往返保留合法值', async () => {
  const { configFile } = freshEnv('config-normalize')
  writeConfig(configFile, { patchLayer: 'profile' })
  assert.equal(loadConfig(configFile, null).patch_layer, 'profile')
  // 非法值：normalizeConfig 折 null（warn 只一次）；serializeConfig 不落非法值。
  const text = readFileSync(configFile, 'utf8').replace('patch_layer: profile', 'patch_layer: sideways')
  writeFileSync(configFile, text, 'utf8')
  assert.equal(loadConfig(configFile, null).patch_layer, null)
  // serializeConfig 只在钉层时输出该键（缺省输出与旧版逐字节一致）。入参按
  // normalizeConfig 产物形状构造（serializeConfig 的调用约定）。
  const plain = serializeConfig(normalizeConfig({}))
  assert.ok(!plain.includes('patch_layer'), '未钉层不得输出 patch_layer 键')
  const pinned = serializeConfig({ ...normalizeConfig({}), patch_layer: 'home' })
  assert.ok(pinned.includes('patch_layer: home'))
})

// ── 6/7. 写盘校验回滚（真实 yaml 口径；yaml 不可用 skip）────────────────────

test('upsert 回滚：文件已含坏行时抛错且字节一字节不动', { skip: !YAML_AVAILABLE && '需要真实 yaml 包（DSH_PAODING_TEST_YAML_DIR）' }, () => {
  const { dshHome, patchFile } = freshEnv('upsert-rollback')
  installYamlFixture(dshHome)
  // 预置：用户内容 + maoying 坏行（托管块外）+ 完好托管块。
  const seeded = ['roles: keep', MAOYING_BAD_ROWS, MANAGED_BEGIN, '  - insert:', '    - id: preset-x', MANAGED_END, ''].join('\n')
  writeFileSync(patchFile, seeded, 'utf8')
  const before = readFileSync(patchFile, 'utf8')
  assert.throws(() => upsertHomePatchRows(dshHome, [sampleRow()]), (err) => {
    const msg = String(err?.message ?? err)
    return msg.includes('YAML 校验失败') && msg.includes('已回滚') && msg.includes('dsh-paoding doctor')
  }, 'upsert 应校验失败并回滚（错误需点名 doctor 修复指引）')
  assert.equal(readFileSync(patchFile, 'utf8'), before, '回滚必须逐字节还原写入前内容')
})

test('strip 回滚：撤行后文件仍含坏行时抛错且字节一字节不动', { skip: !YAML_AVAILABLE && '需要真实 yaml 包（DSH_PAODING_TEST_YAML_DIR）' }, () => {
  const { dshHome, patchFile } = freshEnv('strip-rollback')
  installYamlFixture(dshHome)
  const seeded = [MAOYING_BAD_ROWS, MANAGED_BEGIN, '  - insert:', '    - id: preset-x', '      config:', '        id: preset-x', MANAGED_END, ''].join('\n')
  writeFileSync(patchFile, seeded, 'utf8')
  const before = readFileSync(patchFile, 'utf8')
  // 整块撤除与单行撤除都走同一校验回滚门。
  assert.throws(() => stripHomePatchRows(dshHome, null), /YAML 校验失败/)
  assert.equal(readFileSync(patchFile, 'utf8'), before)
  assert.throws(() => stripHomePatchRows(dshHome, ['preset-x']), /YAML 校验失败/)
  assert.equal(readFileSync(patchFile, 'utf8'), before)
  // 目标层同理（profile 层坏文件同样不得被写坏）。
  const profileFile = path.join(dshHome, 'profiles', 'web', 'cordis.patch.yml')
  mkdirSync(path.dirname(profileFile), { recursive: true })
  writeFileSync(profileFile, seeded, 'utf8')
  const beforeProfile = readFileSync(profileFile, 'utf8')
  assert.throws(() => stripHomePatchRows(dshHome, null, { layer: 'profile', profileName: 'web' }), /YAML 校验失败/)
  assert.equal(readFileSync(profileFile, 'utf8'), beforeProfile)
})

// ── 8. findSuspectPresetRows ────────────────────────────────────────────────

test('findSuspectPresetRows: 块外坏行点名行号；块内自家声明行不误报；ASCII id 放行', () => {
  const text = [
    '# 用户注释',
    '- id: 内阁首辅 (Orchestrator)',
    '        name: "x"',
    '- id: preset-ascii',
    MANAGED_BEGIN,
    '  - insert:',
    '    - id: preset-orchestrator',
    '      name: 编排模式 (Orchestrator)',
    MANAGED_END,
    '- id: 尾部坏行',
  ].join('\n')
  const suspects = findSuspectPresetRows(text)
  assert.deepEqual(suspects.map((s) => s.lineNo), [2, 10], '只点名块外两处坏行')
  assert.equal(suspects[0].id, '内阁首辅 (Orchestrator)')
  assert.equal(suspects[1].id, '尾部坏行')
  // ASCII 紧凑 id（合法声明行/普通列表项）零误报。
  assert.deepEqual(findSuspectPresetRows('- id: preset-x\nfoo: bar\n'), [])
  // 托管块损坏（只有 BEGIN）：整文件按块外处理，坏行照点名。
  const corrupt = [MANAGED_BEGIN, '- id: 损坏块里的坏行 (Bad)', '  - insert: []'].join('\n')
  assert.deepEqual(findSuspectPresetRows(corrupt).map((s) => s.lineNo), [2])
  assert.deepEqual(findSuspectPresetRows(''), [])
})

// ── 9. reconcilePatchLayers：用户内容逐字节保留 ─────────────────────────────

test('reconcilePatchLayers: 撤 legacy 层托管块，用户内容回到插入前字节形态', () => {
  const { dshHome, patchFile } = freshEnv('reconcile-bytes')
  const userText = 'roles: keep\n\n# 注释也保留\n'
  writeFileSync(patchFile, userText, 'utf8')
  upsertHomePatchRows(dshHome, [sampleRow()])
  assert.ok(readFileSync(patchFile, 'utf8').includes(MANAGED_BEGIN), '预置：home 层有托管块')
  // 目标层 profile：reconcile 撤 home 层整块。
  const removed = reconcilePatchLayers(dshHome, { layer: 'profile', profileName: 'web' })
  assert.equal(removed, true)
  assert.equal(readFileSync(patchFile, 'utf8'), userText, 'home 层必须回到插入前的精确字节')
  // 幂等：块已不在，再 reconcile 返回 false 且零写盘。
  assert.equal(reconcilePatchLayers(dshHome, { layer: 'profile', profileName: 'web' }), false)
})

// ── 10. ensurePresetInstalled 层钉 + 二次运行零写盘 ──────────────────────────

test('ensurePresetInstalled: patch_layer profile 落目标层；第二次运行零写盘不空转', async () => {
  const { dshHome, configFile, patchFile, profilePatchFile } = freshEnv('ensure-profile')
  writeConfig(configFile, { patchLayer: 'profile' })
  makeDeclarative(dshHome)
  await withHostVersion(configFile, '0.2.3', async () => {
    const first = await ensurePresetInstalled({ dshHome, generatorVersion: GEN })
    assert.equal(first.installed, true, '首装应整盘重生成')
    const opts = { layer: 'profile', profileName: 'web' }
    assert.equal(readHomePatchRows(dshHome, opts).length, 1, 'profile 层应有声明行')
    assert.ok(readFileSync(profilePatchFile(), 'utf8').includes(MANAGED_BEGIN))
    assert.equal(readHomePatchRows(dshHome).length, 0, 'home 层不得有行')
    if (existsSync(patchFile)) assert.ok(!readFileSync(patchFile, 'utf8').includes(MANAGED_BEGIN), 'home 层不得残留托管块')
    const markerFile = path.join(dshHome, '.agent-presets', 'orchestrator', '.generator-version')
    assert.equal(readFileSync(markerFile, 'utf8'), `${GEN}\ndeclarative\nptc\nagent-preset\n`)

    // 第二次运行：标记吻合 + 行在场 → 轻量路径零写盘（mtime 与字节都不动）。
    const before = readFileSync(profilePatchFile(), 'utf8')
    const mtimeBefore = statSync(profilePatchFile()).mtimeMs
    const second = await ensurePresetInstalled({ dshHome, generatorVersion: GEN })
    assert.equal(second.installed, false)
    assert.ok(!Array.isArray(second.backfilled), '行在场不得再补行')
    assert.match(second.reason ?? '', /无需重生成/)
    assert.equal(readFileSync(profilePatchFile(), 'utf8'), before, 'patch 内容字节不动')
    assert.equal(statSync(profilePatchFile()).mtimeMs, mtimeBefore, 'patch 文件 mtime 不动（零写盘）')
  })
})

// ── 11. 双层清理（managedBlockStateAll / cleanup / planUninstall）────────────

test('managedBlockStateAll: home 恒在首位 + 各 profile 层在场状态；managedBlockState 保持 home 口径', () => {
  const { dshHome, patchFile, profilePatchFile } = freshEnv('state-all')
  assert.deepEqual(managedBlockStateAll(dshHome), [
    { layer: 'home', profileName: null, patchFile, present: false, corrupt: false },
  ], '无任何文件时只报 home 层 absence')
  writeFileSync(patchFile, `${MANAGED_BEGIN}\n  - insert: []\n${MANAGED_END}\n`, 'utf8')
  mkdirSync(path.join(dshHome, 'profiles', 'desktop'), { recursive: true })
  mkdirSync(path.join(dshHome, 'profiles', 'web'), { recursive: true })
  writeFileSync(profilePatchFile('desktop'), `${MANAGED_BEGIN}\n`, 'utf8') // 损坏：只有 BEGIN
  writeFileSync(profilePatchFile('web'), `roles: x\n${MANAGED_BEGIN}\n${MANAGED_END}\n`, 'utf8')
  const entries = managedBlockStateAll(dshHome)
  assert.equal(entries.length, 3)
  assert.deepEqual(entries[0], { layer: 'home', profileName: null, patchFile, present: true, corrupt: false })
  assert.deepEqual(entries[1], { layer: 'profile', profileName: 'desktop', patchFile: profilePatchFile('desktop'), present: true, corrupt: true })
  assert.deepEqual(entries[2], { layer: 'profile', profileName: 'web', patchFile: profilePatchFile('web'), present: true, corrupt: false })
  // 旧口径不动：managedBlockState 只看 home。
  assert.deepEqual(managedBlockState(dshHome), { present: true, corrupt: false })
})

test('cleanupPaodingArtifacts: 双层整块摘除 + 每层至多一份 .bak-1 + backupPath/backupPaths 兼容', () => {
  const { dshHome, patchFile, profilePatchFile } = freshEnv('cleanup-both')
  writeFileSync(patchFile, `roles: x\n${MANAGED_BEGIN}\n  - insert:\n    - id: preset-a\n${MANAGED_END}\n`, 'utf8')
  mkdirSync(path.dirname(profilePatchFile()), { recursive: true })
  writeFileSync(profilePatchFile(), `${MANAGED_BEGIN}\n  - insert:\n    - id: preset-a\n${MANAGED_END}\n`, 'utf8')
  const r = cleanupPaodingArtifacts(dshHome, { stripBlock: true })
  assert.equal(r.blockPresent, true, '清理前块在场（双层聚合）')
  assert.equal(r.blockRemoved, true)
  assert.equal(readFileSync(patchFile, 'utf8'), 'roles: x\n', 'home 层整块摘除，用户内容保留')
  assert.equal(readFileSync(profilePatchFile(), 'utf8'), '', 'profile 层整块摘除')
  assert.equal(existsSync(`${patchFile}.bak-1`), true)
  assert.equal(existsSync(`${profilePatchFile()}.bak-1`), true)
  assert.deepEqual(r.backupPaths, [`${patchFile}.bak-1`, `${profilePatchFile()}.bak-1`])
  assert.equal(r.backupPath, `${patchFile}.bak-1`, 'backupPath 兼容旧字段（首个备份）')
  assert.ok(existsSync(path.join(dshHome, 'profiles')), '空 profiles 目录不额外清（patch 文件级清理）')
})

test('planUninstall: 双层聚合 blockRowCount / blockPresent，patchFiles 点名各层', () => {
  const { dshHome, configFile, patchFile, profilePatchFile } = freshEnv('plan-both')
  writeFileSync(patchFile, `${MANAGED_BEGIN}\n  - insert:\n    - id: preset-a\n${MANAGED_END}\n`, 'utf8')
  mkdirSync(path.dirname(profilePatchFile()), { recursive: true })
  writeFileSync(profilePatchFile(), `${MANAGED_BEGIN}\n  - insert:\n    - id: preset-a\n${MANAGED_END}\n`, 'utf8')
  const plan = planUninstall({ dshHome, configFile })
  assert.equal(plan.blockPresent, true)
  assert.equal(plan.blockCorrupt, false)
  assert.equal(plan.blockRowCount, 2, '两层行数聚合')
  assert.deepEqual(plan.patchFiles, [patchFile, profilePatchFile()])
  assert.equal(plan.patchFile, patchFile, 'patchFile 保留 home 层旧字段口径')
})

// ── 12. ensurePresetInstalled 防线：坏文件在场时自愈失败但不崩、不写坏 ────────

test('ensurePresetInstalled: 目标层已含坏行 → 自愈报 error 返回（绝不抛、不写坏文件）', { skip: !YAML_AVAILABLE && '需要真实 yaml 包（DSH_PAODING_TEST_YAML_DIR）' }, async () => {
  const { dshHome, configFile, profilePatchFile } = freshEnv('ensure-bad')
  installYamlFixture(dshHome)
  writeConfig(configFile, { patchLayer: 'profile' })
  makeDeclarative(dshHome)
  mkdirSync(path.dirname(profilePatchFile()), { recursive: true })
  writeFileSync(profilePatchFile(), MAOYING_BAD_ROWS + '\n', 'utf8')
  const before = readFileSync(profilePatchFile(), 'utf8')
  await withHostVersion(configFile, '0.2.3', async () => {
    const r = await ensurePresetInstalled({ dshHome, generatorVersion: GEN })
    assert.equal(r.installed, false, '校验失败不得虚报 installed')
    assert.match(r.error ?? '', /YAML 校验失败/)
    assert.equal(readFileSync(profilePatchFile(), 'utf8'), before, '坏文件保持原样（不写更坏的内容）')
  })
})
