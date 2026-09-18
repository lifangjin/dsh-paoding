/**
 * YAML 装载与 patch 解析：loadYaml（经 createRequire 从 $DSH_HOME/node_modules
 * 惰性加载 yaml 包）、preprocessPatchText（中和 cordis 的 !!js 表达式）与内置
 * YAML subset 回退解析器（parsePatchFile / parseYamlSubset 家族，块标量 /
 * insert 包裹等由 consumeBlockScalar / flattenEntries 等支撑）。
 * 依赖 util（warn）与 node:fs / node:module / node:path；被 config / state 引用。
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { warn } from './util.mjs'

// ── yaml loading ────────────────────────────────────────────────────────────

/**
 * Resolve the `yaml` package from $DSH_HOME/node_modules via createRequire.
 * The directory is managed by the dsh host (profile installs included), which
 * ships yaml v2.  Returns null when unavailable — callers then use the
 * built-in fallback parser.
 */
export function loadYaml(dshHome) {
  try {
    const requireFromDsh = createRequire(path.join(dshHome, 'node_modules', 'package.json'))
    const mod = requireFromDsh('yaml')
    if (mod && typeof mod.parse === 'function' && typeof mod.parseDocument === 'function') {
      return mod
    }
  } catch {
    /* yaml missing or unreadable — fall back to the subset parser */
  }
  return null
}

// ── patch parsing ───────────────────────────────────────────────────────────

/**
 * Neutralize the cordis `!!js` expressions found in real patch files before
 * any parser sees them (yaml would otherwise raise unresolved-tag warnings).
 */
export function preprocessPatchText(text) {
  const isWin = process.platform === 'win32'
  return text
    .replaceAll("!!js process.platform === 'win32'", isWin ? 'true' : 'false')
    .replaceAll("!!js process.platform !== 'win32'", isWin ? 'false' : 'true')
    .replaceAll('!!js process.cwd()', JSON.stringify(process.cwd()))
}

/** Parse one patch file.  Returns the top-level array, or null (warned) on failure. */
export function parsePatchFile(file, yamlMod) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (err) {
    warn(`${file}: unreadable (${err.message}) — skipped`)
    return null
  }
  const processed = preprocessPatchText(text)

  if (yamlMod) {
    try {
      const data = yamlMod.parse(processed)
      if (Array.isArray(data)) return data
      warn(`${file}: parsed but the top level is not a list — skipped`)
      return null
    } catch (yamlErr) {
      warn(`${file}: yaml parse failed (${yamlErr.message}) — trying the built-in fallback parser`)
    }
  }

  try {
    const data = parseYamlSubset(processed)
    if (Array.isArray(data)) return data
    warn(`${file}: fallback parser produced a non-list result — skipped`)
    return null
  } catch (err) {
    warn(`${file}: could not be parsed (fallback: ${err.message}) — skipped`)
    return null
  }
}

/** 块标量值标记行：`|` / `>` 及裁剪（-）/保留（+）/显式缩进指示符（数字）的
 * 全部组合变体（如 `|-`、`|2`、`|2-`、`>-`），两个指示符先后顺序均兼容。 */
const BLOCK_SCALAR_MARKER_RE = /^[|>][+-]?\d*[+-]?$/

/**
 * Minimal YAML subset parser, used only for patch files when `yaml` is
 * unavailable.  Supports: top-level list items, nested maps, scalar values
 * (single/double-quoted strings, numbers, true/false), `#` comments and
 * `- insert:` wrapping.  Map keys may be quoted（workspaces 的路径键一律带
 * 引号落盘，见 unquoteKey）—— 嵌套 map + 带引号键按同款规则解析。
 * 块标量（| > 变体）正文原样保留：注释与空行在块标量里是数据不是结构，
 * 预处理不得剥除（此前 loadConfig→saveConfig 会把 persona 里的注释/空段
 * 静默抹掉）。两趟走：先在原文上标出块标量正文行，再只对结构行做剥注释/
 * 丢空行。
 */
