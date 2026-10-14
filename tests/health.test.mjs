/**
 * 配置体检（tools/lib/health.mjs healthCheck）与面板后端接入
 *（api-core.installAssignments 的 warnings 增量字段）回归测试。
 *
 * 禁网络：临时 dshHome 不放 cordis.patch.yml 就不触发 MCP 握手；不依赖真实
 * $DSH_HOME —— dshHome / 配置文件一律临时目录（freshEnv 手法与
 * api-apply.test.mjs 同源）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { collectState, generateAndInstall } from '../tools/install.mjs'
import { healthCheck, captureWarnings, collectModelRefs } from '../tools/lib/health.mjs'
import { installAssignments } from '../plugins/paoding-config-ui/api-core.mjs'

/** 空白隔离环境：临时 dshHome（无 patch 文件 → 不握手），无既有配置文件。 */
function freshEnv() {
  const dshHome = mkdtempSync(path.join(os.tmpdir(), 'dsh-paoding-health-'))
  // configFile 不落盘 = 无既有配置（loadConfig 对 ENOENT 回 null，走 fresh 安装路径）
  return { dshHome, configFile: path.join(dshHome, 'dsh-paoding.config.yml') }
}

const codesOf = (items, code) => items.filter((i) => i.code === code)

test('unmounted_tool：不在 presetUniverse ∪ inventory 的配置名逐条 warn，通配条目跳过', async () => {
  const { dshHome, configFile } = freshEnv()
  const state = await collectState({ dshHome, configFile, cwd: dshHome })
  // 对照组取一条真实会保留的挂载名（suggested 生成的 kept 首项），未挂载用假名
  const probe = generateAndInstall(state, structuredClone(state.suggested), { dryRun: true })
  const mounted = probe.roleResults.find((r) => r.role === 'search_external').kept[0]
  assert.ok(mounted, '裸环境 search_external 应至少保留一个挂载工具')
  const assignments = {
    ...structuredClone(state.suggested),
    roles: {
      ...state.suggested.roles,
      search_external: { ...(state.suggested.roles?.search_external ?? {}), tools: [mounted, 'mcp__ghost__nope', 'glob_*_pattern', 'what?tool'] },
    },
    main_agent_extra: ['made_up_plugin_tool'],
  }
  const { items } = healthCheck({ state, assignments, dryRunResult: null })
  const unmounted = codesOf(items, 'unmounted_tool')
  const names = unmounted.map((i) => i.message)
  // 两个假名各一条（含来源后缀）；mounted 在库存里不报；通配条目跳过（glob 另一批次）
  assert.ok(names.some((m) => m.includes('mcp__ghost__nope') && m.includes('roles.search_external.tools')), '角色内未挂载名应报')
  assert.ok(names.some((m) => m.includes('made_up_plugin_tool') && m.includes('main_agent_extra')), 'main_agent_extra 未挂载名应报')
  assert.equal(unmounted.length, 2, `只应两条（挂载名不报、通配条目跳过）：${JSON.stringify(names)}`)
  assert.ok(unmounted.every((i) => i.level === 'warn'), 'unmounted_tool 恒为 warn')
})

test('zero_tool_role：过滤后空的内置角色报 error，且 generateAndInstall 仍兜底 throw', async () => {
  const { dshHome, configFile } = freshEnv()
  const state = await collectState({ dshHome, configFile, cwd: dshHome })
  const assignments = {
    ...structuredClone(state.suggested),
    roles: { ...state.suggested.roles, search_external: { tools: ['mcp__ghost__nope'] } },
  }
  const { items } = healthCheck({ state, assignments, dryRunResult: null })
  const zero = codesOf(items, 'zero_tool_role')
  assert.ok(zero.some((i) => i.message.includes('search_external')), '应点名 search_external')
  assert.ok(zero.every((i) => i.level === 'error'), 'zero_tool_role 恒为 error')
  // 体检在前、throw 兜底：既有行为不变
  assert.throws(() => generateAndInstall(state, assignments, { dryRun: true }), /empty toolFilter\.allow/)
})

