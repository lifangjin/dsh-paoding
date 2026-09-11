/**
 * dsh-paoding.config.yml 键规范化与读写：main_agent_name / roles.<toolName>.name /
 * roles.<toolName>.model / roles.<toolName>.provider（角色专用模型，生成层映射到
 * dsh-tool-subagent 的 agentOptions）/ roles_remove 解析（normalizeRoleName（兼容
 * 别名 normalizeMainAgentName）/ normalizeModelRef / parseRolesRemove / yamlScalar）、
 * 文件加载与规范化（loadConfig / normalizeConfig）、序列化与落盘（serializeConfig /
 * saveConfig）。
 * 依赖 util（ROLES / warn）与 yaml（preprocessPatchText / parseYamlSubset）；
 * 被 compose / wizard / state / cli 引用。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { ROLES, warn } from './util.mjs'
import { parseYamlSubset, preprocessPatchText } from './yaml.mjs'

// ── config keys: main_agent_name / roles.<toolName>.name / roles_remove ─────

/**
 * 校验并规范化一个显示名（配置键 main_agent_name 或 roles.<toolName>.name，
 * label 形参用于报错文案，缺省 'main_agent_name' 时行为与文案和原实现逐字
 * 一致）。null/undefined/非 string/空串 → null（= 维持默认，不改名）；否则存
 * trim 后值，trim 后 1-60 字符且原值不得含 \r \n（违规直接 throw —— 配置错了
 * 宁可报错，也不要静默失效）。
 * main_agent_name：persona 身份行与 preset.yml 的 name: 行两处共用同一个值；
 * roles.<toolName>.name：仅作用于该内置角色 persona 走默认时的首行身份句主语。
 */
export function normalizeRoleName(value, label = 'main_agent_name') {
  if (value === null || value === undefined || typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed === '') return null
  if (/[\r\n]/.test(value)) {
    throw new Error(`${label} 不得包含换行符（\\r / \\n）`)
  }
  if (trimmed.length > 60) {
    throw new Error(`${label} 过长（${trimmed.length} > 60 字符）`)
  }
  return trimmed
}

/** 兼容别名：主 agent 显示名校验（main_agent_name），行为与文案逐字不变。 */
export function normalizeMainAgentName(value) {
  return normalizeRoleName(value)
}

/**
 * 校验并规范化一个模型/路由引用（配置键 roles.<toolName>.model 或 .provider，
 * label 形参用于报错文案）。行为镜像 normalizeRoleName，仅长度上限不同（120）：
 * null/undefined/非 string/trim 后空串 → null（= 缺省，生成层不注入 agentOptions，
 * 子 agent 继承主 agent 当前模型）；否则存 trim 后值，trim 后 1-120 字符且原值
 * 不得含 \r \n（违规直接 throw —— 配置错了宁可报错，也不要静默失效）。
 * provider 只有与 model 同时配置才生效，该组合规则由生成层（compose）判定。
 */
export function normalizeModelRef(value, label = 'model') {
  if (value === null || value === undefined || typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed === '') return null
  if (/[\r\n]/.test(value)) {
    throw new Error(`${label} 不得包含换行符（\\r / \\n）`)
  }
  if (trimmed.length > 120) {
    throw new Error(`${label} 过长（${trimmed.length} > 120 字符）`)
  }
  return trimmed
}

/**
 * 解析配置键 roles_remove：string[]，只收 ROLES 内置角色名（search_external /
 * design / implement）；含其他名字 warn 并忽略；去重保序。非数组 → []。
 * 删除语义由生成层承担（委派行、主 persona 引用、restrict allow 三处）。
 */
export function parseRolesRemove(raw) {
  const out = []
  if (!Array.isArray(raw)) return out
  for (const entry of raw) {
    if (typeof entry !== 'string' || entry === '') {
      warn(`roles_remove: 忽略非字符串项（${JSON.stringify(entry)}）`)
      continue
    }
    if (!ROLES.includes(entry)) {
      warn(`roles_remove: '${entry}' 不是内置角色（可选: ${ROLES.join(', ')}），已忽略`)
      continue
    }
    if (!out.includes(entry)) out.push(entry)
  }
  return out
}

/** 简单 YAML 标量渲染：含空格/CJK 无需引号；含 ':' / '#'、首尾空白、纯数字等
 * 歧义形态时用单引号包裹并转义内部单引号。 */
export function yamlScalar(value) {
  const s = String(value)
  const needsQuote =
    s === '' ||
    /^[\s]|[\s]$/.test(s) || // 首/尾空白
    /:(\s|$)/.test(s) || // ':'（键值分隔风险）
    /(^|\s)#/.test(s) || // '#'（行内注释风险）
    /^[-+]?(\d+\.?\d*|\.\d+)$/.test(s) || // 纯数字形态
    /^(true|false|null|~)$/i.test(s) // bool/null 字面量形态
  return needsQuote ? `'${s.replace(/'/g, "''")}'` : s
}

// ── config file (dsh-paoding.config.yml) ────────────────────────────────────

