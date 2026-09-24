/**
 * 预设安装机制双轨 —— DSH ≤0.1.6 靠宿主 dsh-agent-presets（复数）扫描
 * $DSH_HOME/.agent-presets/<id>/ 目录成 preset（目录扫描轨）；0.1.7 起目录扫描
 * 机制删除，改为声明行：bundle/profile/home 任一 patch 层里 - insert: 一条
 * name: '@deepseek-ai/dsh-agent-preset' 的行（config = { id 必填, name?,
 * description?, order?, plugins[] 必填 }，宿主 agent-preset-registry 挂载
 * plugins 子树；行 name 相对声明行 baseUrl 解析，绝对 file: URL 直接采用）。
 * 本模块为双轨化提供三件事：
 *   1) 轨道探测 detectPresetSystem：运行时探测（Web 插件对宿主服务的实时反射，
 *      最权威）> `dsh --version` 版本号 > $DSH_HOME 单数包存在性 > 默认
 *      directory（安全侧：声明行误落 0.1.6 会炸 profile 启动，目录轨误落
 *      0.1.7 只是预设不显示）；
 *   2) 声明行构造 buildPresetRowText：把生成的 agent.cordis.yml 全文内联成
 *      一条声明行的 config.plugins（restrict 行 name 换成 restrict.mjs 的绝对
 *      file: URL——声明轨没有「相对 preset 目录」语义，必须绝对化）；
 *   3) home patch 托管块手术 upsertHomePatchRows / stripHomePatchRows /
 *      readHomePatchRows：对 $DSH_HOME/cordis.patch.yml 的 MANAGED 标记块做
 *      行级增删查，块外用户内容一字节不动；托管块损坏（缺结束标记）时拒绝
 *      写盘并明确报错，与仓库「配置不可信时拒绝落盘」口径一致。
 * 零运行时依赖（node:child_process / node:fs / node:path）；被 state 引用。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { warn } from './util.mjs'

/** 托管块起始标记：其后到结束标记之间是本工具自动生成的声明行，用户勿改。 */
export const MANAGED_BEGIN = '# --- dsh-paoding presets (auto-generated; do not edit) ---'
/** 托管块结束标记。两个标记成对出现；缺一即视为托管块损坏，拒绝写盘。 */
export const MANAGED_END = '# --- end dsh-paoding presets ---'

/** 声明行挂载的宿主 preset 包名（0.1.7+ 的 agent-preset-registry 组件包）。 */
export const PRESET_ROW_NAME = '@deepseek-ai/dsh-agent-preset'

/** preset 目录名（orchestrator / orchestrator-<slug>）→ home patch 声明行 id。 */
export function presetRowId(presetId) {
  return `preset-${presetId}`
}

// ── 版本解析与轨道判定 ──────────────────────────────────────────────────────

/**
 * 解析裸版本号文本为 [major, minor, patch] 数字三元组；解析不了返回 null。
 * prerelease / build 标签忽略（0.1.7-rc.1 → [0, 1, 7]）。
 */
export function parseVersionTriple(text) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(text ?? '').trim())
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

/** 三元组是否达到声明行轨（0.1.7+）：逐段数值比较，prerelease 已在上游剥掉。 */
export function isDeclarativeTriple(triple) {
  if (!Array.isArray(triple) || triple.length !== 3 || triple.some((n) => !Number.isInteger(n))) return false
  const base = [0, 1, 7]
  for (let i = 0; i < 3; i++) {
    if (triple[i] !== base[i]) return triple[i] > base[i]
  }
  return true
}

/**
 * 探测当前宿主的预设安装轨道，返回 'declarative' | 'directory'。逐级降级：
 *   1) runtimeSystem 直通：Web 插件运行时对宿主服务的实时探测结果最权威；
 *   2) `dsh --version`（timeout 10s；spawn 失败 / 超时 / 输出不可解析一律吞掉
 *      落到下一级）；
 *   3) 文件探测：单数包 @deepseek-ai/dsh-agent-preset 是 0.1.7 的声明行宿主
 *      组件，在即声明轨（复数包时代没有它）；
 *   4) 默认 directory —— 安全侧兜底（理由见模块头注释）。
 */
export async function detectPresetSystem({ dshHome, runtimeSystem = null } = {}) {
  if (runtimeSystem === 'declarative' || runtimeSystem === 'directory') return runtimeSystem
  const versionText = dshVersionText()
  if (versionText !== null) {
    const triple = parseVersionTriple(versionText)
    if (triple !== null) return isDeclarativeTriple(triple) ? 'declarative' : 'directory'
  }
  if (existsSync(path.join(dshHome, 'node_modules', '@deepseek-ai', 'dsh-agent-preset'))) return 'declarative'
  return 'directory'
}

