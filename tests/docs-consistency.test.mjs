import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from '../tools/lib/util.mjs'
import { locateAllowBlocks } from '../tools/lib/spans.mjs'
import { extractMainAgentAllow } from '../tools/lib/compose.mjs'
import { normalizeConfig, normalizeTargetFields } from '../tools/lib/config.mjs'

// ── 文档一致性测试（借自 dsh-superagent 的 docs-drift 测试思路）──────────────────
//
// 文档里的数字与清单是最容易烂掉的一层：源码改了、表没改，读者按表办事就被
// 误导。本文件把「文档抄录自源码」变成机器可验的契约——
//   1. architecture.md 主 agent 白名单表（分组 + 总数 21）↔ restrict.mjs 的
//      MAIN_AGENT_ALLOW 逐名对账；
//   2. architecture.md 四角色 toolFilter.allow 表（含标题里的 N 项）↔
//      agent.cordis.yml 实际 allow 逐名对账；
//   3. configuration.md §1.2 顶层键表 ↔ config.mjs normalizeConfig 返回键
//      （含 roles 子字段 bullet 清单 ↔ normalizeTargetFields 角色条目键）。
// 文档改动须与源码同步，红灯即修表（或改源码——但那是有意识的决定）。

const ARCH = readFileSync(path.join(REPO_ROOT, 'docs/architecture.md'), 'utf8')
const CONF = readFileSync(path.join(REPO_ROOT, 'docs/configuration.md'), 'utf8')
const SRC = readFileSync(path.join(REPO_ROOT, 'presets/orchestrator/agent.cordis.yml'), 'utf8')
const RESTRICT_SRC = readFileSync(path.join(REPO_ROOT, 'presets/orchestrator/restrict.mjs'), 'utf8')

/** 取文档某两行锚点之间的片段。 */
function sectionBetween(text, startAnchor, endAnchor) {
  const i = text.indexOf(startAnchor)
  assert.ok(i >= 0, `锚点不存在：${startAnchor}`)
  const j = endAnchor === null ? text.length : text.indexOf(endAnchor, i)
  assert.ok(j >= 0, `尾锚点不存在：${endAnchor}`)
  return text.slice(i, j)
}

/** 从一段文档里收全部 `` `name` `` 反引号名（去重保序）。 */
function backtickNamesOf(text) {
  const out = []
  for (const m of text.matchAll(/`([a-zA-Z0-9_*?]+)`/g)) {
    if (!out.includes(m[1])) out.push(m[1])
  }
  return out
}

test('architecture.md 主 agent 白名单表 ↔ restrict.mjs MAIN_AGENT_ALLOW 逐名一致', () => {
  const allow = extractMainAgentAllow(RESTRICT_SRC)
  const sec = sectionBetween(ARCH, '### 主 agent 工具面', '### 内置角色总览')
  // 只收表格行（| 开头）：节内散文（host 工具说明）里也有反引号名，那些是
  // 刻意不在白名单内的反面清单，不能混进对账。
  const tableText = sec.split('\n').filter((l) => l.startsWith('|')).join('\n')
  const docNames = backtickNamesOf(tableText)
  // 文档口径：表里的名字 = 源码常量全集（分组行只是排版）
  assert.deepEqual(
    [...docNames].sort(),
    [...new Set(allow)].sort(),
    'architecture.md 主 agent 白名单表与 restrict.mjs 漂移——改白名单请同步文档表（含总数）',
  )
  // 标题总数句：「共 N 项」
  const m = /共\s*\*\*(\d+)\s*项\*\*/.exec(sec)
  assert.ok(m, '标题里的「共 N 项」句式还在')
  assert.equal(Number(m[1]), new Set(allow).size, '标题总数 = 实际白名单数')
})

test('architecture.md 成本账表的角色 allow 项数 ↔ agent.cordis.yml 实际数', () => {
  const sec = sectionBetween(ARCH, '## 成本账', '## 角色与工具面')
  const blocks = locateAllowBlocks(SRC, null)
  const expect = {
    search_external: blocks.get('search_external').names.length,
    design: blocks.get('design').names.length,
    implement: blocks.get('implement').names.length,
    // search_internal_deep 是静态块：直接数 toolFilter.allow 条目
    search_internal_deep: deepAllowNames().length,
  }
  for (const [role, n] of Object.entries(expect)) {
    const m = new RegExp(`${role} 子 agent \\|\\s*(\\d+) 项 allow`).exec(sec)
    assert.ok(m, `成本账表里 ${role} 的「N 项 allow」行还在`)
    assert.equal(Number(m[1]), n, `成本账表 ${role} 项数（文档 ${m[1]} ≠ 实际 ${n}）`)
  }
})

