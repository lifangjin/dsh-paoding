/**
 * compose 层 golden 测试（node:test + node:assert，禁网络、禁依赖 $DSH_HOME
 * 真实环境 —— 一律不调 loadYaml，spans / config 走内置 regex / subset 回退
 * 分支；解析断言只用 parseYamlSubset，不断言引号形态，只断言「可安全解析/
 * 往返」）。覆盖：恒等性金测（防 preset 改版静默破坏生成层）、roles_remove
 * span 删除、主 persona 身份行保持默认 / 自定义角色插入、restrict allow 注入集合、
 * allow 白名单语义（presetUniverse ∪ inventory：库存缺失的插件名丢弃、在场的
 * 保留、核心名不依赖库存直通）、parseYamlSubset 块标量保真、自定义角色保留名校验、background_mode（解析 warn
 * 回落 / 序列化恒写出与往返幂等 / 内置块源预置行的原位改写与兜底注入 / 自定义
 * 角色恒写该行 / 全默认零 diff / roles_remove 命中忽略）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { REPO_ROOT, ROLES } from '../tools/lib/util.mjs'
import { locateAllowBlocks, locatePersonaBlocks } from '../tools/lib/spans.mjs'
import {
  assertCustomToolName,
  composeGenerated,
  computeRestrictAllow,
  extractMainAgentAllow,
  filterUsableTools,
  injectRestrictAllow,
  renderCustomRoleBlocks,
} from '../tools/lib/compose.mjs'
import { parseYamlSubset, stripInlineComment } from '../tools/lib/yaml.mjs'
import { loadConfig, serializeConfig } from '../tools/lib/config.mjs'

const SRC = readFileSync(path.join(REPO_ROOT, 'presets', 'orchestrator', 'agent.cordis.yml'), 'utf8')
const RESTRICT_SRC = readFileSync(path.join(REPO_ROOT, 'presets', 'orchestrator', 'restrict.mjs'), 'utf8')

// yaml 包不可用（不依赖任何 node_modules / $DSH_HOME）：spans 走 regex 兜底，
// locateAllowBlocksRegex 对三个内置角色缺失时直接 throw —— 这本身也是对 spans
// 兜底分支的回归覆盖。
const yamlMod = null

/** 全空 assignments；main_agent_persona_extra: '' = 明确清空（null/缺省会追加
 * 默认 extra，产物必然含差异，恒等性金测要求显式空串口径）。 */
function emptyAssignments() {
  return {
    roles: {},
    roles_remove: [],
    main_agent_extra: [],
    main_agent_remove: [],
    main_agent_skills: [],
    main_agent_skills_inline: [],
    main_agent_persona_extra: '',
    main_agent_display_name: null,
    skills: {},
  }
}

/** 全量检测清单 = 源 preset 三个内置角色 allow 的全部工具名（含 host 工具），
 * 让 filterUsableTools 对每一名都「检测到」，角色 allow 原样保留。 */
function fullInventory() {
  const blocks = locateAllowBlocks(SRC, yamlMod)
  const inventory = new Set()
  for (const role of ROLES) {
    for (const name of blocks.get(role).names) inventory.add(name)
  }
  return inventory
}

/** 从生成文本回读 orchestrator-restrict 注入的 config.allow 名单。 */
function extractInjectedAllow(text) {
  const idx = text.indexOf('- id: orchestrator-restrict')
  assert.ok(idx !== -1, 'orchestrator-restrict row not found')
  const seg = text.slice(idx, idx + 6000)
  const m = seg.match(/config:\n    allow:\n((?:      - [^\n]+\n)+)/)
  assert.ok(m, 'orchestrator-restrict 的 config.allow 未注入')
  return [...m[1].matchAll(/- (.+)/g)].map((x) => x[1])
}

// ── a) 恒等性金测 ───────────────────────────────────────────────────────────

test('golden: 全量 inventory + 空 assignments 的 composeGenerated 与源 preset 逐字节一致', () => {
  const blocks = locateAllowBlocks(SRC, yamlMod)
  const personaBlocks = locatePersonaBlocks(SRC, yamlMod)
  const restrictBase = extractMainAgentAllow(RESTRICT_SRC)
  const { text } = composeGenerated(SRC, blocks, personaBlocks, emptyAssignments(), fullInventory(), restrictBase, {})
  // 最高价值断言：preset 文本任何改版只要破坏生成层的 span/注入逻辑，这里先炸。
  assert.equal(text, SRC)
})

