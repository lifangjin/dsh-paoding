/**
 * 预设安装机制双轨回归测试（node:test，禁网络 —— detectPresetSystem 的
 * dsh --version 探测用假 PATH 中和；禁依赖 $DSH_HOME 真实环境 —— dshHome /
 * home patch 一律用临时目录）。覆盖：
 * parseVersionTriple / isDeclarativeTriple 版本边界（prerelease 剥离、garbage
 * 返 null）、buildPresetRowText 缩进与 restrict 行 file: URL 替换（!!js 行原样
 * 保留、JSON.stringify 转义）、home patch 托管块手术（空文件建块 / 用户内容
 * 逐字节保留 / 同 rowId 替换不重复 / 多 preset 共存 / strip 单行与整块 /
 * 损坏块拒绝写盘）、detectPresetSystem 降级链（runtimeSystem 直通 / 进程 argv
 * 宿主版本 rung / dsh --version 不可执行时按单数包存在性探测）、generateAndInstall
 * 双轨集成冒烟（declarative 落盘三件套 + home patch 托管块；directory 撤残留
 * 声明块自愈）、轨道迁移对账（标记 v2 解析 / 编排类目录清单 / 按目录补行 /
 * 孤儿行撤行 / 产物不全跳过）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

import {
  MANAGED_BEGIN,
  MANAGED_END,
  PRESET_ROW_NAME,
  backfillHomePatchRows,
  buildPresetRowText,
  detectPresetSystem,
  formatGeneratorMarker,
  listOrchestratorPresetIds,
  parseGeneratorMarker,
  parseVersionTriple,
  isDeclarativeTriple,
  presetRowId,
  readHomePatchRows,
  readPresetDirMeta,
  stripHomePatchRows,
  upsertHomePatchRows,
} from '../tools/lib/preset-system.mjs'
import { collectState, generateAndInstall } from '../tools/install.mjs'
import { flattenEntries, parseYamlSubset } from '../tools/lib/yaml.mjs'

/** 空白隔离环境：临时 dshHome（无 patch / 无配置）。 */
function freshEnv(tag) {
  const dshHome = mkdtempSync(path.join(os.tmpdir(), `dsh-paoding-ps-${tag}-`))
  return { dshHome, patchFile: path.join(dshHome, 'cordis.patch.yml') }
}

/** 构造一条 preset 声明行文本（presetId: 'orchestrator'）。 */
function sampleRow({ presetId = 'orchestrator', marker = '' } = {}) {
  return buildPresetRowText({
    presetId,
    name: `编排模式 (Orchestrator)${marker}`,
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
      '- id: tool-bash',
      "  name: '@deepseek-ai/dsh-tool-bash'",
      "  disabled: !!js process.platform === 'win32'",
      '',
    ].join('\n'),
    restrictFileUrl: pathToFileURL(`/tmp/${presetId}/restrict.mjs`).href,
  })
}

// ── 版本解析与轨道判定 ──────────────────────────────────────────────────────

test('parseVersionTriple/isDeclarativeTriple: prerelease 剥离、garbage 返 null', () => {
  assert.deepEqual(parseVersionTriple('0.1.6-alpha.2'), [0, 1, 6])
  assert.deepEqual(parseVersionTriple('0.1.7-rc.1'), [0, 1, 7])
  assert.deepEqual(parseVersionTriple('0.1.7'), [0, 1, 7])
  assert.deepEqual(parseVersionTriple('0.2.0'), [0, 2, 0])
  assert.equal(parseVersionTriple('garbage'), null)
  assert.equal(parseVersionTriple(''), null)
  assert.equal(parseVersionTriple(null), null)

  assert.equal(isDeclarativeTriple(parseVersionTriple('0.1.6-alpha.2')), false, '0.1.6 系应判目录轨')
  assert.equal(isDeclarativeTriple(parseVersionTriple('0.1.7-rc.1')), true, '0.1.7 prerelease 应判声明行轨')
  assert.equal(isDeclarativeTriple(parseVersionTriple('0.1.7')), true)
  assert.equal(isDeclarativeTriple(parseVersionTriple('0.2.0')), true)
  assert.equal(isDeclarativeTriple(parseVersionTriple('1.0.0')), true)
  assert.equal(isDeclarativeTriple([0, 1, 6]), false)
  assert.equal(isDeclarativeTriple(null), false)
  assert.equal(isDeclarativeTriple([0, 1]), false)
})