/** `dsh --version` 取裸版本号文本；任何失败（ENOENT / 超时 / 非零退出）返回 null。 */
function dshVersionText() {
  try {
    const res = spawnSync('dsh', ['--version'], { timeout: 10_000, encoding: 'utf8' })
    if (res.error || res.status !== 0) return null
    const text = String(res.stdout ?? '').trim()
    return text === '' ? null : text
  } catch {
    return null
  }
}

// ── 声明行构造 ──────────────────────────────────────────────────────────────

/**
 * 构造一条 preset 声明行（insert 列表元素）的 YAML 文本：
 *
 *     - id: preset-orchestrator
 *       name: '@deepseek-ai/dsh-agent-preset'
 *       config:
 *         id: orchestrator
 *         name: "编排模式 (Orchestrator)"
 *         description: "..."
 *         order: 5
 *         plugins:
 *           <agent.cordis.yml 全文，每非空行加 10 空格>
 *
 * 缩进基准：4 空格起排（`- insert:` 列表项层级由 upsertHomePatchRows 拼），
 * plugins: 落 8 空格、插件条目行落 10 空格。name/description 用 JSON.stringify
 * 落值——JSON 字符串即合法 YAML 双引号标量，换行/引号自动转义。agentYmlText
 * 先把 restrict 行的 `name: ./restrict.mjs` 替换为 restrictFileUrl（绝对 file:
 * URL），再整体 +10 缩进；空行保持空行（块标量相对缩进不变），`!!js` 表达式
 * 行原样保留（宿主 patch schema 支持，求值仍由 cordis 装载时完成）。
 */
export function buildPresetRowText({ presetId, name = null, description = null, order = null, agentYmlText, restrictFileUrl }) {
  if (typeof presetId !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(presetId)) {
    throw new Error(`buildPresetRowText: 非法 presetId: ${presetId}`)
  }
  if (typeof agentYmlText !== 'string' || agentYmlText === '') {
    throw new Error('buildPresetRowText: agentYmlText 不能为空')
  }
  if (typeof restrictFileUrl !== 'string' || restrictFileUrl === '') {
    throw new Error('buildPresetRowText: restrictFileUrl 不能为空')
  }
  const lines = [
    `    - id: ${presetRowId(presetId)}`,
    `      name: '${PRESET_ROW_NAME}'`,
    '      config:',
    `        id: ${presetId}`,
  ]
  if (typeof name === 'string' && name !== '') lines.push(`        name: ${JSON.stringify(name)}`)
  if (typeof description === 'string' && description !== '') lines.push(`        description: ${JSON.stringify(description)}`)
  if (Number.isInteger(order)) lines.push(`        order: ${order}`)
  lines.push('        plugins:')
  for (const line of String(agentYmlText).split(/\r?\n/)) {
    if (line.trim() === '') {
      lines.push('')
      continue
    }
    // restrict 行换绝对 file: URL（按行精确内容匹配，缩进原样保留）
    const replaced = line.trim() === 'name: ./restrict.mjs'
      ? `${line.match(/^[ \t]*/)[0]}name: ${restrictFileUrl}`
      : line
    lines.push(`          ${replaced}`)
  }
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop() // 去尾部空行，段拼接才紧凑
  return lines.join('\n')
}

// ── home patch 托管块手术 ───────────────────────────────────────────────────
//
// 托管块落在 $DSH_HOME/cordis.patch.yml（home 层 patch，作用于所有 profile），
// 形态：
//
//     # --- dsh-paoding presets (auto-generated; do not edit) ---
//     - insert:
//         - id: preset-orchestrator
//           name: '@deepseek-ai/dsh-agent-preset'
//           config:
//             ...
//     # --- end dsh-paoding presets ---
//
// 每条声明行各自包一层 0 缩进的 `- insert:`（宿主约定「自定义【新增】条目必须
// 用 - insert: 包一层」，顶层 - id: 是修改已有条目语义），声明行本体按
// buildPresetRowText 的 4 空格基准缩进，作 insert 列表元素。块外用户内容除
// strip 的空行收敛外一字节不动。

/** home 层 patch 文件路径。 */
function patchFilePath(dshHome) {
  return path.join(dshHome, 'cordis.patch.yml')
}

/** 读 home patch 为行数组；文件缺失当空文件。行尾换行符风格随原文件保留。 */
function readPatchLines(dshHome) {
  let text = ''
  try {
    text = readFileSync(patchFilePath(dshHome), 'utf8')
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err
    return { lines: [], eol: '\n' }
  }
  if (text === '') return { lines: [], eol: '\n' }
  return { lines: text.split(/\r?\n/), eol: text.includes('\r\n') ? '\r\n' : '\n' }
}