// ── b) roles_remove span 删除 ───────────────────────────────────────────────

test('roles_remove: design 委派块连注释整条删除，其余块保留且空行结构不破坏', () => {
  const blocks = locateAllowBlocks(SRC, yamlMod)
  const personaBlocks = locatePersonaBlocks(SRC, yamlMod)
  const restrictBase = extractMainAgentAllow(RESTRICT_SRC)
  const assignments = { ...emptyAssignments(), roles_remove: ['design'] }
  const { text } = composeGenerated(SRC, blocks, personaBlocks, assignments, fullInventory(), restrictBase, {})

  assert.ok(!text.includes('delegation-design'), 'delegation-design 委派行未删除')
  assert.ok(!text.includes('# design：'), 'design 块上方注释未随块删除')
  assert.ok(!text.includes('delegate to design.'), '主 persona 的 design 委派 bullet 未删除')
  assert.ok(text.includes('delegation-search-external'), '误删 search_external 块')
  assert.ok(text.includes('delegation-implement'), '误删 implement 块')
  assert.ok(text.includes('# implement：实现'), 'implement 块上方注释被误删')
  assert.ok(text.includes('# ── remaining model-facing rows'), '尾部 marker 注释被误删')
  assert.ok(!text.includes('\n\n\n'), '删除后出现三连空行（分隔空行没并入删除）')

  // roles_remove 非空必须注入显式 allow，且产物里 design 已从主 agent 面裁掉
  const allow = extractInjectedAllow(text)
  assert.ok(!allow.includes('design'), '注入的 config.allow 仍含已删除角色 design')
  assert.ok(allow.includes('search_external') && allow.includes('implement'), '注入 allow 丢了未删除角色')
})

// ── c) 主 persona 身份行保持默认 / 自定义角色插入 ───────────────────────────

test('自定义角色 + roles_remove: 产物可被 YAML 安全解析且含预期键（persona 身份行保持 SRC 默认）', () => {
  const blocks = locateAllowBlocks(SRC, yamlMod)
  const personaBlocks = locatePersonaBlocks(SRC, yamlMod)
  const restrictBase = extractMainAgentAllow(RESTRICT_SRC)
  const assignments = {
    ...emptyAssignments(),
    roles_remove: ['design'],
    roles: {
      reviewer: {
        name: null,
        model: null,
        provider: null,
        persona: 'Review code changes carefully.',
        tools: ['read', 'grep'],
      },
    },
  }
  const { text } = composeGenerated(SRC, blocks, personaBlocks, assignments, fullInventory(), restrictBase, {})

  // 主 persona 身份行保持 SRC 默认（改名能力已下线，身份行不可配置）；
  // 自定义角色有委派块与主 persona 指引行；design 委派 bullet 随 roles_remove 删除
  assert.ok(text.includes('You are the orchestrator agent powered by the {{model}} model.'), 'persona 身份行偏离 SRC 默认')
  assert.ok(text.includes('delegation-reviewer'), '自定义角色委派块未插入')
  assert.ok(text.includes('delegate to reviewer.'), '主 persona 缺自定义角色委派行')
  assert.ok(!text.includes('delegate to design.'), '主 persona 的 design 委派 bullet 未删除')

  // 生成文本必须可被 YAML 安全解析（yaml 包缺失时用内置 subset 解析器），
  // 且含预期键 —— 只断言解析结果，不断言引号形态。
  const rows = parseYamlSubset(text)
  assert.ok(Array.isArray(rows), '生成文本不是合法的顶层列表')
  const personaRow = rows.find((r) => r?.id === 'persona')
  assert.ok(String(personaRow?.config?.prefix ?? '').startsWith('You are the orchestrator agent'), '解析后 persona prefix 非 SRC 默认身份行')
  const delegationRows = rows.find((r) => r?.id === 'delegation')?.config ?? []
  const reviewer = delegationRows.find((r) => r?.id === 'delegation-reviewer')
  assert.equal(reviewer?.config?.toolName, 'reviewer', 'toolName 键不符')
  assert.equal(reviewer?.config?.provider, 'spawn', 'provider 键不符')
  assert.equal(reviewer?.config?.persona, 'Review code changes carefully.', 'persona 块标量解析不符')
  assert.deepEqual(reviewer?.config?.toolFilter?.allow, ['read', 'grep'], 'allow 列表解析不符')
  assert.equal(delegationRows.find((r) => r?.id === 'delegation-design'), undefined, 'design 委派块未被 roles_remove 删除')

  // 自定义块与 marker 注释之间补空行（全文「块间空行分隔」风格一致）
  assert.ok(
    text.includes('            - grep\n\n# ── remaining model-facing rows'),
    '自定义块与 marker 注释之间缺空行',
  )
})

