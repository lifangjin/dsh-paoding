import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { REPO_ROOT, ROLES } from '../tools/lib/util.mjs'
import { locateAllowBlocks, locatePersonaBlocks } from '../tools/lib/spans.mjs'
import { composeGenerated, extractMainAgentAllow, FAST_SHELL_MS } from '../tools/lib/compose.mjs'
import { parseYamlSubset } from '../tools/lib/yaml.mjs'

// ── 生成产物结构测试（fast-shell / agentPreset 形态钉死）─────────────────────────
//
// compose.test.mjs 钉的是「恒等 golden + span 语义」；本文件钉 0.2.1 AgentPreset
// 形态下的结构性特征——借自 dsh-superagent 的 continuable worker 做法：
//   · continuable 角色（spawn）：子预设组合内注入 isolate shell 组（5s 前台
//     预算，超时转后台任务，续修消息不被长命令挡住）+ tool-jobs 5s 等待上限；
//   · one-shot 角色与 ≤0.2.0 内联形态宿主：不注入（行为零变化）；
//   · 注入后的块必须仍可被 parseYamlSubset 解析（坏缩进当场红）。

const SRC = readFileSync(path.join(REPO_ROOT, 'presets/orchestrator/agent.cordis.yml'), 'utf8')
const RESTRICT_SRC = readFileSync(path.join(REPO_ROOT, 'presets/orchestrator/restrict.mjs'), 'utf8')
const BLOCKS = locateAllowBlocks(SRC, null)
const PERSONA_BLOCKS = locatePersonaBlocks(SRC, null)
const RESTRICT_BASE = extractMainAgentAllow(RESTRICT_SRC)

function fullInventory() {
  const names = []
  for (const role of ROLES) names.push(...BLOCKS.get(role).names)
  names.push('search_internal_deep', ...RESTRICT_BASE)
  return new Set(names)
}

function emptyAssignments() {
  return { roles: {}, roles_remove: [], skills: {}, main_agent_extra: [], main_agent_remove: [] }
}

function composeFor(assignments, triple, prerelease) {
  return composeGenerated(SRC, BLOCKS, PERSONA_BLOCKS, assignments, fullInventory(), RESTRICT_BASE, {}, triple, prerelease).text
}

function rolePresetSegment(text, toolName) {
  const marker = `- id: paoding-role-${toolName}\n`
  const idx = text.indexOf(marker)
  assert.ok(idx !== -1, `paoding-role-${toolName} 子预设行不存在`)
  const rest = text.slice(idx + marker.length)
  const next = rest.search(/^- id: /m)
  return text.slice(idx, idx + marker.length + (next === -1 ? rest.length : next))
}

function assignmentsWith(implementBg) {
  const a = emptyAssignments()
  a.roles = {
    search_external: { tools: BLOCKS.get('search_external').names },
    design: { tools: BLOCKS.get('design').names },
    implement: { tools: BLOCKS.get('implement').names },
  }
  if (implementBg !== null) a.roles.implement.background_mode = implementBg
  return a
}

test('0.2.1 宿主 + continuable 角色：子预设注入 isolate shell 组（5s 预算）与 tool-jobs 等待上限', () => {
  const text = composeFor(assignmentsWith('continuable'), [0, 2, 1], undefined)
  const seg = rolePresetSegment(text, 'implement')
  // 组形状：cordis:group + isolate shell + 组内 executor 钉 5s
  assert.match(seg, /- id: shell\n\s+name: cordis:group\n\s+group: true\n\s+isolate:\n\s+shell: true/, 'isolate shell 组在')
  assert.match(seg, /name: '@deepseek-ai\/dsh-bash-local'/, '组内挂 bash-local executor')
  assert.match(seg, new RegExp(`timeoutMs: ${FAST_SHELL_MS}`), 'timeoutMs 钉 5s')
  assert.match(seg, new RegExp(`maxTimeoutMs: ${FAST_SHELL_MS}`), 'maxTimeoutMs 钉 5s')
  assert.match(seg, /name: '@deepseek-ai\/dsh-tool-bash'/, 'tool-bash 仍在组内（pwsh 平台对偶）')
  // job 等待上限
  assert.match(seg, new RegExp(`waitTimeoutMs: ${FAST_SHELL_MS}`), 'tool-jobs waitTimeoutMs 5s')
  assert.match(seg, new RegExp(`maxWaitTimeoutMs: ${FAST_SHELL_MS}`), 'tool-jobs maxWaitTimeoutMs 5s')
  // 裸 tool-bash 行（非组内）不得残留
  assert.doesNotMatch(seg, /\n {6}- id: tool-bash\n {8}name/, '裸 tool-bash 行已被组替换')
  // 块仍可解析（缩进错误当场红）
  assert.notEqual(parseYamlSubset(seg), null, '注入后的角色预设块仍是合法 YAML')
})

