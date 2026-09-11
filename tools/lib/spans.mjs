/**
 * 源文本 span 定位：在 agent.cordis.yml 源文本中定位各内置角色 toolFilter.allow
 * 与 persona 块标量的字节区间（yaml AST 优先、结构化 regex 兜底）——
 * locateAllowBlocks / locateAllowBlocksYaml / locateAllowBlocksRegex /
 * locatePersonaBlocks 及内部 walkMaps / leadingIndent / ALLOW_BLOCK_RE。
 * 依赖 util（ROLES / warn）；被 state 引用。
 */
import { ROLES, warn } from './util.mjs'

// ── allow-list location & rewriting ─────────────────────────────────────────

/**
 * Locate each role's toolFilter.allow block in the source agent.cordis.yml.
 * Preferred strategy: parseDocument AST node ranges (surgical, byte-exact).
 * Fallback: structured regex.  Returns a Map role -> { start, end, itemIndent,
 * names } where [start, end) is the exact span of the allow item lines.
 */
export function locateAllowBlocks(srcText, yamlMod) {
  if (yamlMod) {
    try {
      const blocks = locateAllowBlocksYaml(srcText, yamlMod)
      for (const role of ROLES) {
        if (!blocks.has(role)) throw new Error(`role ${role}: allow block not found`)
      }
      return blocks
    } catch (yamlErr) {
      warn(`source allow-list location via yaml failed (${yamlErr.message}) — falling back to regex`)
    }
  }
  return locateAllowBlocksRegex(srcText)
}

export function locateAllowBlocksYaml(srcText, yamlMod) {
  const doc = yamlMod.parseDocument(srcText)
  const blocks = new Map()
  walkMaps(doc.contents, (map) => {
    const toolNamePair = map.items?.find((p) => p.key?.value === 'toolName')
    if (!toolNamePair || !ROLES.includes(toolNamePair.value?.value)) return
    const role = toolNamePair.value.value
    if (blocks.has(role)) throw new Error(`duplicate role block: ${role}`)
    const tfPair = map.items?.find((p) => p.key?.value === 'toolFilter')
    const allowPair = tfPair?.value?.items?.find((p) => p.key?.value === 'allow')
    const seq = allowPair?.value
    if (!seq?.range || !Array.isArray(seq.items)) {
      throw new Error(`role ${role}: toolFilter.allow list not found`)
    }
    const [seqStart, end] = seq.range
    // seqStart points at the first item's `-`; the item line's leading
    // whitespace lies before the range, so extend the replacement span back
    // to the line start (otherwise the preserved indent would double).
    const start = srcText.lastIndexOf('\n', seqStart - 1) + 1
    if (srcText.slice(start, seqStart).trim() !== '' || srcText.slice(seqStart, seqStart + 1) !== '-') {
      throw new Error(`role ${role}: unexpected allow-list layout`)
    }
    blocks.set(role, {
      start,
      end,
      itemIndent: leadingIndent(srcText, seqStart),
      names: seq.items.map((item) => String(item?.value ?? '')),
    })
  })
  return blocks
}

export function walkMaps(node, visit) {
  if (!node) return
  if (node.constructor?.name === 'YAMLSeq') {
    for (const item of node.items ?? []) walkMaps(item, visit)
  } else if (node.constructor?.name === 'YAMLMap') {
    visit(node)
    for (const pair of node.items ?? []) walkMaps(pair.value, visit)
  }
}

/** Number of leading spaces/tabs of the line containing `offset`. */
export function leadingIndent(text, offset) {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1
  const match = text.slice(lineStart, offset).match(/^[ \t]*/)
  return match ? match[0].length : 0
}

export const ALLOW_BLOCK_RE = /toolFilter:\n([ \t]+)allow:\n((?:[ \t]+)- [^\n]*\n)+/g