// ── d) restrict allow 注入集合 ──────────────────────────────────────────────

test('injectRestrictAllow: allow = (restrictBase ∪ extra) ∩ (presetUniverse ∪ inventory) − remove', () => {
  const restrictBase = extractMainAgentAllow(RESTRICT_SRC)
  // 白名单语义：名字必须落在 presetUniverse（此处 = restrictBase）或 inventory 里。
  // extra 里：tavily_search / memory_search 已检测（保留），tavily_crawl 未检测
  // （不回填），custom_extra 既不在 presetUniverse 也不在库存（丢弃——不再
  // 「非 host 依赖名直通」）；remove 里 bash 在 base 中。
  const inventory = new Set(['mcp__tavily__tavily_search', 'memory_search'])
  const extra = ['mcp__tavily__tavily_search', 'memory_search', 'custom_extra', 'mcp__tavily__tavily_crawl']
  const remove = ['bash']
  const allow = computeRestrictAllow(restrictBase, new Set(restrictBase), inventory, extra, remove, [], [])
  // 已检测的 extra（tavily_search / memory_search）并入；未检测的 tavily_crawl
  // 与两头都不占的 custom_extra 都不回填；bash 被 remove。
  const expected = new Set([
    ...restrictBase.filter((n) => n !== 'bash'),
    'mcp__tavily__tavily_search',
    'memory_search',
  ])
  assert.equal(allow.length, expected.size, 'allow 含重复项或未剔除白名单外的名字')
  assert.deepEqual(new Set(allow), expected)

  // 注入后从产物文本回读，集合一致
  const out = injectRestrictAllow(SRC, allow)
  const injected = extractInjectedAllow(out)
  assert.deepEqual(new Set(injected), expected)
  assert.ok(!injected.includes('bash'), 'remove 未生效')
  assert.ok(!injected.includes('mcp__tavily__tavily_crawl'), '未检测的 host 工具被回填')
  assert.ok(!injected.includes('custom_extra'), '不在 presetUniverse 与库存的名字被回填')
})

// ── e) parseYamlSubset 块标量保真 ───────────────────────────────────────────

test('parseYamlSubset: 块标量内注释/空行往返逐字节不变（含 |2、>- 变体）', () => {
  // 修复目标用例：`hello # world\n\nsecond para` 往返逐字节不变
  const value = 'hello # world\n\nsecond para'
  const yml = 'roles:\n  implement:\n    persona: |-\n      ' + value.split('\n').join('\n      ') + '\n    tools:\n      - read\n'
  const parsed = parseYamlSubset(yml)
  assert.equal(parsed.roles.implement.persona, value, '块标量丢注释/丢空行')
  assert.deepEqual(parsed.roles.implement.tools, ['read'], '块标量吞掉了后续同级键')

  // 显式缩进指示符 |2：标记行不再被当普通字符串（内容行不被静默丢弃）
  assert.deepEqual(parseYamlSubset('k: |2\n  alpha # note\n\n  beta\nnext: 1\n'), {
    k: 'alpha # note\n\nbeta',
    next: 1,
  })

  // 折叠块 >- 与含 # 的单引号标量
  assert.deepEqual(parseYamlSubset("a: 'x # y'\nb: >-\n  keep # this\n\n  and # that\nc: 2\n"), {
    a: 'x # y',
    b: 'keep # this\n\nand # that',
    c: 2,
  })

  // stripInlineComment：双引号内的 \" 是转义引号，不结束字符串
  assert.equal(stripInlineComment('t: "a \\" b" # comment'), 't: "a \\" b" ')
  assert.equal(stripInlineComment('t: "a # b"'), 't: "a # b"')

  // loadConfig→serializeConfig→loadConfig 往返：persona 逐字节不变
  //（回归：预处理曾把块标量里的注释/空行当结构剥掉并持久化）
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dsh-paoding-test-'))
  const file = path.join(dir, 'dsh-paoding.config.yml')
  writeFileSync(file, yml)
  const cfg1 = loadConfig(file, null)
  const file2 = path.join(dir, 'roundtrip.config.yml')
  writeFileSync(file2, serializeConfig(cfg1))
  const cfg2 = loadConfig(file2, null)
  assert.equal(cfg2.roles.implement.persona, value, 'loadConfig→saveConfig 往返丢注释/空行')
})

