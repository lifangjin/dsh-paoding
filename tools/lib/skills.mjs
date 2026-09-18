/**
 * 技能发现与 SKILL.md 元数据解析：detectSkills / findSkillMeta 共用同一组根
 * 目录——用户级两根（$DSH_HOME/skills、$DSH_AGENTS_HOME|~/.agents/skills）
 * 恒扫；项目级两根（<cwd>/.dsh/skills、<cwd>/.agents/skills）仅在 cwd 显式
 * 传入具体工作区目录时追加，cwd 为 null/undefined/空串即「全局语义」，只扫
 * 用户级（技能扫描不跟随 GUI 进程启动目录，项目根按工作区按需传入）。
 * findSkillMeta 定位并读取一个 SKILL.md、解析 frontmatter description
 * （skillDescriptionOf / stripSkillDescription）。依赖 node:fs / node:os /
 * node:path；被 state 引用。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

// ── skill detection ─────────────────────────────────────────────────────────

/**
 * Discover installed skills from the same roots dsh-skill-filesystem scans:
 * user roots ($DSH_HOME/skills, $DSH_AGENTS_HOME/skills or ~/.agents/skills)
 * always, plus the project roots (<cwd>/.dsh/skills, <cwd>/.agents/skills)
 * only when `cwd` is a non-empty string — null / undefined / '' means the
 * global view (user roots only; scanning never follows the GUI process start
 * directory, project roots are per-workspace opt-in).  A skill is a
 * directory or a .md file; its name is the basename.  Roots that do not exist
 * are skipped.
 */
export function detectSkills(dshHome, cwd = null) {
  const agentsHome = process.env.DSH_AGENTS_HOME || path.join(homedir(), '.agents')
  // 用户级两根恒扫；cwd 非空（显式传入工作区目录）才追加项目级两根。
  const roots = [
    path.join(dshHome, 'skills'),
    path.join(agentsHome, 'skills'),
  ]
  if (cwd) roots.push(path.join(cwd, '.dsh', 'skills'), path.join(cwd, '.agents', 'skills'))
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
      } else if (entry.isFile() && entry.name.endsWith('.md') && !entry.name.startsWith('.')) {
        // 文件分支同样跳过点开头名：.foo.md 不是技能（编辑器/系统临时文件常是
        // 点前缀），与目录分支口径一致。
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
 * inline mode inlines the full body instead.  Uses the same roots as
 * detectSkills (user roots always; project roots only for a non-empty `cwd`,
 * i.e. the target workspace); within each root a directory skill
 * (<root>/<name>/SKILL.md)
 * wins over a bare <root>/<name>.md file.  Strips the leading YAML
 * frontmatter when present, then trims.  `description` is parsed from the
 * frontmatter (single-line, quoted, folded `>` or literal `|` block — block
 * values join the indented continuation lines up to the next key line or the
 * end of the frontmatter, then collapse whitespace, strip surrounding quotes
 * and cap at 200 chars; empty string when absent).  Returns
 * { name, description, file, body } with `file` the absolute SKILL.md path,
 * or null when not found / empty body.
 */
export function findSkillMeta(name, dshHome, cwd = null) {
  const agentsHome = process.env.DSH_AGENTS_HOME || path.join(homedir(), '.agents')
  // 与 detectSkills 同款：用户级两根恒扫；cwd 非空（目标工作区目录）才追加
  // 项目级两根——全局目标只解析用户级技能，工作区目标可解析该项目根里的技能。
  const roots = [
    path.join(dshHome, 'skills'),
    path.join(agentsHome, 'skills'),
  ]
  if (cwd) roots.push(path.join(cwd, '.dsh', 'skills'), path.join(cwd, '.agents', 'skills'))
  const fmRe = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/
  for (const root of roots) {
    for (const candidate of [path.join(root, name, 'SKILL.md'), path.join(root, `${name}.md`)]) {
      let text
      try {
        text = readFileSync(candidate, 'utf8')
      } catch {
        continue
      }
      // 先剥 UTF-8 BOM（Windows 编辑器常见）：否则 ^--- 锚点失配，frontmatter
      // 整体解析失效（description 丢失、正文残留 frontmatter）。
      if (text.startsWith('\uFEFF')) text = text.slice(1)
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
 * 零缩进键优先：嵌套映射里的同名键（子对象的 description）不再抢在顶层
 * frontmatter 键之前命中；没有零缩进键时回退到首个任意缩进的同名键（原行为）。
 * Returns '' when the key is absent or empty.
 */
export function skillDescriptionOf(frontmatter) {
  const lines = frontmatter.split(/\r?\n/)
  // 第一遍：只认零缩进 description 键（顶层 frontmatter 键）。
  for (let i = 0; i < lines.length; i++) {
    const key = lines[i].match(/^description:\s*(.*)$/)
    if (key) return descriptionValueAt(lines, i, key[1], 0)
  }
  // 第二遍回退：首个任意缩进的同名键（原行为）。
  for (let i = 0; i < lines.length; i++) {
    const key = lines[i].match(/^(\s*)description:\s*(.*)$/)
    if (key) return descriptionValueAt(lines, i, key[2], key[1].length)
  }
  return ''
}

/** 从 lines[i] 的 description 键解析其值（value 为键行冒号后的原文，indent 为
 * 键缩进；块标量正文取自后续行）。语义与抽出的原实现逐字一致。 */
function descriptionValueAt(lines, i, rawValue, indent) {
  let value = rawValue
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

/** Collapse whitespace, strip one pair of surrounding quotes, cap at 200 chars. */
export function stripSkillDescription(raw) {
  let value = raw.trim()
  const quoted = value.match(/^(['"])([\s\S]*)\1$/)
  if (quoted) value = quoted[2]
  value = value.replace(/\s+/g, ' ').trim()
  if (value.length > 200) value = value.slice(0, 200)
  return value
}