// ── buildPresetRowText ──────────────────────────────────────────────────────

test('buildPresetRowText: 缩进、restrict file: URL、JSON 转义、!!js 原样', () => {
  const row = sampleRow()
  const lines = row.split('\n')

  // 头部骨架与缩进基准：行体 4 空格、同层键 6、config 键 8、plugins: 8
  assert.equal(lines[0], `    - id: preset-orchestrator`)
  assert.equal(lines[1], `      name: '${PRESET_ROW_NAME}'`)
  assert.equal(lines[2], '      config:')
  assert.equal(lines[3], '        id: orchestrator')
  assert.ok(lines.includes('        name: "编排模式 (Orchestrator)"'))
  assert.ok(lines.includes('        order: 5'))
  assert.equal(lines.filter((l) => l === '        plugins:').length, 1, 'plugins: 恰在 8 空格且只出现一次')

  // 插件条目行恰在 10 空格（原文 0 缩进 + 10）
  assert.ok(lines.includes('          - id: persona'))
  assert.ok(lines.includes("            name: '@deepseek-ai/dsh-persona'"))

  // restrict 行 name 替换为绝对 file: URL，缩进随原文保留；不再有 ./restrict.mjs
  const restrictLine = lines.find((l) => l.includes('name: file://'))
  assert.ok(restrictLine, 'restrict 行应出现 file: URL')
  assert.equal(restrictLine, `            name: ${pathToFileURL('/tmp/orchestrator/restrict.mjs').href}`)
  assert.equal(lines.some((l) => l.includes('./restrict.mjs')), false)

  // !!js 行原样保留（仅加 10 空格缩进）
  assert.ok(lines.includes("            disabled: !!js process.platform === 'win32'"))

  // 空行保持空行（块标量内部相对缩进不变）；无尾随空行
  assert.ok(!lines.includes('      第一行'), '原文块标量内容应整体 +10 缩进')
  assert.ok(lines.includes('                第一行'))
  assert.ok(lines.includes(''))
  assert.notEqual(lines[lines.length - 1], '', '行文本不得以空行结尾')
})

test('buildPresetRowText: name/description 走 JSON.stringify 转义（引号/换行）', () => {
  const name = '带"引号"与\n换行的名字'
  const description = '多行\n描述 with "quotes" and \\ backslash'
  const row = buildPresetRowText({
    presetId: 'orchestrator-ws1',
    name,
    description,
    order: 5,
    agentYmlText: '- id: persona\n  name: x',
    restrictFileUrl: 'file:///tmp/r.mjs',
  })
  const lines = row.split('\n')
  // JSON.stringify 产物逐字落在行上（JSON 字符串即合法 YAML 双引号标量）
  assert.ok(lines.includes(`        name: ${JSON.stringify(name)}`))
  assert.ok(lines.includes(`        description: ${JSON.stringify(description)}`))
  // 反向验证：JSON.parse 还原原文（转义语义正确）
  const nameLine = lines.find((l) => l.startsWith('        name: '))
  assert.equal(JSON.parse(nameLine.slice('        name: '.length)), name)
})

test('buildPresetRowText: 缺省 name/description/order 时行省略；非法入参抛错', () => {
  const row = buildPresetRowText({
    presetId: 'orchestrator',
    agentYmlText: '- id: persona',
    restrictFileUrl: 'file:///tmp/r.mjs',
  })
  const lines = row.split('\n')
  assert.equal(lines.some((l) => /^ {8}name: /.test(l)), false)
  assert.equal(lines.some((l) => /^ {8}description: /.test(l)), false)
  assert.equal(lines.some((l) => /^ {8}order: /.test(l)), false)

  assert.throws(() => buildPresetRowText({ presetId: 'Orchestrator!', agentYmlText: 'x', restrictFileUrl: 'file:///x' }))
  assert.throws(() => buildPresetRowText({ presetId: 'orchestrator', agentYmlText: '', restrictFileUrl: 'file:///x' }))
  assert.throws(() => buildPresetRowText({ presetId: 'orchestrator', agentYmlText: 'x', restrictFileUrl: '' }))
})

