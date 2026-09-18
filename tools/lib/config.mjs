/**
 * dsh-paoding.config.yml 键规范化与读写：main_agent_display_name /
 * roles.<toolName>.name /
 * roles.<toolName>.model / roles.<toolName>.provider（角色专用模型，生成层映射到
 * dsh-tool-subagent 的 agentOptions）/ roles.<toolName>.background_mode（可续模式，
 * 生成层映射到 dsh-tool-subagent 的 backgroundMode，'one-shot' | 'continuable'）/
 * roles_remove 解析（normalizeRoleName /
 * normalizeModelRef / normalizeBackgroundMode / parseRolesRemove / yamlScalar）、
 * 目标字段集合的规范化与写出（normalizeTargetFields / writeTargetFields —— 顶层与
 * workspaces.<path> 条目共用同一套）、按工作区条目段（normalizeWorkspaces）、
 * 文件加载与规范化（loadConfig / normalizeConfig）、序列化与落盘（serializeConfig /
 * saveConfig）。
 * 依赖 util（ROLES / warn）与 yaml（preprocessPatchText / parseYamlSubset）；
 * 被 compose / state / cli / alloc 引用。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { ROLES, warn } from './util.mjs'
import { parseYamlSubset, preprocessPatchText } from './yaml.mjs'

// ── config keys: main_agent_display_name / roles.<toolName>.name / roles_remove ─────

// main_agent_name 迁移提示的每进程去重标记：normalizeConfig 在一次进程里会被
// 调多次（collectState 与 generateAndInstall 各 loadConfig 一遍，测试里更多），
// 裸 warn 会同文案刷屏；标记置位后同一进程不再重复提醒。
let mainAgentNameMigrationWarned = false

/**
 * 校验并规范化一个显示名（配置键 main_agent_display_name 或
 * roles.<toolName>.name，label 形参用于报错文案；现存调用点都显式传 label，
 * 缺省 'name' 仅兜底）。null/undefined/非 string/空串 → null（= 维持默认，
 * 不改名）；否则存 trim 后值，trim 后 1-60 字符且原值不得含 \r \n（违规直接
 * throw —— 配置错了宁可报错，也不要静默失效）。
 * main_agent_display_name：仅 preset.yml 的 name: 行（显示名），不动 persona
 * 身份行，报错 label 用键名本身；
 * roles.<toolName>.name：仅作用于该内置角色 persona 走默认时的首行身份句主语。
 */