// ── f) 自定义角色保留名校验 ─────────────────────────────────────────────────

test('自定义角色保留名校验: 内置/restrictBase/subagent*/mcp__/YAML 字面量一律 throw', () => {
  const restrictBase = extractMainAgentAllow(RESTRICT_SRC)
  const role = (tools = ['read']) => ({ name: null, model: null, provider: null, persona: 'Do things.', tools })

  // 内置角色 + restrictBase（如 read/glob）+ 顶层 subagent 工具。render 路径
  // 只处理非内置名（内置角色走 builtin 分支，按设计不进 assertCustomToolName），
  // 故 render 循环里剔除 ROLES 名。
  for (const bad of [...ROLES, ...restrictBase, 'subagent', 'subagent_fork']) {
    assert.throws(() => assertCustomToolName(bad, restrictBase), new RegExp(`role "${bad}"`), `保留名 ${bad} 未拒绝`)
    if (!ROLES.includes(bad)) {
      assert.throws(
        () => renderCustomRoleBlocks({ [bad]: role() }, {}, restrictBase),
        new RegExp(`role "${bad}"`),
        `renderCustomRoleBlocks 未拒绝保留名 ${bad}`,
      )
    }
  }
  // mcp__ 前缀
  assert.throws(() => assertCustomToolName('mcp__evil__pwn', restrictBase), /mcp__/)
  // YAML 字面量（大小写不敏感 + ~）
  for (const lit of ['true', 'false', 'null', 'True', 'FALSE', 'NULL', '~']) {
    assert.throws(() => assertCustomToolName(lit, restrictBase), /YAML 字面量/, `字面量 ${lit} 未拒绝`)
  }
  // composeGenerated 整链路同样拒绝（经 renderCustomRoleBlocks 传入 restrictBase）
  assert.throws(() => {
    composeGenerated(SRC, locateAllowBlocks(SRC, yamlMod), locatePersonaBlocks(SRC, yamlMod), {
      ...emptyAssignments(),
      roles: { glob: role() },
    }, fullInventory(), restrictBase, {})
  }, /role "glob"/)

  // 非保留名正常渲染；工具条目过 yamlScalar 后生成文本可被安全解析且回读原值
  //（'123' 不带引号会被解析成数字 —— 这里只断言解析结果，不断言引号形态）。
  const block = renderCustomRoleBlocks({ reviewer: role(['read', '123']) }, {}, restrictBase)
  const parsedBlock = parseYamlSubset(block)
  assert.equal(parsedBlock[0]?.config?.toolName, 'reviewer')
  assert.deepEqual(parsedBlock[0]?.config?.toolFilter?.allow, ['read', '123'])
})

// ── g) background_mode：解析 / 序列化 / 注入 / 零 diff ──────────────────────

/** 临时捕获 console.warn（解析层 warn 断言用），返回捕获数组；finally 恢复。
 * run 的返回值原样透传（方便在同一次捕获里拿到被测结果）。 */
function captureWarn(run) {
  const warnings = []
  const originalWarn = console.warn
  console.warn = (msg) => warnings.push(String(msg))
  try {
    return run(warnings)
  } finally {
    console.warn = originalWarn
  }
}