// ── home patch 托管块手术 ───────────────────────────────────────────────────

test('upsertHomePatchRows: 空文件建块，整文件可被仓库 YAML 解析器还原出声明行', () => {
  const { dshHome, patchFile } = freshEnv('empty')
  upsertHomePatchRows(dshHome, [sampleRow()])
  const text = readFileSync(patchFile, 'utf8')
  assert.ok(text.startsWith(MANAGED_BEGIN), '空文件应直接起块')
  assert.ok(text.trimEnd().endsWith(MANAGED_END))
  assert.ok(text.includes('- insert:'), '声明行须有 - insert: 包裹')

  // 仓库 subset 解析器应能还原：顶层列表 → insert 展开 → 声明行结构完整
  const parsed = parseYamlSubset(text)
  assert.ok(Array.isArray(parsed), '顶层应为列表')
  const flat = flattenEntries(parsed)
  const decl = flat.find((e) => e && e.name === PRESET_ROW_NAME)
  assert.ok(decl, '应解析出 dsh-agent-preset 声明行')
  assert.equal(decl.id, 'preset-orchestrator')
  assert.equal(decl.config.id, 'orchestrator')
  assert.equal(decl.config.order, 5)
  assert.ok(Array.isArray(decl.config.plugins) && decl.config.plugins.length >= 3, 'config.plugins 应为内联条目列表')
  assert.deepEqual(readHomePatchRows(dshHome), [{ rowId: 'preset-orchestrator', presetId: 'orchestrator' }])
})

test('upsertHomePatchRows: 带用户内容的文件——upsert 后用户内容逐字节保留', () => {
  const { dshHome, patchFile } = freshEnv('user')
  const userText = [
    '# 自定义 patch',
    '',
    '- insert:',
    '    - id: mcp-tavily',
    "      name: '@deepseek-ai/dsh-mcp-client'",
    '      config:',
    '        enabled: true',
    '',
  ].join('\n')
  writeFileSync(patchFile, userText)
  upsertHomePatchRows(dshHome, [sampleRow()])
  const text = readFileSync(patchFile, 'utf8')
  // 用户内容 = 块前全部字节，一字节不动；块前恰空一行
  assert.ok(text.startsWith(userText), '用户内容必须逐字节保留在最前')
  assert.equal(text[userText.length], '\n')
  assert.equal(text[userText.length + 1] === '\n', false, '块前只空一行')
  assert.ok(text.slice(userText.length).startsWith(`\n${MANAGED_BEGIN}\n`))
})

test('upsertHomePatchRows: 同 rowId 二次 upsert 是替换不是重复；多 preset 共存', () => {
  const { dshHome, patchFile } = freshEnv('multi')
  upsertHomePatchRows(dshHome, [sampleRow()])
  upsertHomePatchRows(dshHome, [sampleRow({ presetId: 'orchestrator-ws1', marker: '-v1' })])
  let text = readFileSync(patchFile, 'utf8')
  assert.equal(text.split('- insert:').length - 1, 2, '两个 preset 各一条 insert 包裹')
  assert.deepEqual(
    readHomePatchRows(dshHome).map((r) => r.presetId),
    ['orchestrator', 'orchestrator-ws1'],
  )

  // 同 rowId 改内容再 upsert：总行数不变（替换），新内容在、旧内容无
  const before = text
  upsertHomePatchRows(dshHome, [sampleRow({ presetId: 'orchestrator-ws1', marker: '-v2' })])
  text = readFileSync(patchFile, 'utf8')
  assert.equal(text.split('- insert:').length - 1, 2, '替换后不得出现重复段')
  assert.ok(text.includes('编排模式 (Orchestrator)-v2'))
  assert.ok(!text.includes('编排模式 (Orchestrator)-v1'), '旧值应被整段替换')
  assert.equal(text.split(MANAGED_BEGIN).length - 1, 1, '托管块标记不得重复')
  assert.notEqual(text, before)
})

