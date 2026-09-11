/**
 * 生成期合成与改写：restrict.mjs 主 agent allow 基础提取（extractMainAgentAllow）、
 * persona 渲染 / 尾部追加（renderPersona / personaDefaultText / withSkillGuidance /
 * appendToMainPersona）、角色显示名身份句替换（roleIdentitySubject /
 * replaceRoleIdentity，roles.<toolName>.name 生效路径）、自定义角色委派块
 * （renderCustomRoleBlocks / firstLine / insertCustomRoles）、roles_remove 委派行
 * span 删除（delegationRowSpan / composeMainPersonaEdit）、角色专用模型注入
 * （injectRoleAgentOptions，roles.<toolName>.model / .provider → 内置角色委派块
 * 的 agentOptions 子块）、restrict config.allow 注入（computeRestrictAllow /
 * injectRestrictAllow / filterHostTools）与整文 compose（composeGenerated）。
 * 依赖 util（ROLES / warn / DEFAULT_MAIN_AGENT_PERSONA_EXTRA）、config
 * （normalizeMainAgentName / normalizeModelRef / yamlScalar）与 host
 * （isHostDependent）；被 wizard / state 引用。
 */
import { DEFAULT_MAIN_AGENT_PERSONA_EXTRA, ROLES, warn } from './util.mjs'
import { normalizeMainAgentName, normalizeModelRef, yamlScalar } from './config.mjs'
import { isHostDependent } from './host.mjs'

// ── restrict.mjs main-agent allow base ──────────────────────────────────────

/**
 * Extract the MAIN_AGENT_ALLOW names from restrict.mjs source.  This is the
 * base list the generated orchestrator-restrict config.allow starts from
 * (the filter falls back to it when no config.allow is injected).
 */