/**
 * Load the config file when present.  Returns null when the file does not
 * exist; throws when it exists but cannot be parsed.  Shape:
 *   { profile, roles: { <toolName>: { name?, model?, provider?, persona?, tools[] } },
 *     roles_remove[] (内置角色删除), main_agent_extra[], main_agent_remove[],
 *     main_agent_skills[], main_agent_skills_inline[],
 *     main_agent_persona_extra? (string|null), main_agent_name? (string|null),
 *     skills: { <skill>: [<toolName>...] } }
 */
export function loadConfig(file, yamlMod) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return null
  }
  const processed = preprocessPatchText(text)
  let data = null
  if (yamlMod) {
    try {
      data = yamlMod.parse(processed)
    } catch (yamlErr) {
      warn(`${file}: yaml parse failed (${yamlErr.message}) — trying the built-in fallback parser`)
    }
  }
  if (data === null) {
    try {
      data = parseYamlSubset(processed)
    } catch (err) {
      throw new Error(`${file}: could not be parsed (${err.message})`)
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`${file}: expected a mapping at the top level`)
  }
  return normalizeConfig(data)
}

export function normalizeConfig(data) {
  const roles = {}
  const rawRoles = data.roles && typeof data.roles === 'object' && !Array.isArray(data.roles) ? data.roles : {}
  for (const [toolName, raw] of Object.entries(rawRoles)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const tools = Array.isArray(raw.tools) ? raw.tools.filter((t) => typeof t === 'string' && t !== '') : null
    // 角色条目字段顺序 { name?, model?, provider?, persona?, tools? }：name
    // （roles.<toolName>.name，内置角色可选显示名）与 main_agent_name 同约束，
    // 仅字符串收（trim 后空/违规由 normalizeRoleName 处理）；缺省/null → null
    // （= 保持该角色默认身份句）。model / provider（roles.<toolName>.model /
    // .provider，角色专用模型）镜像同款收法，违规由 normalizeModelRef 处理；
    // 缺省/null → null（= 不注入 agentOptions，子 agent 继承主 agent 当前模型）。
    roles[toolName] = {
      name: typeof raw.name === 'string' ? normalizeRoleName(raw.name, `roles.${toolName}.name`) : null,
      model: typeof raw.model === 'string' ? normalizeModelRef(raw.model, `roles.${toolName}.model`) : null,
      provider: typeof raw.provider === 'string' ? normalizeModelRef(raw.provider, `roles.${toolName}.provider`) : null,
      persona: typeof raw.persona === 'string' && raw.persona.trim() !== '' ? raw.persona : null,
      tools,
    }
  }
  const extra = Array.isArray(data.main_agent_extra)
    ? data.main_agent_extra.filter((t) => typeof t === 'string' && t !== '')
    : []
  const remove = Array.isArray(data.main_agent_remove)
    ? data.main_agent_remove.filter((t) => typeof t === 'string' && t !== '')
    : []
  const skills = {}
  if (data.skills && typeof data.skills === 'object' && !Array.isArray(data.skills)) {
    for (const [skill, roleList] of Object.entries(data.skills)) {
      if (Array.isArray(roleList)) skills[skill] = roleList.filter((r) => typeof r === 'string' && r !== '')
    }
  }
  const mainAgentSkills = Array.isArray(data.main_agent_skills)
    ? data.main_agent_skills.filter((s) => typeof s === 'string' && s !== '')
    : []
  const mainAgentSkillsInline = Array.isArray(data.main_agent_skills_inline)
    ? data.main_agent_skills_inline.filter((s) => typeof s === 'string' && s !== '')
    : []
  // 主 persona 尾部追加：string 原样收（含 '' = 明确清空，不追加）；非 string/缺省 → null
  // （compose 时回落 DEFAULT_MAIN_AGENT_PERSONA_EXTRA）。
  const mainPersonaExtra = typeof data.main_agent_persona_extra === 'string' ? data.main_agent_persona_extra : null
  // 内置角色删除（roles_remove）：只收 ROLES 内置名，其他 warn 忽略、去重。
  const rolesRemove = parseRolesRemove(data.roles_remove)
  // 主 agent 名称（main_agent_name）：typeof string 且 trim 后非空才收（存 trim 值）；
  // 否则 null（= 维持默认）。长度/换行违规由 normalizeMainAgentName throw。
  const mainAgentName = typeof data.main_agent_name === 'string' ? normalizeMainAgentName(data.main_agent_name) : null
  return {
    profile: typeof data.profile === 'string' && data.profile !== '' ? data.profile : null,
    roles,
    roles_remove: rolesRemove,
    main_agent_extra: extra,
    // 内部标记：键 main_agent_extra 是否在文件里显式存在（含显式空列表）。
    // resolveAssignments 据此区分「显式 [] = 尊重空」与「键缺失 = 老配置，回填
    // 智能默认」——serializeConfig 对显式空数组落盘 `main_agent_extra: []`，
    // 该语义才能在 读写 往返中存活。
    has_main_agent_extra: Array.isArray(data.main_agent_extra),
    main_agent_remove: remove,
    main_agent_skills: mainAgentSkills,
    main_agent_skills_inline: mainAgentSkillsInline,
    main_agent_persona_extra: mainPersonaExtra,
    main_agent_name: mainAgentName,
    skills,
  }
}