test('zero_tool_role：roles_remove 删除的角色不报；tools 显式空数组按空算', async () => {
  const { dshHome, configFile } = freshEnv()
  const state = await collectState({ dshHome, configFile, cwd: dshHome })
  // 整套默认模板去掉显式 tools、只留 roles_remove：被删角色不进体检
  const assignments = { ...structuredClone(state.suggested), roles_remove: ['search_external'] }
  const { items } = healthCheck({ state, assignments, dryRunResult: null })
  assert.ok(!codesOf(items, 'zero_tool_role').some((i) => i.message.includes('search_external')), '已删除角色不应报零工具')
})

test('zero_tool_role：自定义角色无 tools 报 error（与 renderCustomRoleBlocks 同口径）', async () => {
  const { dshHome, configFile } = freshEnv()
  const state = await collectState({ dshHome, configFile, cwd: dshHome })
  const assignments = { ...structuredClone(state.suggested), roles: { reviewer: { intent: '审阅' } } }
  const { items } = healthCheck({ state, assignments, dryRunResult: null })
  const zero = codesOf(items, 'zero_tool_role')
  assert.ok(zero.some((i) => i.message.includes('reviewer')), '应点名自定义角色 reviewer')
})

test('unknown_model：目录查无的角色模型 warn；models=null 整项跳过；命中目录不报', async () => {
  const { dshHome, configFile } = freshEnv()
  const state = await collectState({ dshHome, configFile, cwd: dshHome })
  const assignments = {
    ...structuredClone(state.suggested),
    roles: { ...state.suggested.roles, implement: { model: 'gpt-99-fake' } },
  }
  const models = [{ id: 'deepseek-official', models: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }] }]
  const withDir = healthCheck({ state, assignments, models, dryRunResult: null }).items
  const unknown = codesOf(withDir, 'unknown_model')
  assert.equal(unknown.length, 1, '应恰好一条')
  assert.ok(unknown[0].message.includes('roles.implement.model'))
  assert.ok(unknown[0].message.includes('gpt-99-fake'))
  assert.equal(unknown[0].level, 'warn')

  const hit = healthCheck(
    { state, assignments: { ...assignments, roles: { implement: { model: 'deepseek-reasoner' } } }, models, dryRunResult: null },
  ).items
  assert.equal(codesOf(hit, 'unknown_model').length, 0, '目录内模型不报')

  const noDir = healthCheck({ state, assignments, dryRunResult: null }).items
  assert.equal(codesOf(noDir, 'unknown_model').length, 0, 'models=null 时整项跳过')
})

test('collectModelRefs：只收 roles.*.model 的非空字符串，其他键忽略', () => {
  assert.deepEqual(collectModelRefs({ roles: { a: { model: ' x ' }, b: { model: '  ' }, c: {}, d: [] } }), [
    { toolName: 'a', model: 'x' },
  ])
  assert.deepEqual(collectModelRefs(null), [])
  assert.deepEqual(collectModelRefs({ roles: [] }), [])
})

test('preset_drift：未安装 → info「尚未安装」；安装后同文本 → 无条目', async () => {
  const { dshHome, configFile } = freshEnv()
  const state = await collectState({ dshHome, configFile, cwd: dshHome })
  const assignments = structuredClone(state.suggested)

  const fresh = healthCheck({ state, assignments, dryRunResult: null }).items
  const drift = codesOf(fresh, 'preset_drift')
  assert.equal(drift.length, 1)
  assert.equal(drift[0].level, 'info')
  assert.match(drift[0].message, /尚未安装/)

  // 真装一次（非 dryRun，落 preset 目录），体检即对上：不产 drift 条目
  generateAndInstall(state, assignments, {})
  const installed = healthCheck({ state, assignments, dryRunResult: null }).items
  assert.equal(codesOf(installed, 'preset_drift').length, 0, '安装后不应再报漂移')

  // 手改落盘文本 → 漂移回来，措辞为「落后于配置」
  const { readFileSync, writeFileSync } = await import('node:fs')
  const file = path.join(state.dshHome, '.agent-presets', 'orchestrator', 'agent.cordis.yml')
  writeFileSync(file, readFileSync(file, 'utf8') + '\n# 手改痕迹\n')
  const drifted = healthCheck({ state, assignments, dryRunResult: null }).items
  const again = codesOf(drifted, 'preset_drift')
  assert.equal(again.length, 1)
  assert.match(again[0].message, /落后于配置，重新应用即同步/)
})