export function extractMainAgentAllow(restrictSrc) {
  const match = restrictSrc.match(/const MAIN_AGENT_ALLOW = new Set\(\[([\s\S]*?)\]\)/)
  if (!match) throw new Error('MAIN_AGENT_ALLOW block not found in restrict.mjs')
  const names = [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
  if (names.length === 0) throw new Error('MAIN_AGENT_ALLOW block is empty in restrict.mjs')
  return names
}

/** Render a persona block scalar with a given content indent. */
export function renderPersona(text, indent) {
  const pad = ' '.repeat(indent)
  const body = String(text).split('\n').map((l) => (l === '' ? '' : `${pad}${l}`)).join('\n')
  return `|-\n${body}\n`
}

/** Append the skill guidance paragraph to a persona when assigned. */
export function withSkillGuidance(persona, role, skillsMap) {
  const assigned = Object.entries(skillsMap)
    .filter(([, roleList]) => roleList.includes(role))
    .map(([skill]) => skill)
    .sort()
  if (assigned.length === 0) return persona
  const tail = persona.endsWith('\n') ? persona.slice(0, -1) : persona
  return `${tail}\n\nAvailable skills: ${assigned.join(', ')}`
}

/**
 * 取 persona 文本首行身份句的整段匹配（"You are the <主语> agent"）。基于正则
 * 匹配首行：`^You are the .*? agent` 命中时返回整段匹配，其中主语段 = `You are
 * the ` 与 ` agent` 之间内容；`.` 不跨行，天然只作用于首行。不命中返回 null
 * （调用方应 warn 并跳过，不崩）。
 */
export function roleIdentitySubject(text) {
  const match = /^You are the .*? agent/.exec(String(text ?? ''))
  return match ? match[0] : null
}

/**
 * 角色 persona 首行身份句主语替换（roles.<toolName>.name 生效路径）：匹配到
 * "You are the <主语> agent" 时把主语换成 displayName —— 保持 `You are the `
 * 前缀、` agent` 后缀与该行其余文字、后续段落全部原样 —— 返回
 * { changed: true, text: <替换后全文> }；首行不匹配 `^You are the ` 时返回
 * { changed: false, text: <原文本> }。replace 用回调写法，显示名含 $ 等字符也
 * 不会被替换串语法误解。
 */
export function replaceRoleIdentity(text, displayName) {
  if (roleIdentitySubject(text) === null) return { changed: false, text }
  return {
    changed: true,
    text: String(text).replace(/^You are the .*? agent/, () => `You are the ${displayName} agent`),
  }
}

/**
 * Render the delegation block(s) for custom roles, matching the existing
 * delegation-* indentation (4-space list items).
 */
export function renderCustomRoleBlocks(roles, skillsMap) {
  const custom = Object.entries(roles).filter(([toolName]) => !ROLES.includes(toolName))
  if (custom.length === 0) return ''
  const chunks = []
  for (const [toolName, role] of custom) {
    const persona = withSkillGuidance(
      role.persona || `You are the ${toolName} agent. Handle tasks delegated to this role.`,
      toolName,
      skillsMap,
    )
    // 角色专用模型（roles.<toolName>.model / .provider）：自定义角色与内置角色
    // 同形状（provider: spawn / toolName / agentOptions? / persona / toolFilter）。
    // 先归一再判 provider-alone（防 UI / 手工构造的 assignments 绕过规范化）；
    // 仅 model 非 null 才插 agentOptions 子块，provider-alone 仅 warn 忽略。
    const model = normalizeModelRef(role.model ?? null, `roles.${toolName}.model`)
    let provider = normalizeModelRef(role.provider ?? null, `roles.${toolName}.provider`)
    if (model === null && provider !== null) {
      warn(`roles.${toolName}.provider: '${provider}' 仅在同时配置 model 时生效，已忽略`)
      provider = null
    }
    // agentOptions 子行（键序固定 provider 在前、model 在后，与 dsh-tool-subagent
    // Config 字段序一致）；model 缺省时整块不出现。
    const agentOptionsLines = []
    if (model !== null) {
      agentOptionsLines.push('        agentOptions:')
      if (provider !== null) agentOptionsLines.push(`          provider: ${yamlScalar(provider)}`)
      agentOptionsLines.push(`          model: ${yamlScalar(model)}`)
    }
    chunks.push(
      [
        `    # ${toolName}：自定义角色（${firstLine(role.persona || '')}）`,
        `    - id: delegation-${toolName}`,
        `      name: '@deepseek-ai/dsh-tool-subagent'`,
        '      config:',
        '        provider: spawn',
        `        toolName: ${toolName}`,
        ...agentOptionsLines,
        '        persona: |-',
        ...persona.split('\n').map((l) => `          ${l}`),
        '        toolFilter:',
        '          allow:',
        ...(role.tools ?? []).map((t) => `            - ${t}`),
      ].join('\n'),
    )
  }
  return chunks.join('\n') + '\n'
}

export function firstLine(text) {
  const s = String(text ?? '').split('\n')[0].trim()
  return s === '' ? '自定义角色' : s
}

/**
 * Compute the orchestrator-restrict config.allow: restrict.mjs base, minus
 * host-dependent names not detected, plus main-agent extra tools and custom
 * role toolNames, minus main_agent_remove entries and removed builtin role
 * toolNames (roles_remove).  Returns null when the result equals the base (no
 * injection needed) — but only when no builtin role was removed: once
 * roles_remove is non-empty the explicit allow MUST be injected, otherwise the
 * static restrict.mjs MAIN_AGENT_ALLOW would keep delegating to the deleted
 * role (删除不生效).
 */
export function computeRestrictAllow(base, inventory, mainAgentExtra, mainAgentRemove, customToolNames, removedRoleNames = []) {
  const kept = []
  for (const name of base) {
    if (!isHostDependent(name) || inventory.has(name)) kept.push(name)
  }
  for (const name of mainAgentExtra) {
    if (!kept.includes(name) && (!isHostDependent(name) || inventory.has(name))) kept.push(name)
  }
  for (const name of customToolNames) {
    if (!kept.includes(name)) kept.push(name)
  }
  const removed = new Set([...(mainAgentRemove ?? []), ...(removedRoleNames ?? [])])
  const final = kept.filter((name) => !removed.has(name))
  const sameAsBase =
    (removedRoleNames ?? []).length === 0 && final.length === base.length && final.every((n, i) => n === base[i])
  return sameAsBase ? null : final
}

/** Insert config.allow into the orchestrator-restrict row (after `name:`). */
export function injectRestrictAllow(srcText, allowList) {
  const marker = `- id: orchestrator-restrict\n  name: ./restrict.mjs`
  const idx = srcText.indexOf(marker)
  if (idx === -1) throw new Error('orchestrator-restrict row not found')
  const insertAt = idx + marker.length
  const block = `\n  config:\n    allow:\n${allowList.map((n) => `      - ${n}`).join('\n')}`
  return srcText.slice(0, insertAt) + block + srcText.slice(insertAt)
}

/**
 * Append text to the main-agent persona (`- id: persona` row) block scalar,
 * used to inline the selected skills' full SKILL.md bodies (composeGenerated,
 * the main-agent skills step) and to append the user-editable persona tail
 * (main_agent_persona_extra).  Locates the block structurally (same scan as
 * locatePersonaBlocks' regex branch): marker row → `text: |-` → first content
 * line sets the indent (6 in the source preset) → block ends at the first
 * non-empty line indented shallower than the content.  Replaces the span
 * [dashStart, end) with the original content + suffixText re-rendered as a
 * block scalar.
 */
export function appendToMainPersona(srcText, suffixText) {
  const marker = `- id: persona\n  name: '@deepseek-ai/dsh-persona'`
  const idx = srcText.indexOf(marker)
  if (idx === -1) throw new Error('main agent persona block (`- id: persona` / @deepseek-ai/dsh-persona) not found')
  const personaStart = srcText.indexOf('text: |-', idx)
  if (personaStart === -1) throw new Error('main agent persona block: `text: |-` scalar not found')
  const dashStart = personaStart + 'text: '.length // points at the `|` of `|-`
  const contentStart = dashStart + '|-'.length + 1
  const firstLineEnd = srcText.indexOf('\n', contentStart)
  const firstLine = srcText.slice(contentStart, firstLineEnd === -1 ? srcText.length : firstLineEnd)
  const indent = (firstLine.match(/^[ \t]*/) ?? [''])[0].length
  let cursor = contentStart
  let end = contentStart
  while (cursor < srcText.length) {
    const lineEnd = srcText.indexOf('\n', cursor)
    const line = srcText.slice(cursor, lineEnd === -1 ? srcText.length : lineEnd)
    if (line.trim() !== '' && (line.match(/^[ \t]*/) ?? [''])[0].length < indent) break
    end = lineEnd === -1 ? srcText.length : lineEnd + 1
    cursor = end
  }
  if (end === contentStart) throw new Error('main agent persona block: no content lines found')
  const text = personaDefaultText(srcText.slice(dashStart, end))
  return srcText.slice(0, dashStart) + renderPersona(text + suffixText, indent) + srcText.slice(end)
}

/** Insert custom role blocks right before the "remaining model-facing rows" comment. */
export function insertCustomRoles(srcText, customBlock) {
  const marker = '# ── remaining model-facing rows'
  const idx = srcText.indexOf(marker)
  if (idx === -1) throw new Error('remaining model-facing rows marker not found')
  return srcText.slice(0, idx) + customBlock + srcText.slice(idx)
}

/**
 * 定位某内置角色委派行（`    - id: delegation-<rowId>`，rowId = 角色名中 `_` 换成
 * `-`，如 search_external → delegation-search-external）在源文本中的整条 span
 * [start, end)（roles_remove 删除用）：
 *  - start：item 行首向上吸收紧邻的注释行（连续 `#` 行，遇空行/非注释即停）；
 *  - end：到「下一条 delegation- 行紧邻其上的注释行首」（下一条块完整保留，二者之间
 *    的分隔空行并入删除，保留下一条块前恰一个空行）；无下一条（最后一个内置角色）时
 *    到 '# ── remaining model-facing rows' 注释前的空行（该注释保留）。
 * 返回原坐标；调用方与 allow/persona edits 一起按 start 降序应用。
 */
export function delegationRowSpan(srcText, role) {
  const rowId = role.replace(/_/g, '-') // 委派行 id 用连字符（toolName 用下划线）
  const marker = `- id: delegation-${rowId}`
  const idx = srcText.indexOf(marker)
  if (idx === -1) throw new Error(`委派行缺失（roles_remove 引用了 '${role}'，但源文本里找不到 "${marker}"）`)
  const itemStart = srcText.lastIndexOf('\n', idx - 1) + 1
  let start = itemStart
  for (;;) {
    if (start === 0) break
    const prevStart = srcText.lastIndexOf('\n', start - 2) + 1
    const prevLine = srcText.slice(prevStart, start - 1)
    if (prevLine.trim().startsWith('#')) start = prevStart
    else break
  }
  const nextMarker = '\n    - id: delegation-'
  const nextIdx = srcText.indexOf(nextMarker, idx + marker.length)
  let end
  if (nextIdx !== -1) {
    // 下一条委派行：end 停在其紧邻上方注释行的行首（该注释属于下一条块，保留）
    end = nextIdx + 1
    for (;;) {
      if (end === 0) break
      const prevStart = srcText.lastIndexOf('\n', end - 2) + 1
      const prevLine = srcText.slice(prevStart, end - 1)
      if (prevLine.trim().startsWith('#')) end = prevStart
      else break
    }
  } else {
    // 无下一条：删除到 '# ── remaining model-facing rows' 注释前的空行行首（注释保留）
    const tailMarker = '# ── remaining model-facing rows'
    const tailIdx = srcText.indexOf(tailMarker)
    if (tailIdx === -1) {
      end = srcText.length
    } else {
      const tailStart = srcText.lastIndexOf('\n', tailIdx - 1) + 1
      const prevStart = srcText.lastIndexOf('\n', tailStart - 2) + 1
      const above = tailStart === 0 ? '' : srcText.slice(prevStart, tailStart - 1)
      end = above.trim() === '' && tailStart > 0 ? prevStart : tailStart
    }
  }
  return { start, end }
}

/**
 * 角色专用模型注入（roles.<toolName>.model / .provider 生效路径）：在 role（内置
 * 角色名，下划线）的既有委派块内、`toolName:` 行行尾插入 agentOptions 子块，返回
 * 零宽 span edit { start, end, text }（start = end = toolName 行行尾换行符下标；
 * 原换行符保留在 text 之后，故 text 不带尾换行）。子块键序固定 provider 在前、
 * model 在后（与 dsh-tool-subagent Config 字段序一致），provider 缺省时不出该行。
 * 块定位：`- id: delegation-<rowId>`（rowId = 角色名 `_` 换 `-`，找不到 throw）；
 * 块结束 = min(其后首个 `\n    - id: delegation-` 下标, '# ── remaining
 * model-facing rows' 注释下标, srcText.length)，保证 toolName 搜索不越界命中
 * 别的块。返回坐标为源文本原坐标，与 allow/persona/删除 edits 一起按 start 降序
 * 应用。
 */
export function injectRoleAgentOptions(srcText, role, model, provider) {
  const rowId = role.replace(/_/g, '-') // 委派行 id 用连字符（toolName 用下划线）
  const marker = `- id: delegation-${rowId}`
  const idx = srcText.indexOf(marker)
  if (idx === -1) throw new Error(`委派行缺失（roles.${role}.model 引用了 '${role}'，但源文本里找不到 "${marker}"）`)
  const nextIdx = srcText.indexOf('\n    - id: delegation-', idx + marker.length)
  const tailIdx = srcText.indexOf('# ── remaining model-facing rows')
  // 块结束取三者最小（无下一条/无尾注释时以 srcText.length 兜底）。
  const blockEnd = Math.min(
    nextIdx === -1 ? srcText.length : nextIdx,
    tailIdx === -1 ? srcText.length : tailIdx,
    srcText.length,
  )
  const toolNameMarker = '\n        toolName: ' // 8 空格缩进 = config 键层
  const toolNameIdx = srcText.indexOf(toolNameMarker, idx)
  if (toolNameIdx === -1 || toolNameIdx >= blockEnd) {
    throw new Error(`委派块缺 toolName 行（roles.${role}.model："${marker}" 块内找不到 8 空格缩进的 "toolName: " 行）`)
  }
  // 插入点 = toolName 行行尾换行符的下标；零宽插入后该换行符仍在 text 之后。
  const lineEnd = srcText.indexOf('\n', toolNameIdx + 1)
  const text =
    '\n' +
    [
      '        agentOptions:',
      ...(provider !== null && provider !== undefined ? [`          provider: ${yamlScalar(provider)}`] : []),
      `          model: ${yamlScalar(model)}`,
    ].join('\n')
  return { start: lineEnd, end: lineEnd, text }
}

/**
 * 主 persona 整块改造（改名 + 删委派 bullet），返回一个 span edit
 * { start, end, text }（start/end 为源文本原坐标、随其它 edits 降序应用），
 * 无任何改动时返回 null（产物零 diff）。结构扫描与 appendToMainPersona 相同：
 * `- id: persona` 行 → `text: |-` → 首内容行定缩进 → 浅缩进行收尾。
 *  - 改名：main_agent_name 非空时，把身份行 label 换成它（正则不中则 warn 不崩）；
 *  - 删 bullet：对每个 removedRoles 角色，删掉 content 中 trimmed 匹配
 *    `^- .*delegate to <role>\.?$` 的行（限定行首 `- `，不误删 SOP 段落）。
 * 返回值经 renderPersona 以块标量整体回填；技能行/extra 追加在 edits 应用后由
 * appendToMainPersona 基于已改造文本追加，顺序天然正确。
 */
export function composeMainPersonaEdit(srcText, mainAgentName, removedRoles) {
  if (!mainAgentName && removedRoles.length === 0) return null
  const marker = `- id: persona\n  name: '@deepseek-ai/dsh-persona'`
  const idx = srcText.indexOf(marker)
  if (idx === -1) throw new Error('main agent persona block (`- id: persona` / @deepseek-ai/dsh-persona) not found')
  const personaStart = srcText.indexOf('text: |-', idx)
  if (personaStart === -1) throw new Error('main agent persona block: `text: |-` scalar not found')
  const dashStart = personaStart + 'text: '.length // points at the `|` of `|-`
  const contentStart = dashStart + '|-'.length + 1
  const firstLineEnd = srcText.indexOf('\n', contentStart)
  const firstLine = srcText.slice(contentStart, firstLineEnd === -1 ? srcText.length : firstLineEnd)
  const indent = (firstLine.match(/^[ \t]*/) ?? [''])[0].length
  let cursor = contentStart
  let end = contentStart
  while (cursor < srcText.length) {
    const lineEnd = srcText.indexOf('\n', cursor)
    const line = srcText.slice(cursor, lineEnd === -1 ? srcText.length : lineEnd)
    if (line.trim() !== '' && (line.match(/^[ \t]*/) ?? [''])[0].length < indent) break
    end = lineEnd === -1 ? srcText.length : lineEnd + 1
    cursor = end
  }
  if (end === contentStart) throw new Error('main agent persona block: no content lines found')
  let body = personaDefaultText(srcText.slice(dashStart, end))
  if (mainAgentName) {
    // 身份行 label 替换：仅匹配行首的 "You are the … agent powered by the {{model}} model."
    const identityRe = /^You are the [^\n]*?agent powered by the \{\{model\}\} model\./
    const match = body.match(identityRe)
    if (!match) {
      warn('main_agent_name: 主 persona 身份行未匹配，agent.cordis.yml 保留默认身份行')
    } else {
      const renamed = `You are the ${mainAgentName} agent powered by the {{model}} model.`
      body = body.slice(0, match.index) + renamed + body.slice(match.index + match[0].length)
    }
  }
  if (removedRoles.length > 0) {
    // 删委派 bullet：行首 `- ` 且含 `delegate to <role>`；SOP 段落等不命中。
    const dropRe = removedRoles.map((role) => new RegExp(`^- .*delegate to ${role}\\.?$`))
    const lines = body.split('\n')
    body = lines
      .filter((line) => !dropRe.some((re) => re.test(line.trim())))
      .join('\n')
  }
  return { start: dashStart, end, text: renderPersona(body, indent) }
}

/** Keep only host-dependent names that were actually detected. */
export function filterHostTools(tools, inventory) {
  return tools.filter((name) => !isHostDependent(name) || inventory.has(name))
}

/**
 * Compose the generated agent.cordis.yml from the final assignments.
 * Returns the new text (with allow/persona replacements and any custom-role
 * block / restrict config.allow injection) plus the per-role diff info for
 * the report.
 */
export function composeGenerated(srcText, blocks, personaBlocks, assignments, inventory, restrictBase, mainAgentSkillMetas = {}) {
  const skillsMap = assignments.skills ?? {}
  const customToolNames = Object.keys(assignments.roles).filter((n) => !ROLES.includes(n))
  // roles_remove：被删除的内置角色不产 allow/persona edits（委派行整条删除时避免重叠），
  // 主 persona bullet 与 restrict allow 也据此裁剪。main_agent_name 两处共用归一化值。
  const removedRoles = ROLES.filter((role) => (assignments.roles_remove ?? []).includes(role))
  const mainAgentName = normalizeMainAgentName(assignments.main_agent_name)

  // Role allow results (default roles only; custom roles are rendered fresh).
  const roleResults = []
  for (const role of ROLES) {
    if (removedRoles.includes(role)) continue // 已删除角色：不产 roleResults / allow edits
    const intent = assignments.roles[role]?.tools ?? blocks.get(role).names
    const filtered = filterHostTools(intent, inventory)
    if (filtered.length === 0) {
      throw new Error(`role "${role}" would end up with an empty toolFilter.allow — refusing to install a zero-tool role.`)
    }
    roleResults.push({ role, intent, kept: filtered, removed: intent.filter((n) => !filtered.includes(n)) })
  }

  // Collect all edits (applied back-to-front so offsets stay valid).
  const edits = []
  for (const rr of roleResults) {
    const block = blocks.get(rr.role)
    edits.push({
      start: block.start,
      end: block.end,
      text: rr.kept.map((name) => `${' '.repeat(block.itemIndent)}- ${name}\n`).join(''),
    })
  }
  // Persona replacements: only when the final persona differs from the source
  // default (config persona set, display name applied, or skill guidance
  // assigned).  roles.<toolName>.name（内置角色可选显示名）只在该角色 persona 走
  // 默认时生效：把默认 persona 首行身份句主语换成显示名；persona 已被用户自定义
  // 时不生效（warn 一次提示写进自定义 persona）。toolName / restrict allow / 主
  // persona delegate bullet / skills 分配键一律不受影响（不产对应 edit）。
  for (const role of ROLES) {
    if (removedRoles.includes(role)) continue // 已删除角色：persona 随委派行整条删除
    const configured = assignments.roles[role]?.persona ?? null
    const displayNameRaw = assignments.roles[role]?.name ?? null
    // 空串/null 视为无；字符串取 trim 值（与 config 端 normalizeRoleName 同语义，
    // 防 UI / 手工构造的 assignments 绕过规范化）。
    const displayName =
      typeof displayNameRaw === 'string' && displayNameRaw.trim() !== '' ? displayNameRaw.trim() : null
    const block = personaBlocks.get(role)
    const hasSkills = Object.entries(skillsMap).some(([, roleList]) => roleList.includes(role))
    if (configured !== null) {
      // A: persona 已自定义 → 全文原样生效（仅叠加技能引导）；显示名不生效并 warn。
      if (displayName !== null) {
        warn(
          `roles.${role}.name: '${displayName}' 仅作用于默认 persona（该角色 persona 已自定义）——请直接把该名字写进自定义 persona 的首行`,
        )
      }
      edits.push({
        start: block.start,
        end: block.end,
        text: renderPersona(withSkillGuidance(configured, role, skillsMap), block.indent),
      })
    } else if (displayName !== null || hasSkills) {
      // B': 默认 persona 上叠加（可选）显示名主语替换 +（可选）技能引导；只在与
      // 源默认文本确有差异时才产 edit（显示名与默认主语相同 → 替换后文本不变 →
      // 不产 edit，产物与源逐字节一致）。首行不匹配身份句模式 → warn 并跳过。
      const defaultText = personaDefaultText(block.text)
      let finalPersona = defaultText
      if (displayName !== null) {
        const replaced = replaceRoleIdentity(finalPersona, displayName)
        if (!replaced.changed) {
          warn(
            `roles.${role}.name: '${displayName}' 未生效——该角色默认 persona 首行不是 "You are the <主语> agent" 形态（已跳过）`,
          )
        } else {
          finalPersona = replaced.text
        }
      }
      if (hasSkills) finalPersona = withSkillGuidance(finalPersona, role, skillsMap)
      if (finalPersona !== defaultText) {
        edits.push({ start: block.start, end: block.end, text: renderPersona(finalPersona, block.indent) })
      }
    }
  }
  // roles_remove：委派行整条删除（含其上方注释行与一个分隔空行，span 为原坐标，
  // 与 allow/persona edits 一起按 start 降序应用；被删角色不产 allow/persona edits，
  // 故区间不相交）。
  for (const role of removedRoles) {
    const span = delegationRowSpan(srcText, role)
    edits.push({ start: span.start, end: span.end, text: '' })
  }
  // 主 persona 改造（改名 + 删委派 bullet）：无任何改动时不产 edit（产物零 diff）。
  const personaEdit = composeMainPersonaEdit(srcText, mainAgentName, removedRoles)
  if (personaEdit !== null) edits.push(personaEdit)

  // 角色专用模型注入（roles.<toolName>.model / .provider → 委派块 agentOptions）：
  // 与 roles_remove 委派行删除 edits 同段收集。被删角色不注入（委派行已整条删除，
  // 模型配置 warn 忽略）；仅 model 非 null 才注入，provider-alone 仅 warn 忽略
  // （先 normalize 再判断，防手工构造的 assignments 绕过规范化）。
  for (const role of ROLES) {
    const rawModel = assignments.roles[role]?.model ?? null
    const rawProvider = assignments.roles[role]?.provider ?? null
    if (removedRoles.includes(role)) {
      const model = normalizeModelRef(rawModel, `roles.${role}.model`)
      const provider = normalizeModelRef(rawProvider, `roles.${role}.provider`)
      if (model !== null || provider !== null) {
        warn(`roles.${role}.model: 该角色已在 roles_remove 中删除，模型配置被忽略`)
      }
      continue
    }
    const model = normalizeModelRef(rawModel, `roles.${role}.model`)
    let provider = normalizeModelRef(rawProvider, `roles.${role}.provider`)
    if (model === null && provider !== null) {
      warn(`roles.${role}.provider: '${provider}' 仅在同时配置 model 时生效，已忽略`)
      provider = null
    }
    if (model !== null) edits.push(injectRoleAgentOptions(srcText, role, model, provider))
  }
  // 注入 edit（零宽，位于 toolName 行行尾）与该块的 allow edit / persona edit
  // 区间天然不相交：委派块内 toolName 行先于 persona / toolFilter 出现，插入点
  // 在其后 8+ 缩进区域的 allow/persona span 之前；按 start 降序应用无需额外处理。

  // Custom role blocks + restrict config.allow injection.
  let out = srcText
  edits.sort((a, b) => b.start - a.start)
  for (const edit of edits) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end)

  const customBlock = renderCustomRoleBlocks(assignments.roles, skillsMap)
  if (customBlock !== '') out = insertCustomRoles(out, customBlock)

  const mainAgentRemove = assignments.main_agent_remove ?? []
  // Warn about removals that are not part of the main agent's current allow
  // (undetected host tools, typos, names never present) and skip them.
  if (mainAgentRemove.length > 0) {
    const removable = new Set(
      [...restrictBase, ...(assignments.main_agent_extra ?? []), ...customToolNames].filter(
        (n) => !isHostDependent(n) || inventory.has(n),
      ),
    )
    for (const name of mainAgentRemove) {
      if (!removable.has(name)) warn(`main_agent_remove: '${name}' 不在主 agent 当前 allow（未检测或不存在），已跳过`)
    }
  }
  const restrictAllow = computeRestrictAllow(
    restrictBase,
    inventory,
    assignments.main_agent_extra ?? [],
    mainAgentRemove,
    customToolNames,
    assignments.roles_remove ?? [],
  )
  if (mainAgentRemove.length > 0 && restrictAllow !== null && restrictAllow.length === 0) {
    throw new Error('main_agent_remove 把主 agent 的工具清空了——至少保留一个工具（或清掉多余的移除项）')
  }
  if (restrictAllow !== null) out = injectRestrictAllow(out, restrictAllow)

  // Main-agent skills (dual mode, mirrors the roles' skill soft guidance):
  //   - main_agent_skills (soft): one compact "# skill: <name> — <description>"
  //     row + "Read full rules: <file>" per skill appended to the main-agent
  //     persona — the main agent loads the full SKILL.md on demand with read.
  //   - main_agent_skills_inline (hard, optional): those skills' full bodies
  //     are appended to the persona instead (fixed per-response cost; style
  //     skills like caveman that must apply unconditionally).  A skill listed
  //     here is not repeated as a soft row.
  const softNames = (assignments.main_agent_skills ?? []).filter((n) => typeof n === 'string' && n !== '')
  const hardNames = (assignments.main_agent_skills_inline ?? []).filter((n) => typeof n === 'string' && n !== '')
  const warned = new Set()
  for (const n of softNames) {
    if (mainAgentSkillMetas[n] || warned.has(n)) continue
    warn(`main_agent_skills: '${n}' SKILL.md 未找到（~/.dsh/skills、~/.agents/skills、项目 .dsh|.agents/skills），已跳过`)
    warned.add(n)
  }
  for (const n of hardNames) {
    if (mainAgentSkillMetas[n] || warned.has(n)) continue
    warn(`main_agent_skills_inline: '${n}' SKILL.md 未找到（~/.dsh/skills、~/.agents/skills、项目 .dsh|.agents/skills），已跳过`)
    warned.add(n)
  }
  const softPresent = softNames.filter((n) => mainAgentSkillMetas[n] && !hardNames.includes(n))
  const hardPresent = hardNames.filter((n) => mainAgentSkillMetas[n])
  if (softPresent.length > 0 || hardPresent.length > 0) {
    let suffix = ''
    if (softPresent.length > 0) {
      suffix +=
        '\n\n── Assigned skills (soft guidance: when a task matches, load the full rules with the read tool before acting, then follow them for the rest of the session) ──'
      for (const n of softPresent) {
        const meta = mainAgentSkillMetas[n]
        const head = meta.description !== '' ? `# skill: ${n} — ${meta.description}` : `# skill: ${n}`
        suffix += `\n\n${head}\nRead full rules: ${meta.file}`
      }
    }
    if (hardPresent.length > 0) {
      suffix += '\n\n── Assigned skills (full rules inlined below — active for every response) ──'
      for (const n of hardPresent) {
        const meta = mainAgentSkillMetas[n]
        const head = meta.description !== '' ? `# skill: ${n} — ${meta.description} (inlined)` : `# skill: ${n} (inlined)`
        suffix += `\n\n${head}\n\n${meta.body}`
      }
    }
    out = appendToMainPersona(out, suffix)
  }

  // main_agent_persona_extra（主 persona 尾部追加，用户可在配置 UI「人设追加」里编辑）：
  // null/缺省 → DEFAULT_MAIN_AGENT_PERSONA_EXTRA（默认 codegraph projectPath 规则）；
  // '' → 明确清空，不追加任何内容；其他字符串 → 用户覆盖。追加顺序保持
  // SRC 本体 → 技能行/内联（上方）→ extra。空值跳过追加（无内容可加）。
  const personaExtraRaw = assignments.main_agent_persona_extra
  const personaExtra = personaExtraRaw === null || personaExtraRaw === undefined
    ? DEFAULT_MAIN_AGENT_PERSONA_EXTRA
    : String(personaExtraRaw)
  if (personaExtra !== '') out = appendToMainPersona(out, '\n\n' + personaExtra)

  return { text: out, roleResults }
}

/** Strip the block-scalar markers/indent from a persona block's source text. */
export function personaDefaultText(blockText) {
  const lines = blockText.split('\n')
  lines.shift() // drop the `|-` marker line
  const indent = (lines[0]?.match(/^[ \t]*/) ?? [''])[0].length
  return lines
    .map((l) => (l.trim() === '' ? '' : l.slice(Math.min(indent, l.length))))
    .join('\n')
    .replace(/\n+$/, '')
}