export function parseYamlSubset(text) {
  const rawLines = text.split(/\r?\n/)
  // 第一趟：标记块标量正文行。结构行（剥注释后）以块标量标记结尾即开块，
  // 其后「空行或缩进更深」的原文行都是正文（与 consumeBlockScalar 的相对
  // 深度判定一致），直到缩进 <= 键缩进的结构行收块。
  const inBody = new Array(rawLines.length).fill(false)
  let bodyIndent = -1
  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i]
    if (bodyIndent !== -1) {
      if (raw.trim() === '' || raw.match(/^[ \t]*/)[0].length > bodyIndent) {
        inBody[i] = true
        continue
      }
      bodyIndent = -1 // 落到下方按结构行处理
    }
    const stripped = stripInlineComment(raw).replace(/[ \t]+$/, '')
    if (stripped.trim() === '') continue
    const indent = stripped.match(/^[ \t]*/)[0].length
    const probe = stripped.replace(/^[ \t]*-[ \t]+/, '') // 列表项 `- key: |-` 同款判定
    if (looksLikeKeyValue(probe)) {
      const [, value] = splitKeyValue(probe)
      if (value !== undefined && BLOCK_SCALAR_MARKER_RE.test(value)) bodyIndent = indent
    }
  }
  // 第二趟：结构行剥注释/去尾空白/丢空行；正文行整行原样入列（body 标记
  // 供 consumeBlockScalar 跳过缩进判定，空行/浅缩进注释都算正文）。
  const lines = []
  for (let i = 0; i < rawLines.length; i++) {
    if (inBody[i]) {
      const indent = rawLines[i].match(/^[ \t]*/)[0].length
      lines.push({ indent, text: rawLines[i].slice(indent), body: true })
      continue
    }
    const line = stripInlineComment(rawLines[i]).replace(/[ \t]+$/, '')
    if (line.trim() === '') continue
    const indent = line.match(/^[ \t]*/)[0].length
    lines.push({ indent, text: line.slice(indent) })
  }
  if (lines.length === 0) return []
  const [value] = parseBlock(lines, 0, lines[0].indent)
  return value
}

export function stripInlineComment(line) {
  let inSingle = false
  let inDouble = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inSingle) {
      if (c === "'") inSingle = false
      continue
    }
    if (inDouble) {
      // 双引号内的 \" 是转义引号：翻转前回看前一字符是否为 \，否则含转义
      // 引号的值会提前/推迟结束字符串，把真实注释误当正文（或反之截断）。
      if (c === '"' && line[i - 1] !== '\\') inDouble = false
      continue
    }
    if (c === "'") inSingle = true
    else if (c === '"') inDouble = true
    // YAML comments start with '#' only at line start or after whitespace.
    else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i)
  }
  return line
}

/** YAML 块标量（| > 及其折叠/裁剪/显式缩进指示符变体）值标记：后续更深的行
 * 全部属该标量正文，直到遇到缩进 <= 键缩进的行（同级键/父级结束）。正文行带
 * body 标记（parseYamlSubset 预处理产出）：空行/注释行在正文里是数据，不受
 * keyIndent 判定约束，原样并入。返回拼接正文与下一行下标。
 * 说明：parseYamlSubset 是 yaml 包缺失时的回退解析器；此前块标量（如角色
 * persona: |-）之后的同级键/顶层键（roles_remove / main_agent_extra 等）会被
 * 误判为无法解析而静默丢弃，导致回读配置丢键；正文里的注释/空行也会被预处理
 * 剥掉（loadConfig→saveConfig 往返丢段落）。尾部空行按裁剪（clip）语义去掉，
 * 中段空行原样保留。 */
export function consumeBlockScalar(lines, i, keyIndent) {
  const parts = []
  while (i < lines.length && (lines[i].body || lines[i].indent > keyIndent)) {
    parts.push(lines[i].text)
    i++
  }
  while (parts.length > 0 && parts[parts.length - 1] === '') parts.pop()
  return { value: parts.join('\n'), next: i }
}

export function parseBlock(lines, i, indent) {
  if (lines[i].text.startsWith('- ')) return parseList(lines, i, indent)
  return parseMap(lines, i, indent)
}

export function parseList(lines, i, indent) {
  const out = []
  while (i < lines.length && lines[i].indent === indent && lines[i].text.startsWith('- ')) {
    const rest = lines[i].text.slice(2).trim()
    i++
    if (rest === '') {
      // `- ` followed by a nested block (e.g. `- insert:`)
      if (i < lines.length && lines[i].indent > indent) {
        const [value, next] = parseBlock(lines, i, lines[i].indent)
        out.push(value)
        i = next
      } else {
        out.push(null)
      }
    } else if (looksLikeKeyValue(rest)) {
      const [key, value] = splitKeyValue(rest)
      const item = {}
      if (value === undefined) {
        if (i < lines.length && lines[i].indent > indent) {
          const [nested, next] = parseBlock(lines, i, lines[i].indent)
          item[key] = nested
          i = next
        } else {
          item[key] = null
        }
      } else {
        let parsed = parseScalar(value)
        if (
          BLOCK_SCALAR_MARKER_RE.test(String(value).trim()) &&
          i < lines.length &&
          (lines[i].indent > indent || lines[i].body)
        ) {
          const blk = consumeBlockScalar(lines, i, indent)
          parsed = blk.value
          i = blk.next
        }
        item[key] = parsed
      }
      // Remaining keys of this map item continue at a deeper indent.
      if (i < lines.length && lines[i].indent > indent) {
        const [more, next] = parseMap(lines, i, lines[i].indent)
        Object.assign(item, more)
        i = next
      }
      out.push(item)
    } else {
      out.push(parseScalar(rest))
    }
  }
  return [out, i]
}