/** Serialize the config back to YAML (fixed structure, hand-rolled writer). */
export function serializeConfig(config) {
  const lines = ['# dsh-paoding（庖丁）安装配置 —— ./install.sh 交互向导生成；可手编；改后重跑 ./install.sh --auto 应用']
  lines.push(`profile: ${config.profile ?? 'web'}`)
  // main_agent_name：仅非 null 写出（null/缺省 = 维持默认名，不改名）。
  if (config.main_agent_name !== null && config.main_agent_name !== undefined) {
    const name = normalizeMainAgentName(config.main_agent_name)
    if (name !== null) lines.push(`main_agent_name: ${yamlScalar(name)}`)
  }
  lines.push('roles:')
  for (const [toolName, role] of Object.entries(config.roles)) {
    lines.push(`  ${toolName}:`)
    // roles.<toolName>.name：仅非 null 写出（null/缺省 = 保持该角色默认身份句）；
    // 写在该角色 persona / tools 之前，缩进 4。
    if (role.name !== null && role.name !== undefined) {
      const name = normalizeRoleName(role.name, `roles.${toolName}.name`)
      if (name !== null) lines.push(`    name: ${yamlScalar(name)}`)
    }
    // roles.<toolName>.model / .provider：仅非 null 写出（null/缺省 = 不注入
    // agentOptions，子 agent 继承主 agent 当前模型）；写前过一次 normalizeModelRef
    // （与上方 name 写法一致，防手工构造的 config 绕过规范化），字段序 name →
    // model → provider → persona → tools 固定。
    if (role.model !== null && role.model !== undefined) {
      const model = normalizeModelRef(role.model, `roles.${toolName}.model`)
      if (model !== null) lines.push(`    model: ${yamlScalar(model)}`)
    }
    if (role.provider !== null && role.provider !== undefined) {
      const provider = normalizeModelRef(role.provider, `roles.${toolName}.provider`)
      if (provider !== null) lines.push(`    provider: ${yamlScalar(provider)}`)
    }
    if (role.persona !== null && role.persona !== undefined) {
      lines.push('    persona: |-')
      for (const line of String(role.persona).split('\n')) lines.push(`      ${line}`)
    }
    if (role.tools !== null && role.tools !== undefined) {
      lines.push('    tools:')
      for (const tool of role.tools) lines.push(`      - ${tool}`)
    }
  }
  if (config.roles_remove && config.roles_remove.length > 0) {
    lines.push('roles_remove:')
    for (const role of config.roles_remove) lines.push(`  - ${role}`)
  }
  // main_agent_extra：「数组存在即写」——length>0 走多行块；显式空数组写
  // `main_agent_extra: []`。显式空必须落盘成键：否则下次加载时键缺失，
  // resolveAssignments 会把空列表当老配置用智能默认回填，用户「明确不要 host
  // 工具」的意愿就丢了。非数组（缺省）仍整键省略。
  if (Array.isArray(config.main_agent_extra)) {
    if (config.main_agent_extra.length > 0) {
      lines.push('main_agent_extra:')
      for (const tool of config.main_agent_extra) lines.push(`  - ${tool}`)
    } else {
      lines.push('main_agent_extra: []')
    }
  }
  if (config.main_agent_remove && config.main_agent_remove.length > 0) {
    lines.push('main_agent_remove:')
    for (const tool of config.main_agent_remove) lines.push(`  - ${tool}`)
  }
  if (config.main_agent_skills && config.main_agent_skills.length > 0) {
    lines.push('main_agent_skills:')
    for (const skill of config.main_agent_skills) lines.push(`  - ${skill}`)
  }
  if (config.main_agent_skills_inline && config.main_agent_skills_inline.length > 0) {
    lines.push('main_agent_skills_inline:')
    for (const skill of config.main_agent_skills_inline) lines.push(`  - ${skill}`)
  }
  // main_agent_persona_extra：只在非 null 时写出 —— '' 也写（= 明确清空，不追加任何
  // 内容），区别于缺省（= compose 回落默认常量）。
  if (config.main_agent_persona_extra !== null && config.main_agent_persona_extra !== undefined) {
    const value = String(config.main_agent_persona_extra)
    if (value === '') {
      lines.push("main_agent_persona_extra: ''")
    } else {
      lines.push('main_agent_persona_extra: |-')
      for (const line of value.split('\n')) lines.push(`  ${line}`)
    }
  }
  if (Object.keys(config.skills).length > 0) {
    lines.push('skills:')
    for (const [skill, roleList] of Object.entries(config.skills)) {
      lines.push(`  ${skill}: [${roleList.join(', ')}]`)
    }
  }
  return lines.join('\n') + '\n'
}

export function saveConfig(file, config) {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, serializeConfig(config), { mode: 0o600 })
}
