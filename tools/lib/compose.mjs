/**
 * 生成期合成与改写：restrict.mjs 主 agent allow 基础提取（extractMainAgentAllow）、
 * persona 渲染 / 尾部追加（renderPersona / personaDefaultText / withSkillGuidance /
 * appendToMainPersona）、角色显示名身份句替换（roleIdentitySubject /
 * replaceRoleIdentity，roles.<toolName>.name 生效路径）、自定义角色委派块
 * （renderCustomRoleBlocks / firstLine / insertCustomRoles）、roles_remove 委派行
 * span 删除（delegationRowSpan / composeMainPersonaEdit）、角色专用模型注入
 * （injectRoleAgentOptions，roles.<toolName>.model / .provider → 内置角色委派块
 * 的 agentOptions 子块）、角色可续模式改写/兜底注入（injectRoleBackgroundMode，
 * roles.<toolName>.background_mode = 'continuable' → 内置角色委派块的
 * backgroundMode 行：源模板已预置该行时原位改写其值，块内无该行时在 toolName
 * 行行尾兜底注入；'one-shot' 不动源行 —— 源模板四块各预置
 * `backgroundMode: one-shot`（可见性），全默认产物与源零 diff）、
 * restrict config.allow 注入（computeRestrictAllow /
 * injectRestrictAllow / filterUsableTools）与整文 compose（composeGenerated）。
 * allow 过滤走白名单语义（usableWith / presetUniverse ∪ inventory，见
 * filterUsableTools 上方说明）：手写进配置、既不在 preset 自带工具面也不在
 * 检测库存的名字一律从 allow 丢弃，不再「非 host 依赖名直通」。
 * 自定义角色另有三道防护/自动化：toolName 保留名校验（assertCustomToolName，
 * 内置角色 / restrictBase / subagent* / mcp__ 前缀 / YAML 字面量一律 throw）；
 * tools 为空时拒绝安装零工具角色（renderCustomRoleBlocks 直接 throw，防
 * `toolFilter.allow:` 空白名单）；并把角色 persona 首行职责句自动追加为主
 * agent persona 委派行（composeMainPersonaEdit 第 4 参 customBullets →
 * `- <职责>: delegate to <toolName>.`），否则主 agent 永远不会委派给自定义角色。
 * 依赖 util（ROLES / warn / DEFAULT_MAIN_AGENT_PERSONA_EXTRA）、config
 * （normalizeModelRef / yamlScalar）与 host
 * （isHostDependent）；被 state 引用。
 */
import { DEFAULT_MAIN_AGENT_PERSONA_EXTRA, ROLES, warn } from './util.mjs'
import { normalizeModelRef, yamlScalar } from './config.mjs'
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
  // 先按行剥 // 注释再提取引号串：注释里的撇号（如 don't）会被当成工具名的
  // 引号对，产生幽灵工具名（allow 段常带中英文注释）。
  const body = match[1]
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n')
  const names = [...body.matchAll(/'([^']+)'/g)].map((m) => m[1])
  if (names.length === 0) throw new Error('MAIN_AGENT_ALLOW block is empty in restrict.mjs')
  return names
}

// ── shared helpers ──────────────────────────────────────────────────────────

/** 名字可用性判定（allow 过滤多处共用，白名单语义）：名字必须落在 preset 自带
 * 工具面（presetUniverse = restrict.mjs 主 agent 白名单 ∪ 源 preset 各角色 allow）
 * 或检测清单 inventory 之中，两者都不在 → 不可用（插件停用后的 mnemon_*、手写
 * 错名等不再「非 host 依赖名直通」，与文档「配置意图 ∩ 实际启用工具」口径对齐）；
 * host 依赖名（mcp__* / 已知插件工具）即便在 presetUniverse 里也必须真的被检测
 * 到才保留。 */
function usableWith(name, presetUniverse, inventory) {
  if (inventory.has(name)) return true
  return !isHostDependent(name) && presetUniverse.has(name)
}

/** 角色专用模型归一（自定义块渲染与内置角色注入两处共用）：model / provider 过
 * normalizeModelRef；仅 model 非 null 才有效，provider-alone warn 后置 null。 */
