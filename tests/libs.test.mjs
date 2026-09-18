/**
 * host / skills / alloc / workspaces 修复回归测试（node:test，禁网络 —— MCP
 * 握手只走 stdio 子进程与本进程回环语义，不发任何外部请求；禁依赖 $DSH_HOME
 * 真实环境 —— 技能目录一律用临时目录 + DSH_AGENTS_HOME 指向）。覆盖：
 * isMcpEntry 精确匹配（scope 包 / 同后缀陷阱）、resolveMCP 握手优先 + 静态表
 * 仅降级回落（带 warning）、initialize 失败归因、stdio 握手后子进程清理、
 * detectSkills 点文件跳过 / BOM frontmatter / 零缩进 description 优先、
 * smartDefaults 形状含 name:null、resolveAssignments 回落复制防别名与
 * has_main_agent_extra 语义、background_mode 基础模板恒 one-shot / 透传回落、
 * assignSlugs 唯一性重试。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { KNOWN_MCP_TOOLS, isMcpEntry, resolveMCP } from '../tools/lib/host.mjs'
import { detectSkills, findSkillMeta } from '../tools/lib/skills.mjs'
import { baseAssignments, resolveAssignments, smartDefaults } from '../tools/lib/alloc.mjs'
import { assignSlugs } from '../tools/lib/workspaces.mjs'

// ── host: isMcpEntry 精确匹配 ───────────────────────────────────────────────

test('isMcpEntry: dsh-mcp-client 精确匹配（scope 包名两段），同后缀非包名不误判', () => {
  assert.equal(isMcpEntry({ name: 'dsh-mcp-client', config: {} }), true)
  assert.equal(isMcpEntry({ name: '@deepseek-ai/dsh-mcp-client', config: {} }), true)
  assert.equal(isMcpEntry({ name: '@deepseek-ai/dsh-mcp-client/tavily', config: {} }), true)
  assert.equal(isMcpEntry({ name: 'dsh-mcp-client/tavily', config: {} }), true)
  assert.equal(isMcpEntry({ name: 'not-dsh-mcp-client', config: {} }), false, '同后缀非包名被误判')
  assert.equal(isMcpEntry({ name: 'x-dsh-mcp-client/foo', config: {} }), false)
  // serverName + 已知 transport / command 形态
  assert.equal(isMcpEntry({ name: 'plain', config: { serverName: 'x', transport: 'stdio' } }), true)
  assert.equal(isMcpEntry({ name: 'plain', config: { serverName: 'x', command: 'npx' } }), true)
  assert.equal(isMcpEntry({ name: 'plain', config: { serverName: 'x' } }), false)
  assert.equal(isMcpEntry(null), false)
})

// ── host: resolveMCP 握手优先 / 静态表降级 / 失败归因 ───────────────────────

/** stdio 假 MCP 服务器脚本：initialize 回 result（或按 mode 回 error），tools/list 回工具表。 */
function fakeServerScript(mode) {
  return `
let buf = '';
process.stdin.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\\n')) !== -1) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id === 1) {
      const reply = ${JSON.stringify(mode)} === 'init-error'
        ? { jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'method not found' } }
        : { jsonrpc: '2.0', id: 1, result: { protocolVersion: '2024-11-05' } };
      process.stdout.write(JSON.stringify(reply) + '\\n');
    } else if (msg.id === 2) {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { tools: [{ name: 'tool_a' }, { name: 'tool_b' }] } }) + '\\n');
    }
  }
});
`
}

test('resolveMCP: 已知服务器也走实时握手，成功时用握手工具面', async () => {
  const res = await resolveMCP({
    serverName: 'tavily',
    transport: 'stdio',
    command: process.execPath,
    args: ['-e', fakeServerScript('ok')],
  })
  assert.deepEqual(res.tools, ['tool_a', 'tool_b'])
  assert.equal(res.source, 'handshake')
})

test('resolveMCP: initialize 失败立即归因（不再误报 tools/list / 超时）', async () => {
  const res = await resolveMCP({
    serverName: 'unknownsrv',
    transport: 'stdio',
    command: process.execPath,
    args: ['-e', fakeServerScript('init-error')],
  })
  assert.equal(res.source, 'failed')
  assert.match(res.error, /^initialize error:/)
})

test('resolveMCP: 已知服务器握手失败回落静态表且带 warning', async () => {
  // 不支持的 transport（sse）→ 握手必失败 → 静态表回落，不丢工具面
  const res = await resolveMCP({ serverName: 'codegraph', transport: 'sse' })
  assert.deepEqual(res.tools, KNOWN_MCP_TOOLS.codegraph)
  assert.equal(res.source, 'static')
  assert.match(res.warning, /static table used/)
})

// ── skills: 点文件跳过 / BOM / description 键优先级 ─────────────────────────