/** search_internal_deep 静态块 allow（10 空格缩进 `- name` 行）。 */
function deepAllowNames() {
  const lines = SRC.split('\n')
  const start = lines.findIndex((l) => l.includes('- id: delegation-search-internal-deep'))
  assert.ok(start >= 0, 'deep 静态块存在')
  const out = []
  let inAllow = false
  for (let i = start; i < lines.length; i++) {
    if (/^ {8}toolFilter:/.test(lines[i])) { inAllow = true; continue }
    if (inAllow && /^ {10}allow:$/.test(lines[i])) continue
    if (inAllow) {
      const m = /^ {12}- (\S+)\s*$/.exec(lines[i])
      if (m) out.push(m[1])
      else if (!/^ {12}/.test(lines[i])) break
    }
  }
  return out
}

test('architecture.md 四角色 toolFilter.allow 表 ↔ agent.cordis.yml 逐名一致（含 N 项标题）', () => {
  const sec = sectionBetween(ARCH, '### 角色 toolFilter.allow 明细', '## 原理')
  const blocks = locateAllowBlocks(SRC, null)
  const expect = {
    search_external: blocks.get('search_external').names,
    design: blocks.get('design').names,
    implement: blocks.get('implement').names,
    search_internal_deep: deepAllowNames(),
  }
  for (const [role, names] of Object.entries(expect)) {
    // 角色小节：从加粗标题行到下一个加粗角色标题 / 节尾
    const headRe = new RegExp('\\*\\*`' + role + '`[^*]*（[^）]*?(\\d+) 项）\\*\\*')
    const head = headRe.exec(sec)
    assert.ok(head, `architecture.md 里 ${role} 的「（N 项）」标题在`)
    assert.equal(Number(head[1]), names.length, `${role} 标题项数（文档 ${head[1]} ≠ 实际 ${names.length}）`)
    // 该小节的 toolFilter.allow 行
    const after = sec.slice(sec.indexOf(head[0]))
    const row = /^\| toolFilter\.allow \|(.*)\|$/m.exec(after)
    assert.ok(row, `${role} 的 toolFilter.allow 行在`)
    const docNames = backtickNamesOf(row[1])
    assert.deepEqual(
      [...docNames].sort(),
      [...new Set(names)].sort(),
      `architecture.md ${role} allow 表与 agent.cordis.yml 漂移`,
    )
  }
})

test('configuration.md §1.2 顶层键表 ↔ config.mjs normalizeConfig 返回键一致', () => {
  const sec = sectionBetween(CONF, '### 1.2 顶层键', '### 1.3')
  const docKeys = [...sec.matchAll(/^\| `([a-z_]+)` \|/gm)].map((m) => m[1])
  // 源码权威：normalizeConfig 的返回键（剥容器展开），加 has_main_agent_extra
  //（内部标记，不出文档）；profile / patch_layer 单列返回。
  const normalized = normalizeConfig({})
  const codeKeys = new Set([...Object.keys(normalized), 'has_main_agent_extra'])
  const docSet = new Set(docKeys)
  const missingInDoc = [...codeKeys].filter((k) => !docSet.has(k) && k !== 'has_main_agent_extra')
  const ghostInDoc = [...docSet].filter((k) => !codeKeys.has(k))
  assert.deepEqual(missingInDoc, [], 'config.mjs 有键而文档表缺（新键必须进 §1.2 表）')
  assert.deepEqual(ghostInDoc, [], '文档表有键而 config.mjs 已不收（删键须同步文档）')
  // 表格行数对账（防行格式漂移导致空集假绿）
  assert.ok(docKeys.length >= 12, `顶层键表行数异常（${docKeys.length} 行）`)
})

test('configuration.md roles 子字段 bullet 清单 ↔ normalizeTargetFields 角色条目键一致', () => {
  const sec = sectionBetween(CONF, '### 1.2 顶层键', '### 1.3')
  // bullet 形如「- `roles.<toolName>.persona`：」
  const docFields = [...sec.matchAll(/^- `roles\.<toolName>\.([a-z_]+)`/gm)].map((m) => m[1])
  // 源码权威：normalizeTargetFields 对角色条目收的键（读一段文档示例配置跑一遍）
  const sample = normalizeTargetFields({ roles: { search_external: { tools: ['read'] } } })
  const codeFields = Object.keys(sample.roles.search_external)
  const docSet = new Set(docFields)
  const missingInDoc = codeFields.filter((k) => !docSet.has(k))
  const ghostInDoc = [...docSet].filter((k) => !codeFields.includes(k))
  assert.deepEqual(missingInDoc, [], 'roles 条目键文档缺 bullet（新字段如 persona_base 必须补文档）')
  assert.deepEqual(ghostInDoc, [], '文档 bullet 的 roles 字段源码已不收')
})