test('generation：生成期 console.warn 透传为 warn 条目（fork+model 互斥），不重复实现', async () => {
  const { dshHome, configFile } = freshEnv()
  const state = await collectState({ dshHome, configFile, cwd: dshHome })
  const assignments = {
    ...structuredClone(state.suggested),
    roles: { ...state.suggested.roles, implement: { start_mode: 'fork', model: 'deepseek-chat' } },
  }
  const { items } = healthCheck({ state, assignments, dryRunResult: null })
  const passthrough = codesOf(items, 'generation')
  assert.ok(passthrough.length >= 1, '至少透传一条生成期告警')
  assert.ok(passthrough.every((i) => i.level === 'warn'))
  assert.ok(
    passthrough.some((i) => i.message.includes('不生效')),
    `fork+model 互斥告警应透传：${JSON.stringify(passthrough)}`,
  )
})

test('captureWarnings：抓 warning: 前缀行、剥前缀；抛错也还原 console.warn', () => {
  const original = console.warn
  try {
    const [value, messages] = captureWarnings(() => {
      console.warn('warning: 一号告警')
      console.warn('裸行不带前缀')
      return 42
    })
    assert.equal(value, 42)
    assert.deepEqual(messages, ['一号告警', '裸行不带前缀'])
    assert.equal(console.warn, original, '同步路径也应还原')
    assert.throws(() => captureWarnings(() => { console.warn('warning: 炸前'); throw new Error('boom') }), /boom/)
    assert.equal(console.warn, original, '抛错路径 finally 还原')
  } finally {
    console.warn = original
  }
})

test('installAssignments：成功路径纯增量返回 warnings 数组，生成只跑一次', async () => {
  const { dshHome, configFile } = freshEnv()
  const state = await collectState({ dshHome, configFile, cwd: dshHome })
  const assignments = structuredClone(state.suggested)
  const result = installAssignments(state, assignments, { dryRun: true })
  // 既有字段全在（增量，不换形状）
  assert.equal(result.wrote, false)
  assert.equal(result.presetId, 'orchestrator')
  assert.ok(Array.isArray(result.roleResults))
  assert.equal(typeof result.text, 'string')
  // 新增字段
  assert.ok(Array.isArray(result.warnings), 'warnings 应为数组')
  assert.ok(
    result.warnings.every((w) => ['error', 'warn', 'info'].includes(w.level) && typeof w.code === 'string' && typeof w.message === 'string'),
  )
})

test('installAssignments：零工具角色照旧 throw（兜底不变），err.warnings 携带可读体检项', async () => {
  const { dshHome, configFile } = freshEnv()
  const state = await collectState({ dshHome, configFile, cwd: dshHome })
  const assignments = {
    ...structuredClone(state.suggested),
    roles: { ...state.suggested.roles, design: { tools: ['mcp__ghost__nope'] } },
  }
  let caught = null
  try {
    installAssignments(state, assignments, { dryRun: true })
  } catch (err) {
    caught = err
  }
  assert.ok(caught, '零工具角色必须照旧 throw')
  assert.match(caught.message, /design/)
  assert.ok(Array.isArray(caught.warnings), 'err.warnings 应挂体检 items（422 响应透传用）')
  assert.ok(caught.warnings.some((w) => w.code === 'zero_tool_role' && w.message.includes('design')))
})
