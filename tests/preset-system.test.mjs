/**
 * 预设安装机制双轨回归测试（node:test，禁网络 —— detectPresetSystem 的
 * dsh --version 探测用假 PATH 中和；禁依赖 $DSH_HOME 真实环境 —— dshHome /
 * home patch 一律用临时目录）。覆盖：
 * parseVersionTriple / isDeclarativeTriple 版本边界（prerelease 剥离、garbage
 * 返 null）、buildPresetRowText 缩进与 restrict 行 file: URL 替换（!!js 行原样
 * 保留、JSON.stringify 转义）、home patch 托管块手术（空文件建块 / 用户内容
 * 逐字节保留 / 同 rowId 替换不重复 / 多 preset 共存 / strip 单行与整块 /
 * 损坏块拒绝写盘）、detectPresetSystem 降级链（runtimeSystem 直通 / 进程 argv
 * 宿主版本 rung / dsh --version 不可执行时按单数包存在性探测）、hostVersionFromArgv
 * desktop 宿主 argv 形态（dsh-desktop-host 计入宿主、插件包名不误认）、generateAndInstall
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
  ROLES_AGENT_PRESET,
  ROLES_INLINE,
  backfillHomePatchRows,
  buildPresetRowText,
  detectAgentRolesFlavor,
  detectHostVersionInfo,
  detectHostVersionTriple,
  detectPresetSystem,
  formatGeneratorMarker,
  hostVersionFromArgv,
  isPresetRoleHost,
  isPtcWorkerHost,
  listOrchestratorPresetIds,
  parseGeneratorMarker,
  parseVersionInfo,
  parseVersionTriple,
  isDeclarativeTriple,
  presetRolesFlavorOf,
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

test('buildPresetRowText: delegation-labels 行同款换绝对 file: URL；引用该行而缺 URL 时硬错误', () => {
  const agentYmlText = [
    '- id: orchestrator-restrict',
    '  name: ./restrict.mjs',
    '',
    '- id: delegation-labels',
    '  name: ./delegation-labels.mjs',
    '  config:',
    '    roles: {}',
  ].join('\n')
  const row = buildPresetRowText({
    presetId: 'orchestrator',
    agentYmlText,
    restrictFileUrl: 'file:///tmp/r.mjs',
    delegationLabelsFileUrl: 'file:///tmp/dl.mjs',
  })
  assert.ok(row.includes('          name: file:///tmp/dl.mjs'), 'delegation-labels 行应 +10 缩进换 URL')
  assert.equal(row.includes('./delegation-labels.mjs'), false, '不得残留相对路径')
  assert.ok(row.includes('          name: file:///tmp/r.mjs'), 'restrict 行照旧换 URL')

  // 文本里引用了该行但未提供 URL → 硬错误（相对名静默进 patch 会让 preset 挂掉）
  assert.throws(
    () => buildPresetRowText({ presetId: 'orchestrator', agentYmlText, restrictFileUrl: 'file:///tmp/r.mjs' }),
    /delegationLabelsFileUrl/,
  )
  // 文本不含该行 → 不要求提供（兼容旧行为/合成样例文本）
  assert.doesNotThrow(() =>
    buildPresetRowText({ presetId: 'orchestrator', agentYmlText: '- id: persona\n  name: x', restrictFileUrl: 'file:///tmp/r.mjs' }),
  )
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
  for (const f of ['agent.cordis.yml', 'preset.yml', 'restrict.mjs', 'delegation-labels.mjs']) {
    assert.ok(existsSync(path.join(dstDir, f)), `产物缺失: ${f}`)
  }

  // home patch 托管块：单条声明行、preset 元信息与 preset.yml 同源、restrict 绝对 URL
  const text = readFileSync(patchFile, 'utf8')
  assert.ok(text.includes(MANAGED_BEGIN) && text.includes(MANAGED_END))
  assert.deepEqual(readHomePatchRows(dshHome), [{ rowId: 'preset-orchestrator', presetId: 'orchestrator' }])
  assert.ok(text.includes(`name: ${pathToFileURL(path.join(dstDir, 'restrict.mjs')).href}`), 'restrict 行必须绝对 file: URL')
  assert.ok(!text.includes('./restrict.mjs'), '不得残留相对 restrict 路径')
  assert.ok(
    text.includes(`name: ${pathToFileURL(path.join(dstDir, 'delegation-labels.mjs')).href}`),
    'delegation-labels 行必须绝对 file: URL',
  )
  assert.ok(!text.includes('./delegation-labels.mjs'), '不得残留相对 delegation-labels 路径')
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

test('parseGeneratorMarker/formatGeneratorMarker: v3 往返、旧格式 track/worker/roles=null、空文本 null', () => {
  // v3 三参调用（无第四行）：解析 roles=null（v4 起解析形状恒含 roles 键）
  assert.deepEqual(parseGeneratorMarker(formatGeneratorMarker('0.3.7', 'declarative', 'ptc')), { version: '0.3.7', track: 'declarative', worker: 'ptc', roles: null })
  assert.deepEqual(parseGeneratorMarker(formatGeneratorMarker('0.3.7', 'directory', 'worker-thread')), { version: '0.3.7', track: 'directory', worker: 'worker-thread', roles: null })
  // v2（0.3.6 及以前：版本 + 轨道两行）——worker 形态换代事故的迁移触发态
  assert.deepEqual(parseGeneratorMarker('0.3.6\ndeclarative\n'), { version: '0.3.6', track: 'declarative', worker: null, roles: null })
  // 旧格式（0.3.4 及以前：单行版本）——轨道翻转事故的迁移触发态
  assert.deepEqual(parseGeneratorMarker('0.3.4\n'), { version: '0.3.4', track: null, worker: null, roles: null })
  assert.deepEqual(parseGeneratorMarker('0.3.4'), { version: '0.3.4', track: null, worker: null, roles: null })
  // 次行不是合法轨道值 → track null（宽容：不至于把整个标记作废）；第三/四行同理
  assert.deepEqual(parseGeneratorMarker('0.3.5\nbogus\n'), { version: '0.3.5', track: null, worker: null, roles: null })
  assert.deepEqual(parseGeneratorMarker('0.3.7\ndeclarative\nbogus\n'), { version: '0.3.7', track: 'declarative', worker: null, roles: null })
  assert.equal(parseGeneratorMarker(''), null)
  assert.equal(parseGeneratorMarker(null), null)
  assert.equal(parseGeneratorMarker('   \n  \n'), null)
})

test('isPtcWorkerHost: 0.1.5 边界（prerelease 剥离后逐段比较），null/非法保守保留源行', () => {
  assert.equal(isPtcWorkerHost([0, 1, 5]), false)
  assert.equal(isPtcWorkerHost([0, 1, 5, 99]), false) // 形状不符按未知处理
  assert.equal(isPtcWorkerHost([0, 1, 6]), true)
  assert.equal(isPtcWorkerHost([0, 1, 7]), true)
  assert.equal(isPtcWorkerHost([0, 2, 0]), true)
  assert.equal(isPtcWorkerHost([0, 2, 1]), true)
  assert.equal(isPtcWorkerHost([1, 0, 0]), true)
  assert.equal(isPtcWorkerHost(null), false)
  assert.equal(isPtcWorkerHost(undefined), false)
  assert.equal(isPtcWorkerHost([0, 1]), false)
  assert.equal(isPtcWorkerHost(['0', '1', '6']), false)
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
  assert.ok(text.includes(`name: ${pathToFileURL(path.join(ws, 'delegation-labels.mjs')).href}`), 'delegation-labels 行必须绝对 file: URL')

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
  cpSync(path.join(dshHome, '.agent-presets', 'orchestrator', 'delegation-labels.mjs'), path.join(d3, '.agent-presets', 'orchestrator-ws2', 'delegation-labels.mjs'))
  assert.deepEqual(backfillHomePatchRows(d3, listOrchestratorPresetIds(d3)), ['orchestrator-ws2'])

  // 产物只缺 delegation-labels.mjs（老版生成器留下的目录）→ 与缺 restrict.mjs
  // 同款：跳过并 warn，不拖垮其余补写、不落半残声明行
  const d4 = freshEnv('backfill-nolabels').dshHome
  mkdirSync(path.join(d4, '.agent-presets', 'orchestrator-ws3'), { recursive: true })
  cpSync(path.join(dshHome, '.agent-presets', 'orchestrator', 'agent.cordis.yml'), path.join(d4, '.agent-presets', 'orchestrator-ws3', 'agent.cordis.yml'))
  cpSync(path.join(dshHome, '.agent-presets', 'orchestrator', 'preset.yml'), path.join(d4, '.agent-presets', 'orchestrator-ws3', 'preset.yml'))
  cpSync(path.join(dshHome, '.agent-presets', 'orchestrator', 'restrict.mjs'), path.join(d4, '.agent-presets', 'orchestrator-ws3', 'restrict.mjs'))
  assert.deepEqual(backfillHomePatchRows(d4, listOrchestratorPresetIds(d4)), [], '缺 delegation-labels.mjs 不得补写')
  assert.ok(
    !existsSync(path.join(d4, 'cordis.patch.yml')) ||
      !readFileSync(path.join(d4, 'cordis.patch.yml'), 'utf8').includes('orchestrator-ws3'),
    '不落半残声明行',
  )
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

// hostVersionFromArgv 读真实文件系统：用临时目录构造真实包布局 + 注入 entry
// （函数提供 entry 默认参数 = process.argv[1]，测试无需子进程 / 不碰全局 argv）。

test('hostVersionFromArgv: desktop 宿主 argv[1] 命中 dsh-desktop-host 包；宿主包缺 package.json 时向上穿越照常命中', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-paoding-argvhost-'))
  const nm = path.join(root, 'node_modules', '@deepseek-ai')
  // desktop 宿主真实形态：argv[1] = <dsh>/node_modules/@deepseek-ai/dsh-desktop-host/lib/index.js，
  // 向上一级命中 dsh-desktop-host/package.json（实测 0.2.1-rc.2 desktop 宿主
  // name=@deepseek-ai/dsh-desktop-host、与其打包的 dsh runtime 同版本同轨）
  // → 取包版本即宿主版本。修前此形态返回 null，错误回落 PATH 上的旧 CLI。
  const desktopDir = path.join(nm, 'dsh-desktop-host')
  mkdirSync(path.join(desktopDir, 'lib'), { recursive: true })
  writeFileSync(path.join(desktopDir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-desktop-host', version: '0.2.1-rc.2' }))
  const desktopEntry = path.join(desktopDir, 'lib', 'index.js')
  writeFileSync(desktopEntry, 'export {}')
  assert.equal(hostVersionFromArgv(desktopEntry), '0.2.1-rc.2', 'desktop 宿主 argv 应命中 dsh-desktop-host 包版本')
  // 上游 parseVersionTriple 剥 prerelease → [0,2,1]：版本门控按 0.2.1 走
  assert.deepEqual(parseVersionTriple(hostVersionFromArgv(desktopEntry)), [0, 2, 1])

  // CLI 宿主形态回归：argv[1] 在 @deepseek-ai/dsh 包内照旧命中
  const cliDir = path.join(nm, 'dsh')
  mkdirSync(path.join(cliDir, 'lib'), { recursive: true })
  writeFileSync(path.join(cliDir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.1.7-rc.1' }))
  const cliEntry = path.join(cliDir, 'lib', 'index.js')
  writeFileSync(cliEntry, 'export {}')
  assert.equal(hostVersionFromArgv(cliEntry), '0.1.7-rc.1')

  // 入口所在层无 package.json（desktop-host 包缺元数据等）：继续向上命中最近
  // 宿主包——「非宿主即止」只对找到的 package.json 生效，缺元数据不得落空
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.0' }))
  const bareEntry = path.join(root, 'bare-host', 'lib', 'index.js')
  mkdirSync(path.join(root, 'bare-host', 'lib'), { recursive: true })
  writeFileSync(bareEntry, 'export {}')
  assert.equal(hostVersionFromArgv(bareEntry), '0.2.0')
})

test('hostVersionFromArgv: 插件包名（dsh-personal / dsh-tool-subagent）不得误认宿主；空 entry / 无 package.json 落 null', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-paoding-argvplugin-'))
  const nm = path.join(root, 'node_modules', '@deepseek-ai')
  // 宿主名用显式集合，不做 @deepseek-ai/dsh-* 前缀泛匹配：插件包版本不得冒充宿主版本
  for (const name of ['dsh-personal', 'dsh-tool-subagent']) {
    const dir = path.join(nm, name)
    mkdirSync(path.join(dir, 'lib'), { recursive: true })
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: `@deepseek-ai/${name}`, version: '9.9.9' }))
    const entry = path.join(dir, 'lib', 'index.js')
    writeFileSync(entry, 'export {}')
    assert.equal(hostVersionFromArgv(entry), null, `插件包 @deepseek-ai/${name} 不是宿主`)
  }
  // 非 @deepseek-ai 域的任意包同理落空
  const otherDir = path.join(root, 'node_modules', 'some-tool')
  mkdirSync(otherDir, { recursive: true })
  writeFileSync(path.join(otherDir, 'package.json'), JSON.stringify({ name: 'some-tool', version: '1.0.0' }))
  const otherEntry = path.join(otherDir, 'index.js')
  writeFileSync(otherEntry, 'export {}')
  assert.equal(hostVersionFromArgv(otherEntry), null)
  // 空 / 非字符串 entry（CLI / 测试进程无宿主脚本）→ null
  assert.equal(hostVersionFromArgv(''), null)
  assert.equal(hostVersionFromArgv(null), null)
  // 路径上任何一层都没有 package.json → null（临时目录向上是系统缓存区，无宿主包）
  assert.equal(hostVersionFromArgv(path.join(root, 'no', 'such', 'entry.js')), null)
})

// ── 0.2.1 角色委派行形态（版本门控 / 标记 v4 / role-restrict URL）────────────

test('isPresetRoleHost/presetRolesFlavorOf: 0.2.1 边界（rc 剥离后逐段比较），null/非法保守内联', () => {
  assert.equal(isPresetRoleHost([0, 2, 0]), false)
  assert.equal(isPresetRoleHost([0, 2, 1]), true)
  assert.equal(isPresetRoleHost([0, 2, 2]), true)
  assert.equal(isPresetRoleHost([1, 0, 0]), true)
  assert.equal(isPresetRoleHost(null), false)
  assert.equal(isPresetRoleHost(undefined), false)
  assert.equal(isPresetRoleHost([0, 2]), false)
  assert.equal(isPresetRoleHost(['0', '2', '1']), false)
  assert.equal(presetRolesFlavorOf([0, 2, 0]), ROLES_INLINE)
  assert.equal(presetRolesFlavorOf([0, 2, 1]), ROLES_AGENT_PRESET)
  assert.equal(presetRolesFlavorOf(null), ROLES_INLINE)
  // rc 预发布归并：parseVersionTriple 把 0.2.1-rc.2 剥成 [0,2,1]
  assert.deepEqual(parseVersionTriple('0.2.1-rc.2'), [0, 2, 1])
  assert.equal(presetRolesFlavorOf(parseVersionTriple('0.2.1-rc.2')), ROLES_AGENT_PRESET)
  assert.equal(presetRolesFlavorOf(parseVersionTriple('0.2.1-rc.1')), ROLES_AGENT_PRESET)
})

test('parseGeneratorMarker/formatGeneratorMarker: v4 四行往返；v3 三参调用（无角色行）roles=null；第四行 bogus → null', () => {
  assert.deepEqual(
    parseGeneratorMarker(formatGeneratorMarker('0.4.4', 'declarative', 'ptc', ROLES_AGENT_PRESET)),
    { version: '0.4.4', track: 'declarative', worker: 'ptc', roles: 'agent-preset' },
  )
  assert.deepEqual(
    parseGeneratorMarker(formatGeneratorMarker('0.4.4', 'directory', 'worker-thread', ROLES_INLINE)),
    { version: '0.4.4', track: 'directory', worker: 'worker-thread', roles: 'inline' },
  )
  // v3 时代三参调用：不写第四行，解析 roles=null（老标记 + 新宿主 → 自愈重生成）
  assert.deepEqual(parseGeneratorMarker(formatGeneratorMarker('0.4.3', 'declarative', 'ptc')), {
    version: '0.4.3',
    track: 'declarative',
    worker: 'ptc',
    roles: null,
  })
  // 第四行不是合法角色形态值 → roles null（宽容，不整标记作废）
  assert.deepEqual(parseGeneratorMarker('0.4.4\ndeclarative\nptc\nbogus\n'), {
    version: '0.4.4',
    track: 'declarative',
    worker: 'ptc',
    roles: null,
  })
})

test('buildPresetRowText: role-restrict 行换绝对 file: URL；产物引用该行而缺 URL 时硬错误', () => {
  const agentYmlText = [
    '- id: role-restrict',
    '  name: ./role-restrict.mjs',
    '  config:',
    '    allow:',
    '      - read',
  ].join('\n')
  const row = buildPresetRowText({
    presetId: 'orchestrator',
    agentYmlText,
    restrictFileUrl: 'file:///tmp/orchestrator/restrict.mjs',
    roleRestrictFileUrl: pathToFileURL('/tmp/orchestrator/role-restrict.mjs').href,
  })
  assert.ok(row.includes(`            name: ${pathToFileURL('/tmp/orchestrator/role-restrict.mjs').href}`), 'role-restrict 行应换绝对 file: URL 且缩进 +10')
  assert.equal(row.includes('./role-restrict.mjs'), false)
  // 引用 ./role-restrict.mjs 而漏传 URL → 硬错误（与 delegation-labels 同口径）
  assert.throws(
    () => buildPresetRowText({
      presetId: 'orchestrator',
      agentYmlText,
      restrictFileUrl: 'file:///tmp/orchestrator/restrict.mjs',
    }),
    /引用了 \.\/role-restrict\.mjs（0\.2\.1\+ AgentPreset 形态），但未提供 roleRestrictFileUrl/,
  )
  // 产物不含 role-restrict 行（旧形状）时缺 URL 无妨
  const legacyRow = buildPresetRowText({
    presetId: 'orchestrator',
    agentYmlText: "- id: tool-bash\n  name: '@deepseek-ai/dsh-tool-bash'",
    restrictFileUrl: 'file:///tmp/orchestrator/restrict.mjs',
  })
  assert.ok(legacyRow.includes('tool-bash'))
})

// ── 0.2.1 角色行形态：产物形状判定 + backfill 防毒守卫 ──────────────────────

/** 假宿主版本（DSH_PAODING_FAKE_HOST_VERSION 探测钩子，用毕还原）。 */
async function withFakeHost(version, fn) {
  const prev = process.env.DSH_PAODING_FAKE_HOST_VERSION
  process.env.DSH_PAODING_FAKE_HOST_VERSION = version
  try {
    return await fn()
  } finally {
    if (prev === undefined) delete process.env.DSH_PAODING_FAKE_HOST_VERSION
    else process.env.DSH_PAODING_FAKE_HOST_VERSION = prev
  }
}