test('stripHomePatchRows: 单行撤除保块；整块撤除还原用户内容；撤空落空文件', () => {
  const { dshHome, patchFile } = freshEnv('strip')
  // 无托管块 → false（不写盘）
  assert.equal(stripHomePatchRows(dshHome, [presetRowId('orchestrator')]), false)
  assert.equal(stripHomePatchRows(dshHome, null), false)

  upsertHomePatchRows(dshHome, [sampleRow(), sampleRow({ presetId: 'orchestrator-ws1' })])
  // 撤单行：块保留、另一行健在
  assert.equal(stripHomePatchRows(dshHome, [presetRowId('orchestrator')]), true)
  let text = readFileSync(patchFile, 'utf8')
  assert.ok(text.startsWith(MANAGED_BEGIN), '单行撤除后托管块仍在')
  assert.deepEqual(readHomePatchRows(dshHome), [{ rowId: 'preset-orchestrator-ws1', presetId: 'orchestrator-ws1' }])
  // 撤不存在的行 → false
  assert.equal(stripHomePatchRows(dshHome, [presetRowId('not-there')]), false)

  // 撤整块：标记与最后一段都消失，文件回到空文件（我们是从空文件建的块）
  assert.equal(stripHomePatchRows(dshHome, null), true)
  text = readFileSync(patchFile, 'utf8')
  assert.equal(text, '', '空文件建的块撤除后应留空文件')

  // 带用户内容：整块撤除后用户内容逐字节还原（含我们自加的空行分隔一并摘掉）
  const userText = [
    '# 自定义 patch',
    '',
    '- insert:',
    '    - id: mcp-tavily',
    '      config:',
    '        enabled: true',
    '',
  ].join('\n')
  writeFileSync(patchFile, userText)
  upsertHomePatchRows(dshHome, [sampleRow()])
  assert.equal(stripHomePatchRows(dshHome, null), true)
  assert.equal(readFileSync(patchFile, 'utf8'), userText, '整块撤除必须还原到插入前的字节形态')
})

test('upsertHomePatchRows: 托管块损坏（有 BEGIN 无 END）拒绝写盘并报错', () => {
  const { dshHome, patchFile } = freshEnv('broken')
  const corrupted = ['# 用户内容', MANAGED_BEGIN, '- insert:', '    - id: preset-orchestrator'].join('\n')
  writeFileSync(patchFile, corrupted)
  assert.throws(() => upsertHomePatchRows(dshHome, [sampleRow()]), /托管块已损坏/)
  assert.equal(readFileSync(patchFile, 'utf8'), corrupted, '损坏块必须拒绝写盘，一字节不动')
  // 撤行 / 读行对损坏块自捕：不抛、不写
  assert.equal(stripHomePatchRows(dshHome, null), false)
  assert.deepEqual(readHomePatchRows(dshHome), [])
  assert.equal(readFileSync(patchFile, 'utf8'), corrupted)
})

// ── detectPresetSystem ──────────────────────────────────────────────────────

test('detectPresetSystem: runtimeSystem 直通两值（最权威，零探测）', async () => {
  const { dshHome } = freshEnv('rt')
  assert.equal(await detectPresetSystem({ dshHome, runtimeSystem: 'declarative' }), 'declarative')
  assert.equal(await detectPresetSystem({ dshHome, runtimeSystem: 'directory' }), 'directory')
  // 非法值不直通，落后续探测链（此处 dsh 不可执行 + 无单数包 → directory）
  const prevPath = process.env.PATH
  process.env.PATH = '/nonexistent-dsh-paoding-test'
  try {
    assert.equal(await detectPresetSystem({ dshHome, runtimeSystem: 'bogus' }), 'directory')
  } finally {
    process.env.PATH = prevPath
  }
})