function writePatchLines(dshHome, lines, eol) {
  mkdirSync(dshHome, { recursive: true })
  writeFileSync(patchFilePath(dshHome), lines.join(eol), 'utf8')
}

/**
 * 在行数组里定位托管块 [begin, end]（闭区间下标）。无起始标记返回 null；
 * 有起始无结束（托管块损坏，多半是用户手删了半截）throw 明确错误——后续写盘
 * 一律拒绝，绝不覆盖手工内容。
 */
function findManagedSpan(lines) {
  const begin = lines.findIndex((l) => l.trim() === MANAGED_BEGIN)
  if (begin === -1) return null
  let end = -1
  for (let i = begin + 1; i < lines.length; i++) {
    if (lines[i].trim() === MANAGED_END) {
      end = i
      break
    }
  }
  if (end === -1) {
    throw new Error(
      `cordis.patch.yml 的 dsh-paoding 托管块已损坏（只有起始标记、找不到结束标记 "${MANAGED_END}"）：` +
        '请手工补回结束标记，或把整个托管块删除后重试；已拒绝写盘以免覆盖手工内容',
    )
  }
  return { begin, end }
}

/** 托管块内声明行段的起始行：4 空格缩进的 `- id: preset-...`。 */
const ROW_ID_LINE_RE = /^ {4}- id: (preset-\S+)[ \t]*$/

/**
 * 把托管块内容行解析成行段数组 [{ rowId, lines }]：每个段由 `- insert:` 包裹行
 * （若紧邻在 `- id:` 行上方）加声明行本体组成，到下一段或块尾止。段尾空行归
 * 所属段，重写时裁掉保持块紧凑。
 */
function parseRowSegments(blockLines) {
  const marks = []
  for (let i = 0; i < blockLines.length; i++) {
    const m = ROW_ID_LINE_RE.exec(blockLines[i])
    if (!m) continue
    // 段首含紧邻的 `- insert:` 包裹行；包裹行不在（手工摆弄过）则从行本体起段
    const segStart = i > 0 && blockLines[i - 1].trim() === '- insert:' ? i - 1 : i
    marks.push({ rowId: m[1], segStart })
  }
  return marks.map((mk, idx) => ({
    rowId: mk.rowId,
    lines: blockLines.slice(mk.segStart, idx + 1 < marks.length ? marks[idx + 1].segStart : blockLines.length),
  }))
}

/** 裁掉行数组尾部的空行（不含末尾那个代表「文件以换行结束」的空元素）。 */
function trimTrailingBlankLines(lines) {
  const out = [...lines]
  while (out.length > 1 && out[out.length - 1].trim() === '') out.pop()
  return out
}

/** 3+ 连续空行收敛为一个空行（strip 撤行后的兜底收拾；1-2 连续空行原样保留）。 */
function collapseBlankRuns(lines) {
  const out = []
  let blankRun = 0
  for (const line of lines) {
    if (line.trim() === '') {
      blankRun++
      continue
    }
    if (blankRun > 0) {
      if (blankRun >= 3) out.push('')
      else for (let i = 0; i < blankRun; i++) out.push('')
      blankRun = 0
    }
    out.push(line)
  }
  for (let i = 0; i < blankRun; i++) out.push('') // 文件尾空行原样保留
  return out
}

/**
 * 把若干声明行（buildPresetRowText 产物）行级 upsert 进 home patch 托管块。
 * 托管块不存在则文末新建（非空文件先补尾换行、块前空一行）；已存在则块内按
 * rowId 替换 / 追加，块外用户内容一字节不动。托管块损坏时 throw（不写盘）。
 */