test('detectAgentRolesFlavor: 内联→inline、agentPreset→agent-preset、两无→null、混合→从严 inline', () => {
  assert.equal(detectAgentRolesFlavor('a\n        persona: |-\n          x\n'), ROLES_INLINE)
  assert.equal(detectAgentRolesFlavor('- id: delegation\n  config:\n        agentPreset: paoding-role-implement\n'), ROLES_AGENT_PRESET)
  assert.equal(detectAgentRolesFlavor('- id: tool-bash\n  name: x\n'), null, '无角色行（角色清空）对两代宿主都安全')
  assert.equal(
    detectAgentRolesFlavor('        persona: |-\n          x\n        agentPreset: paoding-role-implement\n'),
    ROLES_INLINE,
    '混合/损坏产物按旧形状从严，交给整盘重生成',
  )
})

test('backfillHomePatchRows: 形态防毒——0.2.1 宿主拒绝按内联产物补行（零写盘），0.2.0 宿主照常补', async () => {
  const { dshHome, patchFile } = freshEnv('bf-poison')
  // 真实管线在 0.2.0 假宿主下产出内联形状四件套
  await withFakeHost('0.2.0', async () => {
    const state = await collectState({ dshHome, configFile: path.join(dshHome, 'c.yml'), cwd: dshHome, runtimeFacts: { presetSystem: 'directory' } })
    generateAndInstall(state, structuredClone(state.suggested), {})
  })
  assert.ok(existsSync(path.join(dshHome, '.agent-presets', 'orchestrator', 'role-restrict.mjs')))
  assert.ok(!existsSync(patchFile), 'directory 轨安装不写 patch')

  // 宿主 0.2.1 + 磁盘内联形状：守卫必须拒绝补行（补出去 0.2.1 宿主 apply 即炸）
  await withFakeHost('0.2.1', async () => {
    assert.deepEqual(backfillHomePatchRows(dshHome, listOrchestratorPresetIds(dshHome)), [], '内联产物在 0.2.1 宿主上不得补行')
  })
  assert.ok(!existsSync(patchFile), '防毒守卫必须零写盘')

  // 宿主 0.2.0 + 同一份内联磁盘：照常补行（内联 persona 随产物全文内联进声明行）
  await withFakeHost('0.2.0', async () => {
    assert.deepEqual(backfillHomePatchRows(dshHome, listOrchestratorPresetIds(dshHome)).sort(), ['orchestrator'])
  })
  const patchText = readFileSync(patchFile, 'utf8')
  assert.ok(/        persona: \|-\n/.test(patchText), '0.2.0 宿主补行应含内联 persona（旧形状产物原样内联）')

  // 两无形态（角色清空的产物）不含守卫键：0.2.1 宿主上照常补行
  const { dshHome: d5, patchFile: p5 } = freshEnv('bf-nullflavor')
  mkdirSync(path.join(d5, '.agent-presets', 'orchestrator'), { recursive: true })
  writeFileSync(path.join(d5, '.agent-presets', 'orchestrator', 'agent.cordis.yml'), "- id: tool-bash\n  name: '@deepseek-ai/dsh-tool-bash'\n")
  cpSync(path.join(dshHome, '.agent-presets', 'orchestrator', 'preset.yml'), path.join(d5, '.agent-presets', 'orchestrator', 'preset.yml'))
  cpSync(path.join(dshHome, '.agent-presets', 'orchestrator', 'restrict.mjs'), path.join(d5, '.agent-presets', 'orchestrator', 'restrict.mjs'))
  cpSync(path.join(dshHome, '.agent-presets', 'orchestrator', 'delegation-labels.mjs'), path.join(d5, '.agent-presets', 'orchestrator', 'delegation-labels.mjs'))
  await withFakeHost('0.2.1', async () => {
    assert.deepEqual(backfillHomePatchRows(d5, listOrchestratorPresetIds(d5)), ['orchestrator'], '两无形态不含 0.2.1 守卫键，可安全补行')
  })
  assert.ok(existsSync(p5))
})

