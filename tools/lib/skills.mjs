/**
 * 技能发现与 SKILL.md 元数据解析：detectSkills 扫描四类根目录（$DSH_HOME/
 * $DSH_AGENTS_HOME/项目 .dsh|.agents skills），findSkillMeta 定位并读取一个
 * SKILL.md、解析 frontmatter description（skillDescriptionOf /
 * stripSkillDescription）。依赖 node:fs / node:os / node:path；被 state 引用。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

// ── skill detection ─────────────────────────────────────────────────────────

/**
 * Discover installed skills from the same roots dsh-skill-filesystem scans:
 * user roots ($DSH_HOME/skills, $DSH_AGENTS_HOME/skills or ~/.agents/skills)
 * plus project roots (<cwd>/.dsh/skills, <cwd>/.agents/skills).  A skill is a
 * directory or a .md file; its name is the basename.  Roots that do not exist
 * are skipped.
 */
export function detectSkills(dshHome, cwd) {
  const agentsHome = process.env.DSH_AGENTS_HOME || path.join(homedir(), '.agents')
  const roots = [
    path.join(dshHome, 'skills'),
    path.join(agentsHome, 'skills'),
    path.join(cwd, '.dsh', 'skills'),
    path.join(cwd, '.agents', 'skills'),
  ]
  const skills = new Set()
  for (const root of roots) {
    let entries
    try {
      entries = readdirSync(root, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.')) continue
        skills.add(entry.name)
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        skills.add(entry.name.slice(0, -'.md'.length))
      }
    }
  }
  return [...skills].sort()
}

/**
 * Locate and read one skill's SKILL.md for the main-agent persona, shared by
 * both load channels (main_agent_skills / main_agent_skills_inline): the
 * default soft mode writes a compact skill row (name + description + absolute
 * SKILL.md path) into the persona and the main agent reads the full rules on
 * demand with its own read tool (zero directory injection); the optional hard
 * inline mode inlines the full body instead.  Uses the same four roots as
 * detectSkills; within each root a directory skill (<root>/<name>/SKILL.md)
 * wins over a bare <root>/<name>.md file.  Strips the leading YAML
 * frontmatter when present, then trims.  `description` is parsed from the
 * frontmatter (single-line, quoted, folded `>` or literal `|` block — block
 * values join the indented continuation lines up to the next key line or the
 * end of the frontmatter, then collapse whitespace, strip surrounding quotes
 * and cap at 200 chars; empty string when absent).  Returns
 * { name, description, file, body } with `file` the absolute SKILL.md path,
 * or null when not found / empty body.
 */
export function findSkillMeta(name, dshHome, cwd) {
  const agentsHome = process.env.DSH_AGENTS_HOME || path.join(homedir(), '.agents')
  const roots = [
    path.join(dshHome, 'skills'),
    path.join(agentsHome, 'skills'),
    path.join(cwd, '.dsh', 'skills'),
    path.join(cwd, '.agents', 'skills'),
  ]
  const fmRe = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/
  for (const root of roots) {
    for (const candidate of [path.join(root, name, 'SKILL.md'), path.join(root, `${name}.md`)]) {
      let text
      try {
        text = readFileSync(candidate, 'utf8')
      } catch {
        continue
      }
      const body = text.replace(fmRe, '').trim()
      if (body === '') return null
      const fm = text.match(fmRe)
      return { name, description: fm ? skillDescriptionOf(fm[1]) : '', file: candidate, body }
    }
  }
  return null
}

/**
 * Parse one skill frontmatter's `description:` value.  Handles plain
 * single-line, single/double-quoted, and folded (`>`) / literal (`|`) block
 * scalars (marker on the key line or on its own next line): block content is
 * the following indented lines up to the first key line at or above the
 * description key's indent (or the frontmatter end), whitespace-collapsed.
 * Returns '' when the key is absent or empty.
 */
export function skillDescriptionOf(frontmatter) {
  const lines = frontmatter.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const key = lines[i].match(/^(\s*)description:\s*(.*)$/)
    if (!key) continue
    const indent = key[1].length
    let value = key[2]
    let contentFrom = i + 1
    if (value !== '') {
      if (!/^[>|][+-]?\d*$/.test(value)) return stripSkillDescription(value)
      // block marker on the key line: content starts on the next line
    } else if (lines[i + 1] && /^\s*[>|][+-]?\d*\s*$/.test(lines[i + 1])) {
      contentFrom = i + 2 // marker on its own line
    } else {
      return '' // empty value, no block scalar
    }
    let stop = lines.length
    let minIndent = Infinity
    for (let j = contentFrom; j < lines.length; j++) {
      const line = lines[j]
      if (line.trim() === '') continue
      const lineIndent = (line.match(/^[ \t]*/) ?? [''])[0].length
      if (lineIndent <= indent) {
        stop = j
        break
      }
      if (lineIndent < minIndent) minIndent = lineIndent
    }
    if (minIndent === Infinity) return ''
    const parts = []
    for (let j = contentFrom; j < stop; j++) {
      const line = lines[j]
      parts.push(line.trim() === '' ? '' : line.slice(Math.min(minIndent, line.length)))
    }
    return stripSkillDescription(parts.join(' '))
  }
  return ''
}

/** Collapse whitespace, strip one pair of surrounding quotes, cap at 200 chars. */
export function stripSkillDescription(raw) {
  let value = raw.trim()
  const quoted = value.match(/^(['"])([\s\S]*)\1$/)
  if (quoted) value = quoted[2]
  value = value.replace(/\s+/g, ' ').trim()
  if (value.length > 200) value = value.slice(0, 200)
  return value
}