export function upsertHomePatchRows(dshHome, rowTexts) {
  const rows = (Array.isArray(rowTexts) ? rowTexts : [])
    .filter((t) => typeof t === 'string' && t.trim() !== '')
  if (rows.length === 0) return
  const wanted = rows.map((text) => {
    const rowLines = text.replace(/\r?\n$/, '').split('\n')
    const m = ROW_ID_LINE_RE.exec(rowLines[0])
    if (!m) {
      throw new Error(`buildPresetRowText 产出的行文本缺少 4 空格缩进的 "- id: preset-..." 首行: ${rowLines[0]}`)
    }
    return { rowId: m[1], lines: ['- insert:', ...rowLines] }
  })
  // 同 rowId 传多条时后者生效（Map 去重，保证替换语义而非重复追加）
  const wantedById = new Map(wanted.map((w) => [w.rowId, w]))

  const { lines, eol } = readPatchLines(dshHome)
  const span = findManagedSpan(lines) // 损坏块 throw，直接中止（未写任何盘）
  if (span !== null) {
    const segments = parseRowSegments(lines.slice(span.begin + 1, span.end))
    const merged = []
    for (const seg of segments) {
      if (wantedById.has(seg.rowId)) merged.push(...wantedById.get(seg.rowId).lines)
      else merged.push(...trimTrailingBlankLines(seg.lines)) // 块内其余 preset 的行原样保留
    }
    for (const w of wanted) {
      if (!segments.some((s) => s.rowId === w.rowId)) merged.push(...w.lines) // 新行追加到块尾
    }
    const next = [...lines.slice(0, span.begin), MANAGED_BEGIN, ...merged, MANAGED_END, ...lines.slice(span.end + 1)]
    writePatchLines(dshHome, next, eol)
    return
  }
  // 无托管块：文末新建。非空文件先补尾换行（若缺）。块前空一行不再单独推：
  // split 出的末尾 '' 元素（文件尾换行）后面紧跟新内容时，join 天然渲染出一个
  // 空行，正好兼任块前分隔——补的尾换行元素同理。额外再推一个空行会变成两个。
  const out = [...lines]
  const hasContent = out.some((l) => l.trim() !== '')
  if (hasContent && out[out.length - 1].trim() !== '') out.push('')
  out.push(MANAGED_BEGIN)
  for (const w of wanted) out.push(...w.lines)
  out.push(MANAGED_END, '')
  writePatchLines(dshHome, out, eol)
}

/**
 * 从 home patch 托管块撤掉指定 rowId 的声明行段；rowIdsOrAll 传 null 删整块
 * （含起止标记与块前自加的空行分隔，用户内容回到插入前的字节形态）。
 * 块不存在 / 指定行都不在场返回 false（未写盘）；托管块损坏时 warn 后返回
 * false（撤行是锦上添花的自愈路径，不值得为此中断安装，修复由 upsert 的
 * 明确报错引导）。
 */
export function stripHomePatchRows(dshHome, rowIdsOrAll = null) {
  let lines
  let eol
  try {
    ({ lines, eol } = readPatchLines(dshHome))
  } catch (err) {
    warn(`cordis.patch.yml 读取失败，声明行撤除跳过: ${err?.message ?? err}`)
    return false
  }
  let span = null
  try {
    span = findManagedSpan(lines)
  } catch (err) {
    warn(`${err.message}（声明行撤除跳过）`)
    return false
  }
  if (span === null) return false

  const allSegments = parseRowSegments(lines.slice(span.begin + 1, span.end))
  const targets = rowIdsOrAll === null
    ? allSegments
    : allSegments.filter((s) => new Set(rowIdsOrAll).has(s.rowId))
  if (targets.length === 0) return false

  if (targets.length === allSegments.length) {
    // 整块摘除：连同块前那行本工具自加的空行分隔一起拿掉（空行分隔是自己
    // 加的，摘掉才算「用户内容回到插入前」）
    let start = span.begin
    if (start > 0 && lines[start - 1].trim() === '' && lines.slice(0, start).some((l) => l.trim() !== '')) start -= 1
    const next = [...lines.slice(0, start), ...lines.slice(span.end + 1)]
    // 文件撤空（只剩空行）就落空文件，不留一撮换行尾巴
    const empty = next.every((l) => l.trim() === '')
    writePatchLines(dshHome, empty ? [] : collapseBlankRuns(next), eol)
    return true
  }
  // 块内还有其余 preset 的行：只摘指定段，标记与块结构保留
  const removeIds = new Set(targets.map((t) => t.rowId))
  const merged = []
  for (const seg of allSegments) {
    if (!removeIds.has(seg.rowId)) merged.push(...trimTrailingBlankLines(seg.lines))
  }
  const next = [...lines.slice(0, span.begin), MANAGED_BEGIN, ...merged, MANAGED_END, ...lines.slice(span.end + 1)]
  writePatchLines(dshHome, collapseBlankRuns(next), eol)
  return true
}

/**
 * 读 home patch 托管块里现有的声明行 [{ rowId, presetId }]（presetId 取自声明
 * 行 config 的 id: 值，8 空格缩进；解析不出为 null）。文件缺失 / 无托管块 /
 * 托管块损坏一律返回空数组——调用方只拿它做「块在不在」的判断。
 */
export function readHomePatchRows(dshHome) {
  let lines
  try {
    ({ lines } = readPatchLines(dshHome))
  } catch {
    return []
  }
  try {
    const span = findManagedSpan(lines)
    if (span === null) return []
    const configIdRe = /^ {8}id: (\S+)[ \t]*$/
    return parseRowSegments(lines.slice(span.begin + 1, span.end)).map((seg) => {
      const idLine = seg.lines.find((l) => configIdRe.test(l))
      return { rowId: seg.rowId, presetId: idLine ? configIdRe.exec(idLine)[1] : null }
    })
  } catch {
    return []
  }
}