test('detectPresetSystem: dsh --version 不可执行时按 $DSH_HOME 单数包存在性探测', async () => {
  const prevPath = process.env.PATH
  process.env.PATH = '/nonexistent-dsh-paoding-test' // spawnSync('dsh') ENOENT → 吞掉走文件探测
  try {
    // 单数包 dsh-agent-preset（0.1.7 组件）在 → declarative
    const decl = freshEnv('decl')
    mkdirSync(path.join(decl.dshHome, 'node_modules', '@deepseek-ai', 'dsh-agent-preset'), { recursive: true })
    assert.equal(await detectPresetSystem({ dshHome: decl.dshHome }), 'declarative')

    // 复数包 dsh-agent-presets（≤0.1.6）在、单数包不在 → directory
    const dir = freshEnv('dir')
    mkdirSync(path.join(dir.dshHome, 'node_modules', '@deepseek-ai', 'dsh-agent-presets'), { recursive: true })
    assert.equal(await detectPresetSystem({ dshHome: dir.dshHome }), 'directory')

    // 什么都没有 → directory 兜底
    const bare = freshEnv('bare')
    assert.equal(await detectPresetSystem({ dshHome: bare.dshHome }), 'directory')
  } finally {
    process.env.PATH = prevPath
  }
})

// ── generateAndInstall 双轨集成冒烟 ─────────────────────────────────────────

test('generateAndInstall: declarative 轨落盘三件套 + home patch 托管块（restrict 用 file: URL）', async () => {
  const { dshHome, patchFile } = freshEnv('gen-decl')
  const configFile = path.join(dshHome, 'dsh-paoding.config.yml')
  const state = await collectState({ dshHome, configFile, cwd: dshHome, runtimeFacts: { presetSystem: 'declarative' } })
  assert.equal(state.presetSystem, 'declarative')

  const result = generateAndInstall(state, structuredClone(state.suggested), {})
  assert.equal(result.wrote, true)
  assert.equal(result.presetSystem, 'declarative')

  // 目录轨产物照旧齐全（两轨同目录同名，宿主侧机制差异而已）
  const dstDir = path.join(dshHome, '.agent-presets', 'orchestrator')
  for (const f of ['agent.cordis.yml', 'preset.yml', 'restrict.mjs']) {
    assert.ok(existsSync(path.join(dstDir, f)), `产物缺失: ${f}`)
  }

  // home patch 托管块：单条声明行、preset 元信息与 preset.yml 同源、restrict 绝对 URL
  const text = readFileSync(patchFile, 'utf8')
  assert.ok(text.includes(MANAGED_BEGIN) && text.includes(MANAGED_END))
  assert.deepEqual(readHomePatchRows(dshHome), [{ rowId: 'preset-orchestrator', presetId: 'orchestrator' }])
  assert.ok(text.includes(`name: ${pathToFileURL(path.join(dstDir, 'restrict.mjs')).href}`), 'restrict 行必须绝对 file: URL')
  assert.ok(!text.includes('./restrict.mjs'), '不得残留相对 restrict 路径')
  assert.ok(text.includes('maxTokens: 8192'), 'config.plugins 应内联生成的 agent.cordis.yml 全文')
  const decl = flattenEntries(parseYamlSubset(text)).find((e) => e && e.name === PRESET_ROW_NAME)
  assert.ok(decl, '声明行应可解析')
  assert.equal(decl.config.name, '编排模式 (Orchestrator)')
  assert.equal(decl.config.order, 5)
  assert.ok(decl.config.description.includes('编排架构'))

  // dry-run 零副作用：不动 home patch
  const dry = freshEnv('gen-dry')
  const dryState = await collectState({ dshHome: dry.dshHome, configFile: path.join(dry.dshHome, 'c.yml'), cwd: dry.dshHome, runtimeFacts: { presetSystem: 'declarative' } })
  const dryResult = generateAndInstall(dryState, structuredClone(dryState.suggested), { dryRun: true })
  assert.equal(dryResult.wrote, false)
  assert.equal(existsSync(dry.patchFile), false, 'dry-run 不得触碰 home patch')
})