function normalizeRoleModel(toolName, rawModel, rawProvider) {
  const model = normalizeModelRef(rawModel, `roles.${toolName}.model`)
  let provider = normalizeModelRef(rawProvider, `roles.${toolName}.provider`)
  if (model === null && provider !== null) {
    warn(`roles.${toolName}.provider: '${provider}' 仅在同时配置 model 时生效，已忽略`)
    provider = null
  }
  return { model, provider }
}

/**
 * 自定义角色 toolName 保留名校验：与内置角色（ROLES）、restrict.mjs 主 agent
 * allow 白名单（restrictBase）、顶层 subagent / subagent_fork 撞名的 toolName
 * 会静默遮蔽既有工具面；mcp__ 前缀闯 host MCP 工具名空间；true/false/null 等
 * YAML 字面量会让生成的 `toolName: <名>` 行解析成布尔/null —— 一律在生成期
 * throw（错误信息带角色名），宁可拒绝安装也不静默产出坏 preset。
 */
export function assertCustomToolName(toolName, restrictBase = []) {
  const reserved = new Set([...ROLES, ...restrictBase, 'subagent', 'subagent_fork'])
  if (reserved.has(toolName)) {
    throw new Error(`role "${toolName}": toolName 与保留名冲突（内置角色 / restrict 主 agent 白名单 / subagent*），请换一个名字`)
  }
  if (String(toolName).startsWith('mcp__')) {
    throw new Error(`role "${toolName}": toolName 不得使用 mcp__ 前缀（与 host MCP 工具名空间冲突）`)
  }
  if (/^(true|false|null|~)$/i.test(toolName)) {
    throw new Error(`role "${toolName}": toolName 是 YAML 字面量，生成的委派行会被解析成布尔/null，请换一个名字`)
  }
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
export function renderCustomRoleBlocks(roles, skillsMap, restrictBase = []) {
  const custom = Object.entries(roles).filter(([toolName]) => !ROLES.includes(toolName))
  if (custom.length === 0) return ''
  const chunks = []
  for (const [toolName, role] of custom) {
    // 保留名校验（见 assertCustomToolName）+ 零工具防护（与 composeGenerated
    // 内置角色循环同款）：tools 为空（缺省或 `tools:` 空列表）会生成
    // `toolFilter.allow:`（YAML null），子 agent 创建后零工具——宁可拒绝安装，
    // 也不静默生成一个干不了活的角色。
    assertCustomToolName(toolName, restrictBase)
    if ((role.tools ?? []).length === 0) {
      throw new Error(`role "${toolName}" would end up with an empty toolFilter.allow — refusing to install a zero-tool role.`)
    }
    const persona = withSkillGuidance(
      role.persona || `You are the ${toolName} agent. Handle tasks delegated to this role.`,
      toolName,
      skillsMap,
    )
    // 角色专用模型与可续模式（roles.<toolName>.model / .provider / .background_mode）：
    // 自定义角色与内置角色同形状（provider: spawn / toolName / agentOptions? /
    // backgroundMode / persona / toolFilter）。先归一再判 provider-alone（防 UI /
    // 手工构造的 assignments 绕过规范化）；仅 model 非 null 才插 agentOptions 子块，
    // provider-alone 仅 warn 忽略。backgroundMode 行恒写（与内置块源模板预置口径
    // 一致：行始终可见），continuable → continuable，one-shot/缺省/异常值 →
    // one-shot（与 config 解析回落口径一致）。
    const { model, provider } = normalizeRoleModel(toolName, role.model ?? null, role.provider ?? null)
    // agentOptions 子行（键序固定 provider 在前、model 在后，与 dsh-tool-subagent
    // Config 字段序一致）；model 缺省时整块不出现。
    const agentOptionsLines = []
    if (model !== null) {
      agentOptionsLines.push('        agentOptions:')
      if (provider !== null) agentOptionsLines.push(`          provider: ${yamlScalar(provider)}`)
      agentOptionsLines.push(`          model: ${yamlScalar(model)}`)
    }
    // backgroundMode 行恒写（键序固定在 agentOptions? 之后、persona 之前，与内置
    // 角色委派块的预置/注入落点键序一致）；非 continuable 一律落 one-shot。
    const backgroundModeLines = [`        backgroundMode: ${role.background_mode === 'continuable' ? 'continuable' : 'one-shot'}`]
    chunks.push(
      [
        `    # ${toolName}：自定义角色（${firstLine(role.persona || '')}）`,
        `    - id: delegation-${toolName}`,
        `      name: '@deepseek-ai/dsh-tool-subagent'`,
        '      config:',
        '        provider: spawn',
        // toolName / 工具条目过 yamlScalar：纯数字、YAML 字面量形态等歧义名
        // 必须带引号落盘，否则委派行会被解析成数字/布尔/null。
        `        toolName: ${yamlScalar(toolName)}`,
        ...agentOptionsLines,
        ...backgroundModeLines,
        '        persona: |-',
        ...persona.split('\n').map((l) => `          ${l}`),
        '        toolFilter:',
        '          allow:',
        ...(role.tools ?? []).map((t) => `            - ${yamlScalar(t)}`),
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
 * names outside the preset universe and detection inventory, plus main-agent
 * extra tools and custom role toolNames, minus main_agent_remove entries and
 * removed builtin role toolNames (roles_remove).  Returns null when the result
 * equals the base (no injection needed) — but only when no builtin role was
 * removed: once roles_remove is non-empty the explicit allow MUST be injected,
 * otherwise the static restrict.mjs MAIN_AGENT_ALLOW would keep delegating to
 * the deleted role (删除不生效).
 */
export function computeRestrictAllow(base, presetUniverse, inventory, mainAgentExtra, mainAgentRemove, customToolNames, removedRoleNames = []) {
  const kept = []
  for (const name of base) {
    if (usableWith(name, presetUniverse, inventory)) kept.push(name)
  }
  for (const name of mainAgentExtra) {
    if (!kept.includes(name) && usableWith(name, presetUniverse, inventory)) kept.push(name)
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
 * locatePersonaBlocks' regex branch): marker row → `prefix: |-` (legacy
 * `text: |-`) → first content
 * line sets the indent (6 in the source preset) → block ends at the first
 * non-empty line indented shallower than the content.  Replaces the span
 * [dashStart, end) with the original content + suffixText re-rendered as a
 * block scalar.
 */
export function appendToMainPersona(srcText, suffixText) {
  const marker = `- id: persona\n  name: '@deepseek-ai/dsh-persona'`
  const idx = srcText.indexOf(marker)
  if (idx === -1) throw new Error('main agent persona block (`- id: persona` / @deepseek-ai/dsh-persona) not found')
  // Persona config scalar: `prefix: |-` per the current dsh-persona schema
  // (required `prefix`); `text: |-` is the legacy pre-rename name, still
  // located so old files compose unchanged.
  const prefixStart = srcText.indexOf('prefix: |-', idx)
  const textStart = prefixStart === -1 ? srcText.indexOf('text: |-', idx) : -1
  if (prefixStart === -1 && textStart === -1) {
    throw new Error('main agent persona block: `prefix: |-` (or legacy `text: |-`) scalar not found')
  }
  const keyStart = prefixStart !== -1 ? prefixStart : textStart
  const keyLen = prefixStart !== -1 ? 'prefix: '.length : 'text: '.length
  const dashStart = keyStart + keyLen // points at the `|` of `|-`
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
  // 自定义块与 marker 注释之间补一个空行，与全文「块间空行分隔」的风格一致
  // （customBlock 自带行尾换行；marker 前原有的空行留在 customBlock 之前）。
  return srcText.slice(0, idx) + customBlock + '\n' + srcText.slice(idx)
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
 * 内置角色委派块边界定位（roleToolNameLineEnd / injectRoleBackgroundMode 共用）：
 * 块定位 `- id: delegation-<rowId>`（rowId = 角色名 `_` 换 `-`，找不到 throw）；
 * 块结束 = min(其后首个 `\n    - id: delegation-` 下标, '# ── remaining
 * model-facing rows' 注释下标, srcText.length)，保证块内行搜索不越界命中
 * 别的块。errorKey 用于把报错归因到具体配置键（model / background_mode）。
 */
function roleDelegationBlockBounds(srcText, role, errorKey) {
  const rowId = role.replace(/_/g, '-') // 委派行 id 用连字符（toolName 用下划线）
  const marker = `- id: delegation-${rowId}`
  const idx = srcText.indexOf(marker)
  if (idx === -1) throw new Error(`委派行缺失（roles.${role}.${errorKey} 引用了 '${role}'，但源文本里找不到 "${marker}"）`)
  const nextIdx = srcText.indexOf('\n    - id: delegation-', idx + marker.length)
  const tailIdx = srcText.indexOf('# ── remaining model-facing rows')
  // 块结束取三者最小（无下一条/无尾注释时以 srcText.length 兜底）。
  const blockEnd = Math.min(
    nextIdx === -1 ? srcText.length : nextIdx,
    tailIdx === -1 ? srcText.length : tailIdx,
    srcText.length,
  )
  return { idx, blockEnd }
}

/**
 * 定位内置角色委派块内 8 空格缩进的 `toolName:` 行行尾换行符下标
 * （injectRoleAgentOptions / injectRoleBackgroundMode 兜底注入共用的插入点）：
 * 块边界见 roleDelegationBlockBounds，toolName 搜索限定块内不越界命中别的块。
 * errorKey 用于把报错归因到具体配置键（model / background_mode）。
 */
function roleToolNameLineEnd(srcText, role, errorKey) {
  const { idx, blockEnd } = roleDelegationBlockBounds(srcText, role, errorKey)
  const toolNameMarker = '\n        toolName: ' // 8 空格缩进 = config 键层
  const toolNameIdx = srcText.indexOf(toolNameMarker, idx)
  if (toolNameIdx === -1 || toolNameIdx >= blockEnd) {
    throw new Error(`委派块缺 toolName 行（roles.${role}.${errorKey}："${marker}" 块内找不到 8 空格缩进的 "toolName: " 行）`)
  }
  // 插入点 = toolName 行行尾换行符的下标；零宽插入后该换行符仍在 text 之后。
  const lineEnd = srcText.indexOf('\n', toolNameIdx + 1)
  if (lineEnd === -1) {
    // 与其余 marker 缺失同款哨兵：不静默错位（-1 会把注入行插到文首）。
    throw new Error(`委派块 toolName 行缺换行符（roles.${role}.${errorKey}："${marker}" 块的 toolName 行是最后一行且无换行，无法定位插入点）`)
  }
  return lineEnd
}

/**
 * 角色专用模型注入（roles.<toolName>.model / .provider 生效路径）：在 role（内置
 * 角色名，下划线）的既有委派块内、`toolName:` 行行尾插入 agentOptions 子块，返回
 * 零宽 span edit { start, end, text }（start = end = toolName 行行尾换行符下标；
 * 原换行符保留在 text 之后，故 text 不带尾换行）。子块键序固定 provider 在前、
 * model 在后（与 dsh-tool-subagent Config 字段序一致），provider 缺省时不出该行。
 * 返回坐标为源文本原坐标，与 allow/persona/删除 edits 一起按 start 降序应用。
 */
export function injectRoleAgentOptions(srcText, role, model, provider) {
  const lineEnd = roleToolNameLineEnd(srcText, role, 'model')
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
 * 角色可续模式改写/兜底注入（roles.<toolName>.background_mode = 'continuable'
 * 生效路径）。源模板的四个内置角色委派块各预置一行 `backgroundMode: one-shot`
 * （产品口径：旋钮在源里可见，值 = dsh-tool-subagent 缺省），本函数语义因此是
 * 「改写或兜底注入」，块内 span 查找既有行，杜绝任何情况下同块出现两行
 * backgroundMode：
 *  - 块内已有该行（源模板预置 / 手工加过）：整行原位改写为规范的
 *    `backgroundMode: continuable`（位置不动 → 键序 toolName → agentOptions? →
 *    backgroundMode 天然成立）；该行值已是 continuable 时返回 null（无改动，
 *    与其它「无差异不产 edit」口径一致）。
 *  - 块内无该行（防手工删掉的老配置/异常源）：兜底在 `toolName:` 行行尾零宽
 *    注入一行（与 injectRoleAgentOptions 同锚点，两者并存靠收集序定键序 ——
 *    edits 按 start 降序稳定排序，同 start 保持收集序，composeGenerated 先收集
 *    本 edit 再收集 agentOptions edit，先收集者居后）。
 * 返回 span edit { start, end, text }（坐标为源文本原坐标，与 allow/persona/
 * 删除 edits 一起按 start 降序应用；改写路径 start/end = 既有行行首/行尾，
 * 兜底路径 start = end = toolName 行行尾换行符下标），无任何改动时返回 null。
 * 调用方（composeGenerated）仅对 'continuable' 调本函数；'one-shot'/缺省不调
 * 用 —— 源预置行原样保留，全默认配置的生成产物与源逐字节一致。手工构造的
 * assignments 绕过规范化时按同口径兜底（非 continuable 即不调用）。
 */
export function injectRoleBackgroundMode(srcText, role) {
  const { idx, blockEnd } = roleDelegationBlockBounds(srcText, role, 'background_mode')
  // 块内 span 查既有行：8 空格缩进（config 键层，与 roleToolNameLineEnd 的
  // toolName 定位同口径），行首带 \n 保证不误匹配块首部分行或 persona 内容行。
  const bgMarker = '\n        backgroundMode:'
  const bgIdx = srcText.indexOf(bgMarker, idx)
  if (bgIdx !== -1 && bgIdx < blockEnd) {
    const lineStart = bgIdx + 1 // 跳过行首 \n，定位到行首
    const nextNl = srcText.indexOf('\n', lineStart)
    const lineEnd = nextNl === -1 ? srcText.length : nextNl
    const line = srcText.slice(lineStart, lineEnd)
    const value = line.slice(line.indexOf(':') + 1).trim()
    if (value === 'continuable') return null // 已是目标值：不动（保持零 diff）
    // 整行原位改写（缩进一并规范成 8 空格），不新增行 → 不可能重复键。
    return { start: lineStart, end: lineEnd, text: '        backgroundMode: continuable' }
  }
  // 兜底：块内无该行（手工删掉的老配置 / 异常源）→ 沿用 toolName 行行尾注入。
  const lineEnd = roleToolNameLineEnd(srcText, role, 'background_mode')
  return { start: lineEnd, end: lineEnd, text: '\n        backgroundMode: continuable' }
}

/**
 * 主 persona 整块改造（删委派 bullet + 自定义角色自动委派行），返回一个
 * span edit { start, end, text }（start/end 为源文本原坐标、随其它 edits 降序应用），
 * 无任何改动时返回 null（产物零 diff）。结构扫描与 appendToMainPersona 相同：
 * `- id: persona` 行 → `prefix: |-`（旧名 `text: |-` 兼容）→ 首内容行定缩进 → 浅缩进行收尾。
 *  - 删 bullet：对每个 removedRoles 角色，删掉 content 中 trimmed 匹配
 *    `^- .*delegate to <role>\.?$` 的行（限定行首 `- `，不误删 SOP 段落）；
 *  - 自定义角色自动委派行：customBullets（第 3 参，元素 { toolName, duty }）逐个
 *    渲染成 `- <duty>: delegate to <toolName>.`（duty 去掉尾部 `。`/`.`/`！`/`!`
 *    与空白），插到 body 中最后一个匹配 `^- .*delegate to \S+\.?$` 的行之后；
 *    一条都没有时退到匹配 `^Decompose the task` 的行之后；仍没有则退到首行之后。
 *    其余文本与空行结构保持不变——没有这行指引，主 agent persona 就不含自定义
 *    角色，主 agent 永远不会委派给它。
 * 身份行（You are the …）不可改名：编排主 agent 的 persona 身份语义不属于
 * 可配置项（preset 显示名归 main_agent_display_name，见 state.mjs）。
 * 返回值经 renderPersona 以块标量整体回填；技能行/extra 追加在 edits 应用后由
 * appendToMainPersona 基于已改造文本追加，顺序天然正确。
 */
export function composeMainPersonaEdit(srcText, removedRoles, customBullets = []) {
  if (removedRoles.length === 0 && customBullets.length === 0) return null
  const marker = `- id: persona\n  name: '@deepseek-ai/dsh-persona'`
  const idx = srcText.indexOf(marker)
  if (idx === -1) throw new Error('main agent persona block (`- id: persona` / @deepseek-ai/dsh-persona) not found')
  // Persona config scalar: `prefix: |-` per the current dsh-persona schema
  // (required `prefix`); `text: |-` is the legacy pre-rename name, still
  // located so old files compose unchanged.
  const prefixStart = srcText.indexOf('prefix: |-', idx)
  const textStart = prefixStart === -1 ? srcText.indexOf('text: |-', idx) : -1
  if (prefixStart === -1 && textStart === -1) {
    throw new Error('main agent persona block: `prefix: |-` (or legacy `text: |-`) scalar not found')
  }
  const keyStart = prefixStart !== -1 ? prefixStart : textStart
  const keyLen = prefixStart !== -1 ? 'prefix: '.length : 'text: '.length
  const dashStart = keyStart + keyLen // points at the `|` of `|-`
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
  if (removedRoles.length > 0) {
    // 删委派 bullet：行首 `- ` 且含 `delegate to <role>`；SOP 段落等不命中。
    const dropRe = removedRoles.map((role) => new RegExp(`^- .*delegate to ${role}\\.?$`))
    const lines = body.split('\n')
    body = lines
      .filter((line) => !dropRe.some((re) => re.test(line.trim())))
      .join('\n')
  }
  if (customBullets.length > 0) {
    // 自定义角色自动委派行：duty 去尾部句读与空白后渲染成 `- <duty>: delegate to
    // <toolName>.`；插到最后一条既有委派行之后（与编排段落保持相邻），一条都没有
    // 则退到 Decompose the task 行之后、再退到首行之后。
    const lines = body.split('\n')
    const bullets = customBullets.map(({ toolName, duty }) => {
      const cleaned = String(duty ?? '').trim().replace(/[。.!！]+$/u, '').trim()
      return `- ${cleaned}: delegate to ${toolName}.`
    })
    let after = -1
    for (let i = lines.length - 1; i >= 0; i--) {
      if (/^- .*delegate to \S+\.?$/.test(lines[i].trim())) {
        after = i
        break
      }
    }
    if (after === -1) {
      const decIdx = lines.findIndex((l) => /^Decompose the task/.test(l.trim()))
      if (decIdx !== -1) after = decIdx
    }
    if (after === -1) after = 0 // 兜底：插到首行之后
    lines.splice(after + 1, 0, ...bullets)
    body = lines.join('\n')
  }
  return { start: dashStart, end, text: renderPersona(body, indent) }
}

/** Keep only names that fall inside the preset universe or the detection
 * inventory (see usableWith); everything else is dropped from the allow list. */
export function filterUsableTools(tools, presetUniverse, inventory) {
  return tools.filter((name) => usableWith(name, presetUniverse, inventory))
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
  // 主 persona bullet 与 restrict allow 也据此裁剪。persona 身份行不可改名
  // （preset 显示名归 main_agent_display_name，见 state.mjs）。
  const removedRoles = ROLES.filter((role) => (assignments.roles_remove ?? []).includes(role))

  // presetUniverse = restrict.mjs 主 agent 白名单 ∪ 源 preset 各角色 allow 自带面。
  // 生成期「名字可用」白名单的前半边（后半边是检测清单 inventory）：手写进配置、
  // 既不在 preset 自带面也不在检测库存的名字（停用插件残留的 mnemon_*、错名等）
  // 不再直通，一律从 allow 丢弃——与文档「配置意图 ∩ 实际启用工具」口径对齐。
  const presetUniverse = new Set(restrictBase)
  for (const block of blocks.values()) {
    for (const name of block.names) presetUniverse.add(name)
  }

  // Role allow results (default roles only; custom roles are rendered fresh).
  const roleResults = []
  for (const role of ROLES) {
    if (removedRoles.includes(role)) continue // 已删除角色：不产 roleResults / allow edits
    const intent = assignments.roles[role]?.tools ?? blocks.get(role).names
    const filtered = filterUsableTools(intent, presetUniverse, inventory)
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
    // 空串与 null 同语义（= 走默认 persona）：?? 口径会把 '' 当「已自定义」
    // 而生成空 persona 块，统一成 || 判定（与 renderCustomRoleBlocks 的
    // `persona ? ... : 默认` 口径一致）。
    const configured = assignments.roles[role]?.persona || null
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
  // 主 persona 改造（删委派 bullet + 自定义角色自动委派行）：无任何改动时
  // 不产 edit（产物零 diff）。自定义角色取 persona 首行职责句生成 delegate 行
  // （firstLine 对空 persona 返回占位「自定义角色」，中文占位可直接用）——没有这
  // 行指引，主 agent persona 就不含该角色，永远不会委派给它。
  const customBullets = customToolNames.map((n) => ({
    toolName: n,
    duty: firstLine(assignments.roles[n]?.persona || ''),
  }))
  const personaEdit = composeMainPersonaEdit(srcText, removedRoles, customBullets)
  if (personaEdit !== null) edits.push(personaEdit)

  // 角色专用模型 / 可续模式注入（roles.<toolName>.model / .provider → 委派块
  // agentOptions；roles.<toolName>.background_mode = 'continuable' → 委派块
  // backgroundMode 行改写/兜底注入）：与 roles_remove 委派行删除 edits 同段收集。
  // 被删角色不注入（委派行已整条删除，模型 / background_mode 配置 warn 忽略）；
  // 仅 model 非 null 才注入 agentOptions，provider-alone 仅 warn 忽略（先 normalize
  // 再判断，防手工构造的 assignments 绕过规范化）；background_mode 仅 'continuable'
  // 才调 injectRoleBackgroundMode（'one-shot'/缺省不调 —— 源模板四块各预置的
  // `backgroundMode: one-shot` 原样保留，全默认配置生成产物与源逐字节一致）。
  // 键序与收集序：源块已有该行时走改写路径（edit start = 既有行行首，位于
  // toolName 行行尾之后 → 降序应用先改写该行，agentOptions 随后插在更前的
  // toolName 行行尾，键序 toolName → agentOptions? → backgroundMode 自然成立）；
  // 源块无该行时走兜底注入路径，与 agentOptions 同锚点（start 相等）→ backgroundMode
  // edit 必须先于 agentOptions edit 收集（先收集者居后），与自定义块键序一致。
  for (const role of ROLES) {
    const rawModel = assignments.roles[role]?.model ?? null
    const rawProvider = assignments.roles[role]?.provider ?? null
    const rawBackgroundMode = assignments.roles[role]?.background_mode ?? null
    if (removedRoles.includes(role)) {
      const model = normalizeModelRef(rawModel, `roles.${role}.model`)
      const provider = normalizeModelRef(rawProvider, `roles.${role}.provider`)
      if (model !== null || provider !== null) {
        warn(`roles.${role}.model: 该角色已在 roles_remove 中删除，模型配置被忽略`)
      }
      if (rawBackgroundMode === 'continuable') {
        warn(`roles.${role}.background_mode: 该角色已在 roles_remove 中删除，background_mode 配置被忽略`)
      }
      continue
    }
    if (rawBackgroundMode === 'continuable') {
      const backgroundModeEdit = injectRoleBackgroundMode(srcText, role)
      if (backgroundModeEdit !== null) edits.push(backgroundModeEdit)
    }
    const { model, provider } = normalizeRoleModel(role, rawModel, rawProvider)
    if (model !== null) edits.push(injectRoleAgentOptions(srcText, role, model, provider))
  }
  // 注入 edit（零宽，位于 toolName 行行尾）与该块的 allow edit / persona edit
  // 区间天然不相交：委派块内 toolName 行先于 persona / toolFilter 出现，插入点
  // 在其后 8+ 缩进区域的 allow/persona span 之前；按 start 降序应用无需额外处理。

  // Custom role blocks + restrict config.allow injection.
  let out = srcText
  edits.sort((a, b) => b.start - a.start)
  for (const edit of edits) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end)

  const customBlock = renderCustomRoleBlocks(assignments.roles, skillsMap, restrictBase)
  if (customBlock !== '') out = insertCustomRoles(out, customBlock)

  const mainAgentRemove = assignments.main_agent_remove ?? []
  // Warn about removals that are not part of the main agent's current allow
  // (undetected host tools, typos, names never present) and skip them.
  if (mainAgentRemove.length > 0) {
    const removable = new Set(
      [...restrictBase, ...(assignments.main_agent_extra ?? []), ...customToolNames].filter((n) =>
        usableWith(n, presetUniverse, inventory),
      ),
    )
    for (const name of mainAgentRemove) {
      if (!removable.has(name)) warn(`main_agent_remove: '${name}' 不在主 agent 当前 allow（未检测或不存在），已跳过`)
    }
  }
  const restrictAllow = computeRestrictAllow(
    restrictBase,
    presetUniverse,
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