test('background_mode: config 解析 —— 合法值收下、非法/非字符串 warn 回落 one-shot、缺省 one-shot', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dsh-paoding-test-'))
  const file = path.join(dir, 'dsh-paoding.config.yml')
  writeFileSync(
    file,
    [
      'roles:',
      '  implement:',
      '    background_mode: continuable',
      '  design:',
      '    background_mode: 42',
      '  search_external:',
      '    background_mode: always',
      '  reviewer:',
      '    background_mode: continuable',
      '    tools:',
      '      - read',
    ].join('\n') + '\n',
  )
  const cfg = captureWarn((warnings) => {
    const loaded = loadConfig(file, null)
    // 两处非法值各 warn 一条（键名可归因），合法值与缺省不 warn
    assert.equal(warnings.filter((w) => w.includes('roles.design.background_mode')).length, 1, 'design 非法值未 warn')
    assert.equal(warnings.filter((w) => w.includes('roles.search_external.background_mode')).length, 1, 'search_external 非字符串未 warn')
    assert.equal(warnings.filter((w) => w.includes('background_mode')).length, 2, '出现了计划外的 background_mode warn')
    return loaded
  })
  assert.equal(cfg.roles.implement.background_mode, 'continuable', '合法 continuable 未收下')
  assert.equal(cfg.roles.reviewer.background_mode, 'continuable', '自定义角色合法值未收下（内置/自定义应同语义）')
  assert.equal(cfg.roles.design.background_mode, 'one-shot', '非法值未回落 one-shot')
  assert.equal(cfg.roles.search_external.background_mode, 'one-shot', '非字符串值未回落 one-shot')
})

test('background_mode: serializeConfig 每角色显式写出（含 one-shot），load→serialize→load 往返幂等', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dsh-paoding-test-'))
  const file = path.join(dir, 'dsh-paoding.config.yml')
  writeFileSync(
    file,
    [
      'roles:',
      '  implement:',
      '    background_mode: continuable',
      '  reviewer:',
      '    background_mode: continuable',
      '    tools:',
      '      - read',
      '  design:',
      '    persona: |-\n      You are the design agent.',
    ].join('\n') + '\n',
  )
  const cfg1 = loadConfig(file, null)
  const text1 = serializeConfig(cfg1)
  // implement / reviewer / design（显式条目、缺 background_mode 键）各一行 = 3 行；
  // 缺省值也显式写出 one-shot（旋钮在配置文件里可见）
  assert.equal((text1.match(/background_mode:/g) ?? []).length, 3, 'background_mode 行数与角色数不符')
  assert.ok(text1.includes('background_mode: continuable'), 'continuable 未写出')
  assert.ok(text1.includes('background_mode: one-shot'), '缺省角色未显式写出 one-shot')
  // 往返幂等：再 load 一次再 serialize，逐字节一致
  const file2 = path.join(dir, 'roundtrip.config.yml')
  writeFileSync(file2, text1)
  const cfg2 = loadConfig(file2, null)
  assert.equal(serializeConfig(cfg2), text1, '往返后序列化结果漂移')
})