test('0.2.1 宿主 + continuable：one-shot 角色同批不注入（影响面仅限该角色自己的组合）', () => {
  const a = assignmentsWith('one-shot')
  a.roles.design.background_mode = 'continuable' // 只有 design 是 continuable
  const text = composeFor(a, [0, 2, 1], undefined)
  const designSeg = rolePresetSegment(text, 'design')
  const implSeg = rolePresetSegment(text, 'implement')
  const extSeg = rolePresetSegment(text, 'search_external')
  assert.match(designSeg, /isolate:\n\s+shell: true/, 'design（continuable）有快 shell')
  for (const [name, seg] of [['implement', implSeg], ['search_external', extSeg]]) {
    assert.ok(!seg.includes("dsh-bash-local'"), `${name}（one-shot）不注入组内 executor`)
    assert.ok(!seg.includes('waitTimeoutMs'), `${name}（one-shot）不动 tool-jobs 配置`)
    assert.doesNotMatch(seg, /isolate:\n\s+shell: true/, `${name}（one-shot）无 isolate shell 组`)
    // 标准形态仍在：裸 tool-bash 工具行
    assert.match(seg, /\n {6}- id: tool-bash\n {8}name: '@deepseek-ai\/dsh-tool-bash'/, `${name} 保持标准 shell 行`)
  }
})

test('0.2.1-rc.1 与 0.2.0 宿主：即使 continuable 也不注入（内联形态/共享作用域都不适用）', () => {
  for (const [triple, pre] of [[[0, 2, 1], 'rc.1'], [[0, 2, 0], undefined]]) {
    const a = assignmentsWith('continuable')
    a.roles.design.background_mode = 'continuable'
    const text = composeFor(a, triple, pre)
    assert.ok(!text.includes('dsh-bash-local'), `${triple.join('.')}${pre ?? ''}：不注入 bash-local（内联形态无 per-role 组合）`)
    assert.ok(!text.includes(`waitTimeoutMs: ${FAST_SHELL_MS}`), `${triple.join('.')}${pre ?? ''}：不动 tool-jobs 等待配置`)
  }
})

test('0.2.1 宿主：全部 spawn 角色的委派行引用 agentPreset，子预设含 persona 与 role-restrict', () => {
  const text = composeFor(assignmentsWith(null), [0, 2, 1], undefined)
  // 委派行 id 用连字符（delegation-search-external），agentPreset id 保 toolName 原名（下划线）
  const rowIdOf = (role) => `delegation-${role.replaceAll('_', '-') === 'search-external' ? 'search-external' : role.replaceAll('_', '-')}`
  for (const role of [...ROLES, 'search_internal_deep']) {
    const re = new RegExp(`- id: ${rowIdOf(role)}[\\s\\S]*?agentPreset: paoding-role-${role}`)
    assert.match(text, re, `${role} 委派行引用 paoding-role-${role}`)
    const seg = rolePresetSegment(text, role)
    assert.match(seg, /- id: persona\n\s+name: '@deepseek-ai\/dsh-persona'/, `${role} 子预设含 persona`)
    assert.match(seg, /- id: role-restrict\n\s+name: \.\/role-restrict\.mjs/, `${role} 子预设含 role-restrict`)
    assert.notEqual(parseYamlSubset(seg), null, `${role} 子预设可解析`)
  }
})