test('generateAndInstall: declarative 轨工作区 preset 追加第二条声明行', async () => {
  const { dshHome } = freshEnv('gen-ws')
  const configFile = path.join(dshHome, 'dsh-paoding.config.yml')
  const state = await collectState({ dshHome, configFile, cwd: dshHome, runtimeFacts: { presetSystem: 'declarative' } })
  // 先装基础 preset，再装工作区 preset：两条声明行经真实管线共存
  generateAndInstall(state, structuredClone(state.suggested), {})
  const wsDir = mkdtempSync(path.join(os.tmpdir(), 'dsh-paoding-wsproj-'))
  generateAndInstall(state, structuredClone(state.suggested), { workspacePath: wsDir })
  const rows = readHomePatchRows(dshHome)
  assert.equal(rows.length, 2, '基础 + 工作区两条声明行共存')
  const wsRow = rows.find((r) => r.rowId !== 'preset-orchestrator')
  // 单工作区无 slug 冲突：presetId = orchestrator-<basename 小写化>（sanitizeSlugBase）
  assert.equal(wsRow.presetId, `orchestrator-${path.basename(wsDir).toLowerCase()}`)
  assert.ok(existsSync(path.join(dshHome, '.agent-presets', wsRow.presetId, 'restrict.mjs')))
})

test('generateAndInstall: directory 轨撤残留托管块自愈，用户内容逐字节保留', async () => {
  const { dshHome, patchFile } = freshEnv('gen-dir')
  const userText = [
    '# 自定义 patch',
    '',
    '- insert:',
    '    - id: mcp-tavily',
    '      config:',
    '        enabled: true',
    '',
  ].join('\n')
  writeFileSync(patchFile, userText + '\n' + MANAGED_BEGIN + '\n- insert:\n    - id: preset-orchestrator\n      config:\n        id: orchestrator\n' + MANAGED_END + '\n')

  const configFile = path.join(dshHome, 'dsh-paoding.config.yml')
  const state = await collectState({ dshHome, configFile, cwd: dshHome, runtimeFacts: { presetSystem: 'directory' } })
  assert.equal(state.presetSystem, 'directory')
  const result = generateAndInstall(state, structuredClone(state.suggested), {})
  assert.equal(result.wrote, true)

  // 声明块整块撤下，用户内容一字节不动；目录轨产物照常落盘
  assert.equal(readFileSync(patchFile, 'utf8'), userText)
  assert.deepEqual(readHomePatchRows(dshHome), [])
  assert.ok(existsSync(path.join(dshHome, '.agent-presets', 'orchestrator', 'restrict.mjs')))
})

// ── 轨道迁移对账（标记 v2 / 目录清单 / 补行 / 撤行）─────────────────────────

test('parseGeneratorMarker/formatGeneratorMarker: v2 往返、旧格式 track=null、空文本 null', () => {
  assert.deepEqual(parseGeneratorMarker(formatGeneratorMarker('0.3.5', 'declarative')), { version: '0.3.5', track: 'declarative' })
  assert.deepEqual(parseGeneratorMarker(formatGeneratorMarker('0.3.5', 'directory')), { version: '0.3.5', track: 'directory' })
  // 旧格式（0.3.4 及以前：单行版本）——轨道翻转事故的迁移触发态
  assert.deepEqual(parseGeneratorMarker('0.3.4\n'), { version: '0.3.4', track: null })
  assert.deepEqual(parseGeneratorMarker('0.3.4'), { version: '0.3.4', track: null })
  // 次行不是合法轨道值 → track null（宽容：不至于把整个标记作废）
  assert.deepEqual(parseGeneratorMarker('0.3.5\nbogus\n'), { version: '0.3.5', track: null })
  assert.equal(parseGeneratorMarker(''), null)
  assert.equal(parseGeneratorMarker(null), null)
  assert.equal(parseGeneratorMarker('   \n  \n'), null)
})