export function normalizeRoleName(value, label = 'name') {
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
 * 校验并规范化 roles.<toolName>.background_mode（角色可续模式，映射到
 * dsh-tool-subagent 实例配置键 backgroundMode）。合法值仅 'one-shot' | 'continuable'：
 * 缺省/null → 缺省值 'one-shot'（静默，与 name/model/provider 的 null 口径一致）；
 * 非字符串或字符串但不在合法值集 → warn 后回落 'one-shot'（类型/取值不对降级提醒
 * 而非中断加载，与 normalizeTargetFields 的 name/model/provider 非字符串 warn 同款）。
 * 返回恒为合法值之一，生成层（compose）据此决定是否注入 backgroundMode 行。
 */
export function normalizeBackgroundMode(value, label = 'background_mode') {
  if (value === null || value === undefined) return 'one-shot'
  if (typeof value !== 'string' || (value !== 'one-shot' && value !== 'continuable')) {
    warn(`${label}: 非法值已忽略（${JSON.stringify(value)}），回落 'one-shot'（可选: 'one-shot' / 'continuable'）`)
    return 'one-shot'
  }
  return value
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

/** 简单 YAML 标量渲染：含空格/CJK 无需引号；含 ':' / '#'、首/尾空白、纯数字、
 * bool/null 字面量、或首字符为 YAML 指示符（- ? : , [ ] { } # & * ! | > ' " %
 * @ `）等歧义形态时用单引号包裹并转义内部单引号。 */
export function yamlScalar(value) {
  const s = String(value)
  const needsQuote =
    s === '' ||
    /^[\s]|[\s]$/.test(s) || // 首/尾空白
    /:(\s|$)/.test(s) || // ':'（键值分隔风险）
    /(^|\s)#/.test(s) || // '#'（行内注释风险）
    /^[-+]?(\d+\.?\d*|\.\d+)$/.test(s) || // 纯数字形态
    /^(true|false|null|~)$/i.test(s) || // bool/null 字面量形态
    /^[-?:,\[\]{}#&*!|>'"%@`]/.test(s) // 首字符 YAML 指示符（块/流集合、锚点、别名、标签、引号、保留符）
  return needsQuote ? `'${s.replace(/'/g, "''")}'` : s
}

/** 流序列（`skills: [a, b]`）条目专用渲染：流上下文里 ',' '[' ']' '{' '}' 是
 * 定界符，裸形态含它们会把序列截断成坏 YAML（块上下文合法 ≠ 流内合法）。
 * yamlScalar 已加引号的原样返回（防双重包裹），裸形态补查流定界符。 */
function yamlFlowScalar(value) {
  const raw = String(value)
  const s = yamlScalar(raw)
  return s === raw && /[,\[\]{}]/.test(raw) ? `'${raw.replace(/'/g, "''")}'` : s
}

// ── config file (dsh-paoding.config.yml) ────────────────────────────────────

/**
 * Load the config file when present.  Returns null when the file does not
 * exist; throws when it exists but cannot be parsed.  Shape:
 *   { profile, roles: { <toolName>: { name?, model?, provider?, background_mode?, persona?, tools[] } },
 *     roles_remove[] (内置角色删除), main_agent_extra[], main_agent_remove[],
 *     main_agent_skills[], main_agent_skills_inline[],
 *     main_agent_persona_extra? (string|null),
 *     main_agent_display_name? (string|null),
 *     skills: { <skill>: [<toolName>...] },
 *     workspaces: { <工作区绝对路径>: <目标字段集合（同顶层、除 profile）> } }
 */
export function loadConfig(file, yamlMod) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (err) {
    // 仅「文件不存在」视为无配置（返回 null）；其余读错误（权限 / EIO / 是目录等）
    // 原样上抛 —— 静默吞掉会让调用方把损坏状态当「fresh」继续破坏性落盘。
    if (err.code === 'ENOENT') return null
    throw err
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
  // 迁移提示（每进程至多一次，见下方模块级标记）：老配置残留的 main_agent_name
  // 键已随「主 agent 改名」特性整体下线 —— 该键曾一改两处（preset 显示名 +
  // persona 身份行），改名会替换编排主 agent 的身份语义，故不再读取也不再返回；
  // 残留行在下次「保存并应用」落盘时自然消失。
  if (!mainAgentNameMigrationWarned && typeof data?.main_agent_name === 'string' && data.main_agent_name.trim() !== '') {
    mainAgentNameMigrationWarned = true
    warn('main_agent_name 已移除：编排主 agent 身份不再支持改名，该键已忽略')
  }
  return {
    profile: typeof data.profile === 'string' && data.profile !== '' ? data.profile : null,
    ...normalizeTargetFields(data),
    workspaces: normalizeWorkspaces(data.workspaces),
  }
}

/**
 * 工作区条目段（顶层键 workspaces）规范化：只收 trim 后非空的字符串键（键 =
 * 工作区目录绝对路径），值过 normalizeTargetFields；值不是映射、键为空串则
 * warn 并跳过。没有 workspaces 键 / 不是映射 → 空对象（条目缺失不算配置
 * 错误，老配置零感升级）。
 */
function normalizeWorkspaces(raw) {
  const out = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [key, value] of Object.entries(raw)) {
    const wsPath = typeof key === 'string' ? key.trim() : ''
    if (wsPath === '') {
      warn('workspaces: 忽略空路径键')
      continue
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      warn(`workspaces: '${wsPath}' 的条目不是映射，已忽略`)
      continue
    }
    out[wsPath] = normalizeTargetFields(value)
  }
  return out
}

/**
 * 目标字段集合规范化：顶层（除 profile 外）与 workspaces.<path> 条目共用的
 * 同一套键 —— roles（条目含 background_mode）/ roles_remove / main_agent_extra（含 has_main_agent_extra
 * 内部标记）/ main_agent_remove / main_agent_skills / main_agent_skills_inline /
 * main_agent_persona_extra / main_agent_display_name / skills。
 * 语义与抽取前逐字一致；
 * 非映射输入按空对象处理（工作区条目已先过映射校验，这里只为生成层把外部
 * 传入的 assignments 再规范一次时兜底）。
 */
export function normalizeTargetFields(raw) {
  const data = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const roles = {}
  const rawRoles = data.roles && typeof data.roles === 'object' && !Array.isArray(data.roles) ? data.roles : {}
  for (const [toolName, raw] of Object.entries(rawRoles)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const tools = Array.isArray(raw.tools) ? raw.tools.filter((t) => typeof t === 'string' && t !== '') : null
    // 非字符串（且非缺省/null）的 name/model/provider：warn 后置 null，不 throw
    // —— 静默吞错改为可见提醒，但不中断整体加载（与字符串违规 throw 的口径
    // 并行：格式非法宁报错，类型不对降级提醒）。
    for (const key of ['name', 'model', 'provider']) {
      const v = raw[key]
      if (v !== undefined && v !== null && typeof v !== 'string') {
        warn(`roles.${toolName}.${key}: 非字符串值已忽略（${JSON.stringify(v)}）`)
      }
    }
    // 角色条目字段顺序 { name?, model?, provider?, background_mode?, persona?, tools? }：
    // name（roles.<toolName>.name，内置角色可选显示名）与主 agent 显示名同约束，
    // 仅字符串收（trim 后空/违规由 normalizeRoleName 处理）；缺省/null → null
    // （= 保持该角色默认身份句）。model / provider（roles.<toolName>.model /
    // .provider，角色专用模型）镜像同款收法，违规由 normalizeModelRef 处理；
    // 缺省/null → null（= 不注入 agentOptions，子 agent 继承主 agent 当前模型）。
    // background_mode（roles.<toolName>.background_mode，角色可续模式）仅收
    // 'one-shot' | 'continuable'，其余 warn 回落 'one-shot'（normalizeBackgroundMode）。
    roles[toolName] = {
      name: typeof raw.name === 'string' ? normalizeRoleName(raw.name, `roles.${toolName}.name`) : null,
      model: typeof raw.model === 'string' ? normalizeModelRef(raw.model, `roles.${toolName}.model`) : null,
      provider: typeof raw.provider === 'string' ? normalizeModelRef(raw.provider, `roles.${toolName}.provider`) : null,
      background_mode: normalizeBackgroundMode(raw.background_mode, `roles.${toolName}.background_mode`),
      persona: typeof raw.persona === 'string' && raw.persona.trim() !== '' ? raw.persona : null,
      tools,
    }
  }
  // main_agent_extra 键存在性（fix：写盘时「原配置该键是否存在」语义的依据）：
  // 输入带 has_main_agent_extra 标记（已归一化对象再归一化，UI/CLI/生成层二次
  // 规范）时标记优先 —— 此时数据里恒为数组，只看数组会把「键缺失」误判成
  // 「显式存在」，保存时把老配置物化出 `main_agent_extra: []`，读写往返丢语义；
  // 裸输入（手编配置 / 临时 assignments）回落 Array.isArray 判原始键。
  const hasExtra = 'has_main_agent_extra' in data
    ? data.has_main_agent_extra === true
    : Array.isArray(data.main_agent_extra)
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
  // 主 agent 显示名（main_agent_display_name）：仅作用于 preset.yml 显示名，
  // 报错 label 用键名本身；typeof string 且 trim 后非空才收，否则 null（= 默认
  // 显示名「编排模式 (Orchestrator)」，工作区预设用派生名）。persona 身份行
  // 不可配置 —— 编排主 agent 的身份语义不属于可改项。
  const mainAgentDisplayName =
    typeof data.main_agent_display_name === 'string'
      ? normalizeRoleName(data.main_agent_display_name, 'main_agent_display_name')
      : null
  return {
    roles,
    roles_remove: rolesRemove,
    main_agent_extra: extra,
    // 内部标记：键 main_agent_extra 是否显式存在（含显式空列表；再归一化时
    // 保留原值，见上方 hasExtra）。resolveAssignments 据此区分「显式 [] = 尊重
    // 空」与「键缺失 = 老配置，回填智能默认」；writeTargetFields 据此决定是否
    // 落盘该键 —— 键缺失（老配置）保存后仍无此键（而非物化成 `[]`），显式存在
    // 才落盘（显式空写 `main_agent_extra: []`），读写 往返语义才存活。
    has_main_agent_extra: hasExtra,
    main_agent_remove: remove,
    main_agent_skills: mainAgentSkills,
    main_agent_skills_inline: mainAgentSkillsInline,
    main_agent_persona_extra: mainPersonaExtra,
    main_agent_display_name: mainAgentDisplayName,
    skills,
  }
}

/**
 * 剥掉 assignments 里不属于目标字段集合的两个容器键（profile / workspaces），
 * 浅拷贝返回；两键都不在场时原样返回。生成与存盘前一律过这道——UI/CLI 透传
 * 的 assignments 若混入了这两个键（如把整份 existing 配置直接当 assignments），
 * 也不能污染生成的 preset 或覆盖掉配置文件里对应的段。
 */
export function stripNonTargetKeys(assignments) {
  if (!assignments || typeof assignments !== 'object') return assignments
  if (!('profile' in assignments) && !('workspaces' in assignments)) return assignments
  const out = { ...assignments }
  delete out.profile
  delete out.workspaces
  return out
}

/**
 * 目标字段集合（roles → skills，除
 * profile / workspaces 外的全部顶层键）写出体：pad 为该层缩进前缀（顶层 ''、workspaces.<path> 条目里
 * '    '），行文本与字段序和拆分前逐字一致，顶层输出零变化
 *（唯一例外见下方 main_agent_extra：键缺失的老配置保存后仍缺省，不再物化 `[]`）。
 */
function writeTargetFields(lines, pad, target) {
  // main_agent_display_name：仅非 null 写出（null/缺省 = preset 显示名用默认
  // 「编排模式 (Orchestrator)」，工作区预设用派生名）；写出前过一次
  // normalizeRoleName（防手工构造的 config 绕过规范化），字段序固定。
  if (target.main_agent_display_name !== null && target.main_agent_display_name !== undefined) {
    const displayName = normalizeRoleName(target.main_agent_display_name, 'main_agent_display_name')
    if (displayName !== null) lines.push(`${pad}main_agent_display_name: ${yamlScalar(displayName)}`)
  }
  lines.push(`${pad}roles:`)
  for (const [toolName, role] of Object.entries(target.roles)) {
    lines.push(`${pad}  ${toolName}:`)
    // roles.<toolName>.name：仅非 null 写出（null/缺省 = 保持该角色默认身份句）；
    // 写在该角色 persona / tools 之前，缩进 4。
    if (role.name !== null && role.name !== undefined) {
      const name = normalizeRoleName(role.name, `roles.${toolName}.name`)
      if (name !== null) lines.push(`${pad}    name: ${yamlScalar(name)}`)
    }
    // roles.<toolName>.model / .provider：仅非 null 写出（null/缺省 = 不注入
    // agentOptions，子 agent 继承主 agent 当前模型）；写前过一次 normalizeModelRef
    // （与上方 name 写法一致，防手工构造的 config 绕过规范化），字段序 name →
    // model → provider → background_mode → persona → tools 固定。
    if (role.model !== null && role.model !== undefined) {
      const model = normalizeModelRef(role.model, `roles.${toolName}.model`)
      if (model !== null) lines.push(`${pad}    model: ${yamlScalar(model)}`)
    }
    if (role.provider !== null && role.provider !== undefined) {
      const provider = normalizeModelRef(role.provider, `roles.${toolName}.provider`)
      if (provider !== null) lines.push(`${pad}    provider: ${yamlScalar(provider)}`)
    }
    // roles.<toolName>.background_mode：恒写出（含缺省 one-shot）—— 配置文件里
    // 旋钮对用户可见、读写往返幂等（loadConfig 也恒收此键）。写前过一次判定
    // （防手工构造的 config 绕过规范化）：非 'continuable' 一律按 'one-shot' 落盘。
    lines.push(`${pad}    background_mode: ${role.background_mode === 'continuable' ? 'continuable' : 'one-shot'}`)
    if (role.persona !== null && role.persona !== undefined) {
      lines.push(`${pad}    persona: |-`)
      for (const line of String(role.persona).split('\n')) lines.push(`${pad}      ${line}`)
    }
    if (role.tools !== null && role.tools !== undefined) {
      lines.push(`${pad}    tools:`)
      // 工具名过 yamlScalar：含 ':' / '#' / 首字符指示符的名字裸写会产出坏 YAML。
      for (const tool of role.tools) lines.push(`${pad}      - ${yamlScalar(tool)}`)
    }
  }
  if (target.roles_remove && target.roles_remove.length > 0) {
    lines.push(`${pad}roles_remove:`)
    for (const role of target.roles_remove) lines.push(`${pad}  - ${role}`)
  }
  // main_agent_extra：「原配置显式写了键才写」（has_main_agent_extra 标记，见
  // normalizeTargetFields 的 hasExtra；未过 normalize 的裸对象回落「数组即写」
  // 旧判，标记显式 false = 键缺失 → 整键省略）。显式存在：length>0 走多行块，
  // 显式空数组写 `main_agent_extra: []` —— 显式空必须落盘成键，否则下次加载
  // 键缺失，resolveAssignments 会把空列表当老配置用智能默认回填，用户「明确
  // 不要 host 工具」的意愿就丢了。老配置无此键 → 保存后仍无此键（而非 []）。
  if (Array.isArray(target.main_agent_extra) && target.has_main_agent_extra !== false) {
    if (target.main_agent_extra.length > 0) {
      lines.push(`${pad}main_agent_extra:`)
      for (const tool of target.main_agent_extra) lines.push(`${pad}  - ${yamlScalar(tool)}`)
    } else {
      lines.push(`${pad}main_agent_extra: []`)
    }
  }
  if (target.main_agent_remove && target.main_agent_remove.length > 0) {
    lines.push(`${pad}main_agent_remove:`)
    for (const tool of target.main_agent_remove) lines.push(`${pad}  - ${tool}`)
  }
  if (target.main_agent_skills && target.main_agent_skills.length > 0) {
    lines.push(`${pad}main_agent_skills:`)
    for (const skill of target.main_agent_skills) lines.push(`${pad}  - ${skill}`)
  }
  if (target.main_agent_skills_inline && target.main_agent_skills_inline.length > 0) {
    lines.push(`${pad}main_agent_skills_inline:`)
    for (const skill of target.main_agent_skills_inline) lines.push(`${pad}  - ${skill}`)
  }
  // main_agent_persona_extra：只在非 null 时写出 —— '' 也写（= 明确清空，不追加任何
  // 内容），区别于缺省（= compose 回落默认常量）。
  if (target.main_agent_persona_extra !== null && target.main_agent_persona_extra !== undefined) {
    const value = String(target.main_agent_persona_extra)
    if (value === '') {
      lines.push(`${pad}main_agent_persona_extra: ''`)
    } else {
      lines.push(`${pad}main_agent_persona_extra: |-`)
      for (const line of value.split('\n')) lines.push(`${pad}  ${line}`)
    }
  }
  if (Object.keys(target.skills).length > 0) {
    lines.push(`${pad}skills:`)
    for (const [skill, roleList] of Object.entries(target.skills)) {
      // 技能名（键，块上下文）过 yamlScalar；角色名是流序列项，须过
      // yamlFlowScalar —— 流上下文里 ',' '[' ']' 等是定界符，裸写会截断序列。
      lines.push(`${pad}  ${yamlScalar(skill)}: [${roleList.map((r) => yamlFlowScalar(r)).join(', ')}]`)
    }
  }
}

/**
 * 工作区条目段写出（永远追加在 skills 之后、文件末尾）。路径键一律单引号
 * 包裹：路径可含 ':' / '#' 等会被键值切分或行内注释截断的歧义字符，裸写有
 * 歧义；内部单引号按 YAML 规则转义成 ''。键序按路径字符串排序，输出确定。
 */
function writeWorkspaces(lines, workspaces) {
  const wsPaths = Object.keys(workspaces)
    .filter((p) => typeof p === 'string' && p.trim() !== '')
    .sort()
  if (wsPaths.length === 0) return
  lines.push('workspaces:')
  for (const wsPath of wsPaths) {
    lines.push(`  '${wsPath.replace(/'/g, "''")}':`)
    const entry = workspaces[wsPath]
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      // 过一层 normalizeTargetFields：手编文件里缺 roles / skills 等容器的条目
      // 也能安全写出（对已归一化的条目是恒等变换，零影响）。
      writeTargetFields(lines, '    ', normalizeTargetFields(entry))
    }
  }
}

/** Serialize the config back to YAML (fixed structure, hand-rolled writer). */
export function serializeConfig(config) {
  const lines = ['# dsh-paoding（庖丁）安装配置 —— 可手编；改后在 设置 → 庖丁配置 应用，或重跑 node tools/install.mjs --auto']
  lines.push(`profile: ${config.profile ?? 'web'}`)
  writeTargetFields(lines, '', config)
  // workspaces 段可选：键缺失 / 空对象整段省略（不含 workspaces 的配置输出与
  // 旧版逐字节一致）。
  writeWorkspaces(
    lines,
    config.workspaces && typeof config.workspaces === 'object' && !Array.isArray(config.workspaces)
      ? config.workspaces
      : {},
  )
  return lines.join('\n') + '\n'
}

export function saveConfig(file, config) {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, serializeConfig(config), { mode: 0o600 })
}