export function parseMap(lines, i, indent) {
  const out = {}
  while (i < lines.length && lines[i].indent === indent && !lines[i].text.startsWith('- ')) {
    const line = lines[i].text
    if (!looksLikeKeyValue(line)) break
    const [key, value] = splitKeyValue(line)
    i++
    if (value === undefined) {
      if (i < lines.length && lines[i].indent > indent) {
        const [nested, next] = parseBlock(lines, i, lines[i].indent)
        out[key] = nested
        i = next
      } else {
        out[key] = null
      }
    } else {
      let parsed = parseScalar(value)
      if (
        BLOCK_SCALAR_MARKER_RE.test(String(value).trim()) &&
        i < lines.length &&
        (lines[i].indent > indent || lines[i].body)
      ) {
        const blk = consumeBlockScalar(lines, i, indent)
        parsed = blk.value
        i = blk.next
      }
      out[key] = parsed
    }
  }
  return [out, i]
}

export function looksLikeKeyValue(rest) {
  const trimmed = rest.trim()
  if (trimmed.endsWith(':') && trimmed.length > 1) return true
  return trimmed.includes(': ') || trimmed.includes(':\t')
}

/**
 * 键名剥壳：workspaces 段的路径键一律单引号包裹落盘——路径可含 ':' / '#' 等
 * 会被键值切分或行内注释截断的歧义字符，裸写有歧义。回读时必须剥掉引号还原
 * 真实键，否则 workspaces.<path> 查不到条目；普通键名不含引号，原样放行。
 * （局限：带引号键内含 ': ' 且同行还跟标量值时仍会切错位——本解析器只作
 * yaml 包缺失时的回退，serializeConfig 写出的工作区键均为独立行，不受影响。）
 */
export function unquoteKey(key) {
  if (key.length >= 2 && key.startsWith("'") && key.endsWith("'")) {
    return key.slice(1, -1).replace(/''/g, "'")
  }
  if (key.length >= 2 && key.startsWith('"') && key.endsWith('"')) {
    try {
      return JSON.parse(key)
    } catch {
      return key.slice(1, -1)
    }
  }
  return key
}

/** Split `key: value` at the first colon; a trailing `key:` yields undefined.
 *  键名过 unquoteKey 剥壳（见上：workspaces 带引号路径键）。 */
export function splitKeyValue(rest) {
  const trimmed = rest.trim()
  if (trimmed.endsWith(':')) return [unquoteKey(trimmed.slice(0, -1).trim()), undefined]
  const idx = trimmed.indexOf(': ')
  if (idx === -1) return [unquoteKey(trimmed), undefined]
  return [unquoteKey(trimmed.slice(0, idx).trim()), trimmed.slice(idx + 2).trim()]
}

export function parseScalar(raw) {
  const s = raw.trim()
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1).replace(/''/g, "'")
  }
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    try {
      return JSON.parse(s)
    } catch {
      return s.slice(1, -1)
    }
  }
  if (s === 'true') return true
  if (s === 'false') return false
  if (s === 'null' || s === '~') return null
  // 空流式序列 []：serializeConfig 对显式空 main_agent_extra 落盘 `[]`，回读时
  // 必须还原为数组而非字符串，否则 has_main_agent_extra 判否、显式空语义丢失。
  // （非空流式 [a, b] 仍不支持 —— 现有消费键均走块列表或 yaml 包路径。）
  if (s === '[]') return []
  if (/^-?\d+$/.test(s) || /^-?\d*\.\d+$/.test(s)) return Number(s)
  return s
}

/** Recursively expand `- insert:` wrappers into plain entries. */
export function flattenEntries(list, out = []) {
  for (const item of list ?? []) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    if (item.insert !== undefined) {
      if (Array.isArray(item.insert)) flattenEntries(item.insert, out)
      else if (item.insert && typeof item.insert === 'object') flattenEntries([item.insert], out)
    } else {
      out.push(item)
    }
  }
  return out
}