test('0.2.1 角色行形态门的 prerelease 边界：守卫 0.2.1-rc.2 落地，rc.0/rc.1 保持内联', () => {
  assert.equal(isPresetRoleHost([0, 2, 1], 'rc.0'), false)
  assert.equal(isPresetRoleHost([0, 2, 1], 'rc.1'), false, 'rc.1 仍认内联形状，换代反而会被拒')
  assert.equal(isPresetRoleHost([0, 2, 1], 'rc.2'), true, '守卫落地点')
  assert.equal(isPresetRoleHost([0, 2, 1], 'rc.10'), true, 'rc.N 按数值比较')
  assert.equal(isPresetRoleHost([0, 2, 1], null), true, '0.2.1 正式版：新形态')
  assert.equal(isPresetRoleHost([0, 2, 1]), true, 'prerelease 未知（旧调用方只传三元组）：保持原行为')
  assert.equal(isPresetRoleHost([0, 2, 2], 'rc.1'), true, 'triple 越过 0.2.1 一律新形态（更高版本的 rc 也带守卫）')
  assert.equal(isPresetRoleHost([0, 2, 0], 'rc.9'), false)
  assert.equal(presetRolesFlavorOf([0, 2, 1], 'rc.1'), ROLES_INLINE)
  assert.equal(presetRolesFlavorOf([0, 2, 1], 'rc.2'), ROLES_AGENT_PRESET)
})

test('parseVersionInfo / detectHostVersionInfo：prerelease 原文保留，探测链与三元组版同源', async () => {
  assert.deepEqual(parseVersionInfo('0.2.1-rc.2'), { triple: [0, 2, 1], prerelease: 'rc.2' })
  assert.deepEqual(parseVersionInfo('v1.2.3+build.7'), { triple: [1, 2, 3], prerelease: null })
  assert.deepEqual(parseVersionInfo('0.1.7-rc.1'), { triple: [0, 1, 7], prerelease: 'rc.1' })
  assert.equal(parseVersionInfo('nonsense'), null)
  await withFakeHost('0.2.1-rc.1', async () => {
    assert.deepEqual(detectHostVersionInfo(), { triple: [0, 2, 1], prerelease: 'rc.1' })
    assert.deepEqual(detectHostVersionTriple(), [0, 2, 1], '三元组视图照旧剥 prerelease（worker/轨道门不受影响）')
  })
})
