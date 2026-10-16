/**
 * 预设 CRUD 服务端核心回归测试（node:test，禁网络 —— 不写任何 patch 文件就不触发
 * MCP 握手；禁依赖 $DSH_HOME 真实环境 —— dshHome / 配置文件一律用临时目录）。
 *
 * 覆盖 api-core.mjs 预设 CRUD 三件套：
 *   - resolveWorkspacePathByPresetId：presetId → 工作区路径反查（含同 basename
 *     冲突路径的 hash 后缀口径，与生成层 assignSlugs 同源）；
 *   - deleteWorkspacePreset：配置条目 + preset 目录 + 声明行三位一体删除（幂等、
 *     读配置护栏），先经 installAssignments 造出真实工作区预设再删；
 *   - listPresets：GET presets 的清单组装（全局恒首位、工作区项、无配置形态）。
 * 路由层（index.mjs）不做直测——无 fake req/res 的既定口径。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { assignSlugs, collectState, presetIdOf } from '../tools/install.mjs'
import { loadConfig, normalizeTargetFields, saveConfig } from '../tools/lib/config.mjs'
import { readHomePatchRows } from '../tools/lib/preset-system.mjs'
import { deleteWorkspacePreset, installAssignments, listPresets, resolveWorkspacePathByPresetId, serializeState } from '../plugins/paoding-config-ui/api-core.mjs'

/** 空白隔离环境：临时 dshHome（无 patch 文件 → 不握手），无既有配置文件。 */
function freshEnv(prefix = 'dsh-paoding-presets-') {
  const dshHome = mkdtempSync(path.join(os.tmpdir(), prefix))
  // configFile 不落盘 = 无既有配置（loadConfig 对 ENOENT 回 null，走 fresh 安装路径）
  return { dshHome, configFile: path.join(dshHome, 'dsh-paoding.config.yml') }
}

/** 在临时 dshHome 下造一个工作区目录（一层，不借 recursive 返回值——那是最浅新目录）。 */
function makeWorkspace(dshHome, name) {
  const wsPath = path.join(dshHome, name)
  mkdirSync(wsPath, { recursive: true })
  return wsPath
}

test('resolveWorkspacePathByPresetId：同 basename 冲突路径按 hash 后缀反查，未知 id 回 null', async () => {
  const { dshHome, configFile } = freshEnv()
  // 两个工作区 basename 同为 'proj'：assignSlugs 对整组键分配，二者都拿
  // stableHash 后缀（口径与生成层一致）——反查必须能把各自 presetId 映回路径。
  const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-paoding-presets-ws-'))
  const dirA = path.join(root, 'a', 'proj')
  const dirB = path.join(root, 'b', 'proj')
  mkdirSync(dirA, { recursive: true })
  mkdirSync(dirB, { recursive: true })
  saveConfig(configFile, {
    profile: 'web',
    ...normalizeTargetFields({}),
    workspaces: { [dirA]: normalizeTargetFields({}), [dirB]: normalizeTargetFields({}) },
  })
  const { existing } = await collectState({ dshHome, configFile, cwd: dshHome })
  const slugs = assignSlugs(Object.keys(existing.workspaces))
  // 前提自证：同 basename 的两个路径确实拿到了互异的 slug（都带 hash 后缀）
  assert.notEqual(slugs.get(dirA), slugs.get(dirB))
  for (const [wsPath, slug] of slugs) {
    assert.equal(resolveWorkspacePathByPresetId(existing, presetIdOf(slug)), wsPath)
  }
  // 全局 orchestrator 不属于工作区反查范围；未知 id 一律 null（含 existing 缺失）
  assert.equal(resolveWorkspacePathByPresetId(existing, 'orchestrator'), null)
  assert.equal(resolveWorkspacePathByPresetId(existing, 'orchestrator-nope'), null)
  assert.equal(resolveWorkspacePathByPresetId(null, 'orchestrator-nope'), null)
})