test('detectSkills/findSkillMeta: 点开头文件不注册；BOM 可解析；零缩进 description 优先', () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'dsh-paoding-skills-'))
  const agentsHome = mkdtempSync(path.join(os.tmpdir(), 'dsh-paoding-agents-'))
  const prevAgents = process.env.DSH_AGENTS_HOME
  process.env.DSH_AGENTS_HOME = agentsHome
  try {
    const dir = path.join(home, 'skills')
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, 'alpha.md'), '---\ndescription: top-level skill\n---\nbody\n')
    writeFileSync(path.join(dir, '.hidden.md'), '---\ndescription: nope\n---\nbody\n')
    writeFileSync(path.join(dir, '.DS_Store'), 'junk')
    mkdirSync(path.join(dir, 'beta'), { recursive: true })
    writeFileSync(path.join(dir, 'beta', 'SKILL.md'), '﻿---\ndescription: bom skill\n---\nbody\n')
    mkdirSync(path.join(dir, 'nested'), { recursive: true })
    // 嵌套同名键在前：旧实现会返回 inner，修复后零缩进键优先返回 outer
    writeFileSync(
      path.join(dir, 'nested', 'SKILL.md'),
      '---\nparams:\n  description: inner\ndescription: outer\n---\nbody\n',
    )

    assert.deepEqual(detectSkills(home, null), ['alpha', 'beta', 'nested'])
    assert.equal(findSkillMeta('alpha', home, null)?.description, 'top-level skill')
    assert.equal(findSkillMeta('beta', home, null)?.description, 'bom skill', 'BOM 导致 frontmatter 失配')
    assert.equal(findSkillMeta('nested', home, null)?.description, 'outer', '嵌套同名键抢了顶层键')
    // 零缩进键缺失时回退任意缩进键（原行为保留）
    mkdirSync(path.join(dir, 'only-inner'), { recursive: true })
    writeFileSync(
      path.join(dir, 'only-inner', 'SKILL.md'),
      '---\nparams:\n  description: inner only\n---\nbody\n',
    )
    assert.equal(findSkillMeta('only-inner', home, null)?.description, 'inner only')
  } finally {
    if (prevAgents === undefined) delete process.env.DSH_AGENTS_HOME
    else process.env.DSH_AGENTS_HOME = prevAgents
  }
})

// ── alloc: smartDefaults 形状 / resolveAssignments 回落语义 ─────────────────

test('alloc: smartDefaults 形状含 name:null；resolveAssignments 回落数组复制防别名', () => {
  const staticBase = { implement: ['read', 'edit'] }
  const inventory = new Set(['mcp__myfs__write_file', 'memory_search'])
  const suggested = smartDefaults([{ serverName: 'myfs' }], inventory, staticBase)
  // 修复回归：assign 的 roles[role] 形状与 baseAssignments 一致（含 name: null）
  assert.deepEqual(suggested.roles.implement, {
    name: null,
    model: null,
    provider: null,
    background_mode: 'one-shot',
    persona: null,
    tools: ['read', 'edit', 'mcp__myfs__write_file'],
  })
  // 只为被触发的角色建条目（未触发的角色不出现在 roles 里）
  assert.equal(suggested.roles.design, undefined)

  // 回落分支：existing 缺 tools → suggested 数组必须复制（改一处不污染另一处）
  const existing = { roles: { implement: { persona: null } }, roles_remove: [], has_main_agent_extra: true, main_agent_extra: [] }
  const resolved = resolveAssignments(existing, suggested, staticBase)
  assert.deepEqual(resolved.roles.implement.tools, ['read', 'edit', 'mcp__myfs__write_file'])
  resolved.roles.implement.tools.push('mutated')
  assert.deepEqual(suggested.roles.implement.tools, ['read', 'edit', 'mcp__myfs__write_file'], '回落数组与来源别名')

  // 显式 main_agent_extra: [] = 尊重用户（不回填）；缺键的手工对象不再抛 TypeError
  assert.deepEqual(resolved.main_agent_extra, [], '显式空列表被智能默认回填')
  const handmade = resolveAssignments({ roles: {}, roles_remove: [] }, suggested, staticBase)
  assert.deepEqual(handmade.main_agent_extra, [...suggested.main_agent_extra])
})

test('alloc: background_mode 基础模板恒 one-shot；resolveAssignments 透传 continuable / 缺键回落', () => {
  const staticBase = { implement: ['read', 'edit'], design: ['read'] }
  // 基础模板（fresh 落盘配置的来源）：每个内置角色条目显式带 background_mode: 'one-shot'
  const base = baseAssignments(staticBase)
  assert.deepEqual(Object.keys(base.roles), ['search_external', 'design', 'implement'])
  for (const role of Object.values(base.roles)) {
    assert.equal(role.background_mode, 'one-shot', '基础模板角色缺 background_mode: one-shot')
  }

  // 既有配置：continuable 原样透传；缺键（老配置 / UI 半成品对象）回落 'one-shot'
  const existing = {
    roles: {
      implement: { background_mode: 'continuable', tools: ['read'] },
      design: { tools: ['read'] },
    },
    roles_remove: [],
    has_main_agent_extra: true,
    main_agent_extra: [],
  }
  const resolved = resolveAssignments(existing, smartDefaults([], new Set(), staticBase), staticBase)
  assert.equal(resolved.roles.implement.background_mode, 'continuable', 'continuable 未透传')
  assert.equal(resolved.roles.design.background_mode, 'one-shot', '缺键未回落 one-shot')
})

// ── workspaces: assignSlugs 唯一性 ──────────────────────────────────────────

test('assignSlugs: 同 basename 加 hash；slug 恰撞名时唯一性重试', () => {
  const m1 = assignSlugs(['/a/proj', '/b/proj'])
  assert.notEqual(m1.get('/a/proj'), m1.get('/b/proj'))
  assert.ok(m1.get('/a/proj').startsWith('proj-'))
  assert.ok(m1.get('/b/proj').startsWith('proj-'))

  // 第三个路径的 basename 恰等于上面派生出的 slug → 组内唯一性重试追加一层
  const bSlug = m1.get('/b/proj')
  const cPath = `/c/${bSlug}`
  const m2 = assignSlugs(['/a/proj', '/b/proj', cPath])
  const slugs = [...m2.values()]
  assert.equal(new Set(slugs).size, slugs.length, 'slug 组内不唯一')
  assert.equal(m2.get('/a/proj'), m1.get('/a/proj'), '同输入下 slug 应稳定')
  assert.equal(m2.get('/b/proj'), bSlug, '同输入下 slug 应稳定')
  assert.notEqual(m2.get(cPath), bSlug, '撞名路径未做唯一性重试')
})