export function locateAllowBlocksRegex(srcText) {
  const blocks = new Map()
  for (const role of ROLES) {
    const marker = `toolName: ${role}`
    const roleIdx = srcText.indexOf(marker)
    if (roleIdx === -1) throw new Error(`role ${role}: "${marker}" not found`)
    const nextIdx = srcText.indexOf('toolName: ', roleIdx + marker.length)
    const segment = nextIdx === -1 ? srcText.slice(roleIdx) : srcText.slice(roleIdx, nextIdx)
    ALLOW_BLOCK_RE.lastIndex = 0
    const matches = [...segment.matchAll(ALLOW_BLOCK_RE)]
    if (matches.length !== 1) {
      throw new Error(`role ${role}: expected exactly 1 toolFilter.allow block, found ${matches.length}`)
    }
    const match = matches[0]
    const allowLineEnd = match[0].indexOf('allow:\n') + 'allow:\n'.length
    const itemsStart = roleIdx + match.index + allowLineEnd
    const itemsEnd = roleIdx + match.index + match[0].length
    const itemText = srcText.slice(itemsStart, itemsEnd)
    blocks.set(role, {
      start: itemsStart,
      end: itemsEnd,
      // itemsStart points at the first space of the first item line, so the
      // indent is the leading whitespace of itemText itself (leadingIndent
      // would measure the line before it).
      itemIndent: (itemText.match(/^[ \t]*/) ?? [''])[0].length,
      names: itemText
        .split('\n')
        .filter((l) => l.trim() !== '')
        .map((l) => l.replace(/^[ \t]*- /, '').trim()),
    })
  }
  return blocks
}

// ── generation extensions (persona, custom roles, restrict injection) ───────

/**
 * Locate each role's persona block scalar span in the source
 * agent.cordis.yml.  Returns Map role -> { start, end, indent, text } where
 * [start, end) covers the whole block scalar including its `|-` marker.
 */
export function locatePersonaBlocks(srcText, yamlMod) {
  const blocks = new Map()
  if (yamlMod) {
    try {
      const doc = yamlMod.parseDocument(srcText)
      walkMaps(doc.contents, (map) => {
        const toolNamePair = map.items?.find((p) => p.key?.value === 'toolName')
        if (!toolNamePair || !ROLES.includes(toolNamePair.value?.value)) return
        const role = toolNamePair.value.value
        const personaPair = map.items?.find((p) => p.key?.value === 'persona')
        const node = personaPair?.value
        if (!node?.range) throw new Error(`role ${role}: persona block not found`)
        const [start, end] = node.range
        const inner = srcText.slice(start, end)
        const markerEnd = inner.indexOf('\n')
        let indent = 0
        if (markerEnd !== -1) {
          const contentLineStart = start + markerEnd + 1
          const contentLineEnd = srcText.indexOf('\n', contentLineStart)
          const contentLine = srcText.slice(
            contentLineStart,
            contentLineEnd === -1 ? srcText.length : contentLineEnd,
          )
          indent = (contentLine.match(/^[ \t]*/) ?? [''])[0].length
        }
        blocks.set(role, { start, end, indent, text: inner })
      })
      for (const role of ROLES) if (!blocks.has(role)) throw new Error(`role ${role}: persona block not found`)
      return blocks
    } catch (yamlErr) {
      warn(`source persona location via yaml failed (${yamlErr.message}) — falling back to regex`)
    }
  }
  for (const role of ROLES) {
    const marker = `toolName: ${role}`
    const roleIdx = srcText.indexOf(marker)
    if (roleIdx === -1) throw new Error(`role ${role}: "${marker}" not found`)
    const personaStart = srcText.indexOf('persona: |-', roleIdx)
    if (personaStart === -1) throw new Error(`role ${role}: persona block not found (regex)`)
    const dashStart = personaStart + 'persona: '.length // points at the `|` of `|-`
    const contentStart = dashStart + '|-'.length + 1
    const firstLineEnd = srcText.indexOf('\n', contentStart)
    const firstLine = srcText.slice(contentStart, firstLineEnd === -1 ? srcText.length : firstLineEnd)
    const indent = (firstLine.match(/^[ \t]*/) ?? [''])[0].length
    // Block ends at the first non-blank line indented shallower than the
    // content (the next map key, e.g. toolFilter).
    let cursor = contentStart
    let end = contentStart
    while (cursor < srcText.length) {
      const lineEnd = srcText.indexOf('\n', cursor)
      const line = srcText.slice(cursor, lineEnd === -1 ? srcText.length : lineEnd)
      if (line.trim() !== '' && (line.match(/^[ \t]*/) ?? [''])[0].length < indent) break
      end = lineEnd === -1 ? srcText.length : lineEnd + 1
      cursor = end
    }
    blocks.set(role, {
      start: dashStart,
      end,
      indent,
      text: srcText.slice(dashStart, end),
    })
  }
  return blocks
}