test('deleteWorkspacePreset：配置条目 + preset 目录 + 声明行三位一体清理，幂等不抛', async () => {
  const { dshHome, configFile } = freshEnv()
  const wsPath = makeWorkspace(dshHome, 'ws-alpha')
  const state = await collectState({ dshHome, configFile, cwd: dshHome })
  // 先经真实生成管线造一个工作区预设（配置条目 + orchestrator-<slug> 目录）；
  // 临时目录无 patch 文件 = directory 轨，声明行本就不存在。
  const result = installAssignments(state, structuredClone(state.suggested), {
    workspacePath: wsPath,
    saveConfigOnWrite: true,
  })
  const presetId = result.presetId
  assert.match(presetId, /^orchestrator-/)
  assert.ok(existsSync(path.join(dshHome, '.agent-presets', presetId)), '造设后 preset 目录应在')
  const before = loadConfig(configFile, null)
  assert.ok(before.workspaces[wsPath], '造设后配置 workspaces 段应有该键')

  const removed = deleteWorkspacePreset(state, wsPath)
  assert.deepEqual(removed, { presetId, removedConfigEntry: true, removedPresetDir: true })
  // 三位一体对账：配置键没了（其余顶层字段原样）、目录没了、声明行无残留
  const after = loadConfig(configFile, null)
  assert.ok(!after.workspaces[wsPath], '配置 workspaces 段不应再有该键')
  assert.deepEqual(Object.keys(after.roles), Object.keys(before.roles), '顶层目标字段应原样保留')
  assert.ok(!existsSync(path.join(dshHome, '.agent-presets', presetId)), 'preset 目录应已删除')
  assert.ok(
    !readHomePatchRows(dshHome).some((r) => r.presetId === presetId),
    'cordis.patch.yml 不应残留该预设的声明行',
  )
  // directory 轨（临时目录无 patch 文件）删除不应凭空创建 cordis.patch.yml
  if ((state.presetSystem ?? 'directory') === 'directory') {
    assert.ok(!existsSync(path.join(dshHome, 'cordis.patch.yml')), 'directory 轨不得创建 patch 文件')
  }
  // 幂等：对已删条目再删不抛，两个 removed 标志均为 false
  const again = deleteWorkspacePreset(state, wsPath)
  assert.equal(again.presetId, presetId)
  assert.equal(again.removedConfigEntry, false)
  assert.equal(again.removedPresetDir, false)
})

test('deleteWorkspacePreset：配置读取失败硬中止（未做任何落盘），产物分毫未动', async () => {
  const { dshHome, configFile } = freshEnv()
  const wsPath = makeWorkspace(dshHome, 'ws-beta')
  const state = await collectState({ dshHome, configFile, cwd: dshHome })
  installAssignments(state, structuredClone(state.suggested), { workspacePath: wsPath, saveConfigOnWrite: true })
  // 配置文件被外部写坏（顶层列表，非映射；collectState 之后改盘 = 真实时序）：
  // 破坏性落盘护栏必须硬中止，preset 目录与坏文件本身都不动。
  const brokenText = '- 顶层是列表，不是映射\n'
  writeFileSync(configFile, brokenText, 'utf8')
  assert.throws(() => deleteWorkspacePreset(state, wsPath), /读取失败，已中止（未做任何落盘）/)
  const presetIds = readdirSync(path.join(dshHome, '.agent-presets'))
  assert.ok(presetIds.some((n) => n.startsWith('orchestrator-')), 'preset 目录不应被误删')
  assert.equal(readFileSync(configFile, 'utf8'), brokenText, '损坏配置不应被覆写')
})

test('listPresets：全局恒首位、工作区项按配置键序、无配置时只剩全局且 assignments 为 null', async () => {
  // 有配置形态：造一个工作区预设后取 serializeState 视图组装清单
  const { dshHome, configFile } = freshEnv()
  const wsPath = makeWorkspace(dshHome, 'ws-gamma')
  const state = await collectState({ dshHome, configFile, cwd: dshHome })
  const presetId = installAssignments(state, structuredClone(state.suggested), {
    workspacePath: wsPath,
    saveConfigOnWrite: true,
  }).presetId
  const view = serializeState(await collectState({ dshHome, configFile, cwd: dshHome }))
  const presets = listPresets(view)
  assert.equal(presets.length, 2, '全局 + 一个工作区')
  const [global, ws] = presets
  assert.deepEqual(
    { presetId: global.presetId, scope: global.scope, workspacePath: global.workspacePath, installed: global.installed },
    { presetId: 'orchestrator', scope: 'global', workspacePath: null, installed: false },
    '全局项恒在首位（只装了工作区预设，全局未装 installed=false）',
  )
  const expectedGlobalAssignments = { ...view.existing }
  delete expectedGlobalAssignments.profile
  delete expectedGlobalAssignments.workspaces
  assert.deepEqual(global.assignments, expectedGlobalAssignments, '全局 assignments = 顶层剥 profile/workspaces')
  assert.deepEqual(
    { presetId: ws.presetId, scope: ws.scope, workspacePath: ws.workspacePath, installed: ws.installed },
    { presetId, scope: 'workspace', workspacePath: wsPath, installed: true },
    '工作区项带 slug 派生 id 与落盘对账的 installed',
  )
  assert.deepEqual(ws.assignments, view.existing.workspaces[wsPath], '工作区 assignments = 该配置条目')

  // 无配置形态：existing 为 null → 只剩全局项，assignments 也为 null
  const fresh = freshEnv('dsh-paoding-presets-empty-')
  const emptyView = serializeState(await collectState({ dshHome: fresh.dshHome, configFile: fresh.configFile, cwd: fresh.dshHome }))
  const emptyPresets = listPresets(emptyView)
  assert.equal(emptyPresets.length, 1)
  assert.deepEqual(
    { presetId: emptyPresets[0].presetId, scope: emptyPresets[0].scope, workspacePath: emptyPresets[0].workspacePath, installed: emptyPresets[0].installed, assignments: emptyPresets[0].assignments },
    { presetId: 'orchestrator', scope: 'global', workspacePath: null, installed: false, assignments: null },
  )
})