test('background_mode: 内置角色 continuable 原位改写源预置行（键序 toolName → agentOptions? → backgroundMode，块内不重复）；one-shot/缺省零 diff', () => {
  const blocks = locateAllowBlocks(SRC, yamlMod)
  const personaBlocks = locatePersonaBlocks(SRC, yamlMod)
  const restrictBase = extractMainAgentAllow(RESTRICT_SRC)
  const inventory = fullInventory()

  // 源 preset 四个委派块各预置一行 backgroundMode: one-shot（可见性口径，值 = 缺省）
  assert.equal((SRC.match(/\n        backgroundMode: one-shot\n/g) ?? []).length, 4, '源 preset 预置 one-shot 行数不为 4')

  // continuable：implement 块该行原位改写为 continuable、块内不重复；其余块的
  // 源预置 one-shot 行原样保留（不被误改/误注入）
  const continuable = {
    ...emptyAssignments(),
    roles: { implement: { name: null, model: null, provider: null, background_mode: 'continuable', persona: null, tools: null } },
  }
  const { text } = composeGenerated(SRC, blocks, personaBlocks, continuable, inventory, restrictBase, {})
  const rows = parseYamlSubset(text)
  const delegationRows = rows.find((r) => r?.id === 'delegation')?.config ?? []
  assert.equal(delegationRows.find((r) => r?.id === 'delegation-implement')?.config?.backgroundMode, 'continuable', 'implement 块 backgroundMode 未改写为 continuable')
  assert.equal(delegationRows.find((r) => r?.id === 'delegation-search-external')?.config?.backgroundMode, 'one-shot', '未配置角色的源预置 one-shot 行被误改')
  const implSeg = text.slice(text.indexOf('- id: delegation-implement'), text.indexOf('- id: delegation-search-internal-deep'))
  assert.equal((implSeg.match(/backgroundMode:/g) ?? []).length, 1, 'implement 块出现重复 backgroundMode 行')

  // 与专用模型并存（改写路径 + agentOptions 注入）：键序 toolName → agentOptions → backgroundMode
  const withModel = {
    ...emptyAssignments(),
    roles: { implement: { name: null, model: 'deepseek-chat', provider: null, background_mode: 'continuable', persona: null, tools: null } },
  }
  const { text: textModel } = composeGenerated(SRC, blocks, personaBlocks, withModel, inventory, restrictBase, {})
  const segStart = textModel.indexOf('- id: delegation-implement')
  const seg = textModel.slice(segStart, textModel.indexOf('- id: delegation-search-internal-deep'))
  assert.ok(seg.includes('backgroundMode: continuable'), '带模型时 backgroundMode 行丢失')
  assert.ok(seg.indexOf('        agentOptions:') > -1, 'agentOptions 子块丢失')
  assert.ok(seg.indexOf('        agentOptions:') < seg.indexOf('        backgroundMode: continuable'), '键序应为 toolName → agentOptions → backgroundMode')

  // 零 diff：显式 one-shot 与缺省（不含该键）产物逐字节一致，且与源一致
  //（源预置行原样保留 = 空 assignments 与源逐字节一致的金测同口径）
  const explicitOneShot = {
    ...emptyAssignments(),
    roles: { implement: { name: null, model: null, provider: null, background_mode: 'one-shot', persona: null, tools: null } },
  }
  const { text: textOneShot } = composeGenerated(SRC, blocks, personaBlocks, explicitOneShot, inventory, restrictBase, {})
  const { text: textEmpty } = composeGenerated(SRC, blocks, personaBlocks, emptyAssignments(), inventory, restrictBase, {})
  assert.equal(textOneShot, textEmpty, '显式 one-shot 与缺省产物不一致')
  assert.equal(textEmpty, SRC, '全默认产物偏离源 preset（应为零 diff）')
})

test('background_mode: 源块无 backgroundMode 行（老配置/异常源）→ continuable 兜底注入仍可用；one-shot/缺省不动', () => {
  // 构造去掉 implement 块预置行的源文本（模拟手工删掉该行的老配置/异常源）
  const withBgMarker = '        toolName: implement\n        backgroundMode: one-shot\n'
  assert.ok(SRC.includes(withBgMarker), '构造兜底源失败：源 preset 缺 implement 预置行')
  const SRC_NO_BG = SRC.replace(withBgMarker, '        toolName: implement\n')
  assert.notEqual(SRC_NO_BG, SRC, '构造兜底源失败：预置行未被移除')

  const blocks = locateAllowBlocks(SRC_NO_BG, yamlMod)
  const personaBlocks = locatePersonaBlocks(SRC_NO_BG, yamlMod)
  const restrictBase = extractMainAgentAllow(RESTRICT_SRC)
  const inventory = fullInventory()

  // continuable：兜底注入仍可用 —— 行落在 toolName 行之后、块内恰一行（不重复）
  const continuable = {
    ...emptyAssignments(),
    roles: { implement: { name: null, model: null, provider: null, background_mode: 'continuable', persona: null, tools: null } },
  }
  const { text } = composeGenerated(SRC_NO_BG, blocks, personaBlocks, continuable, inventory, restrictBase, {})
  assert.ok(
    text.includes('        toolName: implement\n        backgroundMode: continuable\n        persona: |-'),
    '兜底注入未按 toolName → backgroundMode → persona 落位',
  )
  const seg = text.slice(text.indexOf('- id: delegation-implement'), text.indexOf('- id: delegation-search-internal-deep'))
  assert.equal((seg.match(/backgroundMode:/g) ?? []).length, 1, '兜底注入后块内 backgroundMode 行数不为 1')

  // one-shot / 缺省：无行可改也不注入 → 产物与该源逐字节一致（零 diff 特性保持）
  const oneShotRoles = { implement: { name: null, model: null, provider: null, background_mode: 'one-shot', persona: null, tools: null } }
  const { text: textOneShot } = composeGenerated(SRC_NO_BG, blocks, personaBlocks, { ...emptyAssignments(), roles: oneShotRoles }, inventory, restrictBase, {})
  const { text: textEmpty } = composeGenerated(SRC_NO_BG, blocks, personaBlocks, emptyAssignments(), inventory, restrictBase, {})
  assert.equal(textOneShot, SRC_NO_BG, '显式 one-shot 在无行源上产出了改动')
  assert.equal(textEmpty, SRC_NO_BG, '缺省在无行源上产出了改动')
})