test('listOrchestratorPresetIds: 只认编排类目录名；目录缺失返回空', () => {
  const { dshHome } = freshEnv('list')
  assert.deepEqual(listOrchestratorPresetIds(dshHome), [])
  const presets = path.join(dshHome, '.agent-presets')
  for (const name of ['orchestrator', 'orchestrator-obsidian', 'liangshen', 'orchestrator-WS1', 'not-orchestrator']) {
    mkdirSync(path.join(presets, name), { recursive: true })
  }
  // orchestrator-WS1 大写不匹配（slug 规则小写）——编排类形状过滤按小写约定
  assert.deepEqual(listOrchestratorPresetIds(dshHome), ['orchestrator', 'orchestrator-obsidian'])
})

test('readPresetDirMeta: 从落盘 preset 目录解析显示元数据（与生成管线同源口径）', async () => {
  const { dshHome } = freshEnv('meta')
  const state = await collectState({ dshHome, configFile: path.join(dshHome, 'c.yml'), cwd: dshHome, runtimeFacts: { presetSystem: 'declarative' } })
  generateAndInstall(state, structuredClone(state.suggested), {})
  const meta = readPresetDirMeta(path.join(dshHome, '.agent-presets', 'orchestrator'))
  assert.equal(meta.name, '编排模式 (Orchestrator)')
  assert.equal(meta.order, 5)
  assert.ok(meta.description.includes('编排架构'), 'description 多行折叠应拼成单值')
  // 读不到 / 空 → 空元数据（宿主可选键，缺省不致命）
  assert.deepEqual(readPresetDirMeta(path.join(dshHome, 'nope')), { name: null, description: null, order: null })
})

test('backfillHomePatchRows: 按磁盘产物补行（元数据取自 preset.yml、restrict 绝对 URL）；行在则零写盘', async () => {
  const { dshHome, patchFile } = freshEnv('bf')
  // 用真实管线落一个 preset（拿货真价实的三件套），再造第二个工作区目录
  const state = await collectState({ dshHome, configFile: path.join(dshHome, 'c.yml'), cwd: dshHome, runtimeFacts: { presetSystem: 'directory' } })
  generateAndInstall(state, structuredClone(state.suggested), {})
  const base = path.join(dshHome, '.agent-presets', 'orchestrator')
  const ws = path.join(dshHome, '.agent-presets', 'orchestrator-ws1')
  cpSync(base, ws, { recursive: true })
  const presetYml = path.join(ws, 'preset.yml')
  writeFileSync(presetYml, readFileSync(presetYml, 'utf8').replace(/^name:.*$/m, 'name: 编排模式·ws1'))

  const backfilled = backfillHomePatchRows(dshHome, listOrchestratorPresetIds(dshHome))
  assert.deepEqual(backfilled.sort(), ['orchestrator', 'orchestrator-ws1'])
  const rows = readHomePatchRows(dshHome)
  assert.deepEqual(rows.map((r) => r.presetId).sort(), ['orchestrator', 'orchestrator-ws1'])
  const text = readFileSync(patchFile, 'utf8')
  assert.ok(text.includes('name: "编排模式·ws1"'), '行元数据应取自目录内 preset.yml')
  assert.ok(text.includes(`name: ${pathToFileURL(path.join(ws, 'restrict.mjs')).href}`), 'restrict 行必须绝对 file: URL')

  // 幂等：行已在 → 不写盘（字节不变）
  const before = readFileSync(patchFile, 'utf8')
  assert.deepEqual(backfillHomePatchRows(dshHome, listOrchestratorPresetIds(dshHome)), [])
  assert.equal(readFileSync(patchFile, 'utf8'), before)

  // 孤儿行：目录没了 → 行同步撤下（同生同灭）
  const { dshHome: d2, patchFile: p2 } = freshEnv('bf-orphan')
  upsertHomePatchRows(d2, [sampleRow(), sampleRow({ presetId: 'orchestrator-ws1' })])
  backfillHomePatchRows(d2, ['orchestrator']) // ws1 目录不存在于 d2
  assert.deepEqual(readHomePatchRows(d2).map((r) => r.presetId), ['orchestrator'])

  // 产物不全（缺 restrict.mjs）：跳过、不拖垮其余
  const { dshHome: d3 } = freshEnv('bf-broken')
  mkdirSync(path.join(d3, '.agent-presets', 'orchestrator'), { recursive: true })
  writeFileSync(path.join(d3, '.agent-presets', 'orchestrator', 'agent.cordis.yml'), '- id: persona')
  mkdirSync(path.join(d3, '.agent-presets', 'orchestrator-ws2'), { recursive: true })
  cpSync(path.join(dshHome, '.agent-presets', 'orchestrator', 'agent.cordis.yml'), path.join(d3, '.agent-presets', 'orchestrator-ws2', 'agent.cordis.yml'))
  cpSync(path.join(dshHome, '.agent-presets', 'orchestrator', 'preset.yml'), path.join(d3, '.agent-presets', 'orchestrator-ws2', 'preset.yml'))
  cpSync(path.join(dshHome, '.agent-presets', 'orchestrator', 'restrict.mjs'), path.join(d3, '.agent-presets', 'orchestrator-ws2', 'restrict.mjs'))
  assert.deepEqual(backfillHomePatchRows(d3, listOrchestratorPresetIds(d3)), ['orchestrator-ws2'])
})