test('background_mode: roles_remove 命中的内置角色带 continuable → warn 且不注入', () => {
  const blocks = locateAllowBlocks(SRC, yamlMod)
  const personaBlocks = locatePersonaBlocks(SRC, yamlMod)
  const restrictBase = extractMainAgentAllow(RESTRICT_SRC)
  const assignments = {
    ...emptyAssignments(),
    roles_remove: ['design'],
    roles: { design: { name: null, model: null, provider: null, background_mode: 'continuable', persona: null, tools: null } },
  }
  const { text } = captureWarn((warnings) => {
    const result = composeGenerated(SRC, blocks, personaBlocks, assignments, fullInventory(), restrictBase, {})
    assert.ok(
      warnings.some((w) => w.includes('roles.design.background_mode') && w.includes('roles_remove')),
      'roles_remove 命中角色带 background_mode 未 warn',
    )
    return result
  })
  // 源 preset 的通用 tool-subagent 块自带两行 backgroundMode: continuable（与角色
  // 无关），四个委派块各预置一行 one-shot。按出现次数比对：产物不得比源多出任何
  // 角色注入行；design 块删除后其预置 one-shot 行随块消失（backgroundMode 总数少 1）。
  const srcBgCount = SRC.split('backgroundMode: continuable').length - 1
  const outBgCount = text.split('backgroundMode: continuable').length - 1
  assert.equal(outBgCount, srcBgCount, '已删除角色的 backgroundMode 行被注入')
  const srcBgTotal = SRC.split('backgroundMode:').length - 1
  const outBgTotal = text.split('backgroundMode:').length - 1
  assert.equal(outBgTotal, srcBgTotal - 1, 'design 块删除后其预置 one-shot 行应随块消失（总数应少 1）')
  assert.ok(!text.includes('delegation-design'), 'design 委派块未被删除')
})

test('background_mode: 自定义角色块恒写 backgroundMode 行（continuable → continuable，one-shot/缺省 → one-shot）', () => {
  const restrictBase = extractMainAgentAllow(RESTRICT_SRC)
  const continuableBlock = renderCustomRoleBlocks(
    { reviewer: { name: null, model: null, provider: null, background_mode: 'continuable', persona: 'Review code.', tools: ['read'] } },
    {},
    restrictBase,
  )
  const parsed = parseYamlSubset(continuableBlock)
  assert.equal(parsed[0]?.config?.backgroundMode, 'continuable', '自定义角色 continuable 块缺 backgroundMode 行')
  // 键序：backgroundMode 在 persona 之前（toolName → agentOptions? → backgroundMode → persona）
  assert.ok(continuableBlock.indexOf('        backgroundMode: continuable') < continuableBlock.indexOf('        persona: |-'), 'backgroundMode 应在 persona 之前')

  // 恒写口径（与内置块源模板预置一致：行始终可见）：缺省（未配 background_mode）
  // 与显式 one-shot 都落恰一行 one-shot
  for (const bg of [undefined, 'one-shot']) {
    const plain = renderCustomRoleBlocks(
      { reviewer: { name: null, model: null, provider: null, background_mode: bg, persona: 'Review code.', tools: ['read'] } },
      {},
      restrictBase,
    )
    const parsedPlain = parseYamlSubset(plain)
    assert.equal(parsedPlain[0]?.config?.backgroundMode, 'one-shot', `background_mode=${bg} 块缺 one-shot 行`)
    assert.equal((plain.match(/backgroundMode:/g) ?? []).length, 1, `background_mode=${bg} 块 backgroundMode 行数不为 1`)
  }
})

// ── h) allow 白名单语义（presetUniverse ∪ inventory）────────────────────────

/** 内置角色覆写 tools 的 assignments 片段（与 background_mode 用例同形状）。 */
function builtinToolsOverride(role, tools) {
  return { ...emptyAssignments(), roles: { [role]: { name: null, model: null, provider: null, persona: null, tools } } }
}

test('allow 白名单: inventory 缺失的插件工具名（mnemon_recall）从角色 tools 丢弃', () => {
  const blocks = locateAllowBlocks(SRC, yamlMod)
  const personaBlocks = locatePersonaBlocks(SRC, yamlMod)
  const restrictBase = extractMainAgentAllow(RESTRICT_SRC)
  // 勾了 mnemon_recall 后插件停用再应用：inventory 已无该名，且它不在 preset
  // 自带工具面（restrictBase ∪ 三角色静态 allow）里——旧实现「非 host 依赖名
  // 直通」会把它留在 allow（运行时 tools.restrict() 报 unknown tools），新语义
  // 必须丢弃；read 在 presetUniverse 里，不依赖 inventory 直通。
  const assignments = builtinToolsOverride('implement', ['read', 'mnemon_recall'])
  const { text, roleResults } = composeGenerated(
    SRC, blocks, personaBlocks, assignments, new Set(['read']), restrictBase, {},
  )
  const implement = roleResults.find((rr) => rr.role === 'implement')
  assert.deepEqual(implement.kept, ['read'], 'implement kept 应只剩 read')
  assert.deepEqual(implement.removed, ['mnemon_recall'], 'mnemon_recall 未进 removed')
  assert.ok(!text.includes('- mnemon_recall'), '生成文本仍含 mnemon_recall allow 行')
})

test('allow 白名单: inventory 在场的插件工具名（mnemon_recall）保留', () => {
  const blocks = locateAllowBlocks(SRC, yamlMod)
  const personaBlocks = locatePersonaBlocks(SRC, yamlMod)
  const restrictBase = extractMainAgentAllow(RESTRICT_SRC)
  const assignments = builtinToolsOverride('implement', ['read', 'mnemon_recall'])
  const { text, roleResults } = composeGenerated(
    SRC, blocks, personaBlocks, assignments, new Set(['read', 'mnemon_recall']), restrictBase, {},
  )
  const implement = roleResults.find((rr) => rr.role === 'implement')
  assert.deepEqual(implement.kept, ['read', 'mnemon_recall'], '检测到的插件工具名被误删')
  assert.deepEqual(implement.removed, [], '不应有 removed 项')
  assert.ok(text.includes('- mnemon_recall'), '生成文本缺 mnemon_recall allow 行')
})

test('allow 白名单: presetUniverse 核心名（read/grep）不依赖 inventory 直通；SRC 自带 mcp__ 行仍须检测', () => {
  const restrictBase = extractMainAgentAllow(RESTRICT_SRC)
  // 纯单元：核心名在 presetUniverse 里，库存为空也保留；两头都不占的名字丢弃。
  const universe = new Set(['read', 'grep', 'glob'])
  assert.deepEqual(
    filterUsableTools(['read', 'grep', 'mnemon_recall', 'mcp__tavily__tavily_search'], universe, new Set()),
    ['read', 'grep'],
    '白名单语义判定不符（核心名应直通、无名之辈应丢弃）',
  )
  // 整链路：SRC 自带的 mcp__ 行在 presetUniverse 里，但属 host 依赖名——检测
  // 库存为空时仍须剔除，不能因进了白名单而复活（否则 MCP 停用会生成坏 allow）。
  const blocks = locateAllowBlocks(SRC, yamlMod)
  const presetUniverse = new Set([...restrictBase])
  for (const block of blocks.values()) for (const name of block.names) presetUniverse.add(name)
  const kept = filterUsableTools(blocks.get('search_external').names, presetUniverse, new Set())
  assert.ok(kept.every((n) => !n.startsWith('mcp__')), 'SRC 自带 mcp__ 行在空库存下被保留')
  assert.ok(kept.length > 0, '核心名在空库存下被误删')
})