// ── detectPresetSystem：进程 argv 宿主版本 rung ─────────────────────────────

test('detectPresetSystem: 进程 argv 宿主版本探测（插件与宿主同进程时零开销且最准）', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-paoding-argv-'))
  const modUrl = pathToFileURL(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'tools', 'lib', 'preset-system.mjs')).href
  const driver = (dir) => {
    mkdirSync(path.join(dir, 'lib'), { recursive: true })
    const file = path.join(dir, 'lib', 'driver.mjs')
    writeFileSync(file, [
      `import { detectPresetSystem } from ${JSON.stringify(modUrl)}`,
      'const sys = await detectPresetSystem({ dshHome: process.env.DSH_TEST_HOME })',
      'process.stdout.write(sys)',
      '',
    ].join('\n'))
    return file
  }
  // 假宿主包：name @deepseek-ai/dsh + 0.1.7-rc.1（真实布局 dsh/lib/bin.js 同构，
  // argv[1] 向上一级即命中 package.json）→ argv rung 直判 declarative
  const fakeDsh = path.join(root, 'fake-dsh')
  mkdirSync(fakeDsh, { recursive: true })
  writeFileSync(path.join(fakeDsh, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.1.7-rc.1' }))
  // 0.1.6 假宿主 → argv rung 判 directory
  const fakeOld = path.join(root, 'fake-old-dsh')
  mkdirSync(fakeOld, { recursive: true })
  writeFileSync(path.join(fakeOld, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.1.6-alpha.2' }))
  // 非 dsh 包（name 不匹配）→ argv rung 落空；PATH 中和 + 空 dshHome → 兜底 directory
  const plain = path.join(root, 'plain')
  mkdirSync(plain, { recursive: true })
  writeFileSync(path.join(plain, 'package.json'), JSON.stringify({ name: 'not-dsh', version: '9.9.9' }))

  const env = {
    ...process.env,
    PATH: '/nonexistent-dsh-paoding-test', // 中和真 dsh（本机 0.1.7-rc.1 会干扰）
    DSH_TEST_HOME: path.join(root, 'empty-home'), // 空宿主目录：文件探测 rung 必落空
  }
  mkdirSync(env.DSH_TEST_HOME, { recursive: true })
  for (const [dir, expected] of [[fakeDsh, 'declarative'], [fakeOld, 'directory'], [plain, 'directory']]) {
    const res = spawnSync(process.execPath, [driver(dir)], { env, encoding: 'utf8' })
    assert.equal(res.status, 0, `${dir}: driver 应正常退出（stderr: ${res.stderr}）`)
    assert.equal(res.stdout, expected)
  }
})
