/**
 * 运行时事实采集 —— DSH Web 插件 (plugins/paoding-config-ui)
 *
 * “运行时优先”的通用插件/工具检测基础：在 Web 运行时内直接读取 DSH
 * 宿主自带的实时注册表，识别任何以 bundle/插件形态加载且启用的插件
 * （@hyzyn/dsh-codegraph、dsh-mnemon、magic-memory 等），不再依赖
 * cordis.patch.yml 条目 + 硬编码白名单。已有文件扫描路径保持原样，作为
 * CLI / 无运行时场景的兜底，二者按需叠加。
 *
 * 数据来源（均已查实）：
 *   - dsh-host-plugin-inventory：ctx.pluginInventory.list() 返回
 *     { entries: [{ entryId, moduleName, enabled, fiberPhase }] }，
 *     entries 为 Loader 中全部非 group 条目（含未启用的，enabled 由
 *     loader disabled 推导；fiberPhase：active=正在运行，null=无 fiber，
 *     另有 pending/loading/failed/unloading）。
 *   - dsh-tools：名为 'tools' 的 cordis Service（ctx.tools /
 *     ctx.get('tools')），公开方法 register/get/restrict/guard/schemas；
 *     MCP 工具由 dsh-mcp-client 以 `mcp__<server>__<tool>` 公开名注册，
 *     故 schemas()/entries() 等能枚举出形如 mcp__tavily__tavily_search 的
 *     全名，与 tools/install.mjs 的 inventory 命名约定一致。
 *   - 预设安装轨道（presetSystem）：agentPresets 服务有无 register 方法——
 *     0.1.7+ 的 agent-preset-registry（声明行轨）有，≤0.1.6 的目录扫描服务
 *     没有；collectState 拿它免掉 dsh --version 子进程探测。
 *
 * 约定：本模块只负责“取数”，任何一步失败都不抛出——错误记入 error 字符串
 * （多条用 '; ' 连接、整体截断），返回可用的部分结果；列表带截断上限防爆。
 * 服务端只透传插件条目的原始字段（enabled/fiberPhase 原样保留），仅剔除
 * 显然未启用/未运行（enabled===false 或 fiberPhase 非 'active'）的条目，
 * 其余判断留给 UI。
 */

const MAX_PLUGIN_ENTRIES = 200
const MAX_TOOL_NAMES = 2000
const MAX_ERROR_LEN = 500

/** 把名字记入结果（字符串校验、去重、截断都在这里做）。 */
function pushName(name, out, seen) {
  if (typeof name !== 'string' || name === '') return
  if (seen.has(name) || out.length >= MAX_TOOL_NAMES) return
  seen.add(name)
  out.push(name)
}

/** 归一化 [key, value] 工具对：优先取 value 对象自带的 name，否则取 key。 */
function pushPair(key, def, out, seen) {
  if (def && typeof def === 'object' && typeof def.name === 'string') pushName(def.name, out, seen)
  else pushName(key, out, seen)
}

/**
 * 把一次枚举调用返回的结果收集成字符串工具名数组。
 * 兼容 Map / 任意迭代器 / 数组三种形态，元素可为字符串、[name, def] 对
 * 或带 name 字段的对象（如 schemas() 返回的 { name, description, ... }）。
 */
function collectToolNames(value, out, seen) {
  if (value == null) return
  if (typeof value !== 'object' && typeof value !== 'string') return
  if (typeof value[Symbol.iterator] !== 'function') return
  for (const item of value) {
    if (typeof item === 'string') {
      pushName(item, out, seen)
    } else if (Array.isArray(item)) {
      // [name, def] 对（Map.entries() 的产物）
      if (item.length > 0) pushPair(item[0], item[1], out, seen)
    } else if (item && typeof item === 'object') {
      if (typeof item.name === 'string') {
        pushName(item.name, out, seen)
      } else if (Object.keys(item).length === 1) {
        // 兜底：{ [key]: def } 形态的对象，按 key/def.name 处理——仅接受单键
        // 对象（多键对象没有唯一「工具名」语义，跳过）
        for (const [k, v] of Object.entries(item)) pushPair(k, v, out, seen)
      }
    }
  }
}

/**
 * 防御式取服务：cordis 的 ctx[key] 受 inject 护栏约束（未注入直接抛
 * "cannot get property ... without inject"），而 ctx.reflect.get(name)
 * 是官方文档明确的“无需 inject 即可读取”入口（ctx.get 为其 mixin 别名，
 * strict=false 连 provider 未处于 running 态也允许读）。按
 * reflect.get → ctx.get → ctx[key] 三级降级，全部 try/catch，永不抛出。
 */
function getService(ctx, key) {
  if (ctx == null) return undefined
  const attempts = [
    () => ctx.reflect?.get?.(key, false),
    () => ctx.get?.(key),
    () => ctx[key],
  ]
  for (const fn of attempts) {
    try {
      const v = fn()
      if (v !== undefined && v !== null) return v
    } catch { /* 该路径不可用：尝试下一级 */ }
  }
  return undefined
}

/**
 * 读取运行时插件清单。返回 { entries, ok }：ok 表示成功拿到 list() 结果
 * （空清单也算成功，区别于服务不可用）。
 */
function collectPluginEntries(ctx, errors) {
  const pi = getService(ctx, 'pluginInventory')
  try {
    // 服务属性访问也纳入 try（cordis 代理 getter 理论上可能抛）：兑现「永不抛」契约
    if (pi == null || typeof pi.list !== 'function') return { entries: [], ok: false }
    const result = pi.list()
    // list() 官方返回 { entries: [...] }；兼容直接返回数组的形态
    const raw = Array.isArray(result) ? result : Array.isArray(result?.entries) ? result.entries : null
    if (raw === null) {
      errors.push('pluginInventory.list() returned an unexpected shape')
      return { entries: [], ok: false }
    }
    const entries = []
    for (const e of raw.slice(0, MAX_PLUGIN_ENTRIES)) {
      // 只透传四个已知字段（保持 JSON 安全）；剔除未启用 / 未运行（fiberPhase
      // 缺失时按“可接受”处理，兼容字段更老的宿主）的条目，其余留给 UI 判断
      if (e == null || typeof e !== 'object') continue
      if (e.enabled === false) continue
      if (e.fiberPhase != null && e.fiberPhase !== 'active') continue
      entries.push({
        entryId: typeof e.entryId === 'string' ? e.entryId : undefined,
        moduleName: typeof e.moduleName === 'string' ? e.moduleName : undefined,
        enabled: e.enabled,
        fiberPhase: e.fiberPhase ?? null,
      })
    }
    return { entries, ok: true }
  } catch (err) {
    errors.push(`pluginInventory.list() failed: ${String(err?.message ?? err)}`)
    return { entries: [], ok: false }
  }
}

/**
 * 读取 tools 服务注册的工具公开名。按下列顺序尝试，任意一步抛错都跳过：
 *   1) t.entries() 若可调用（Map / 迭代器 / 数组 归一化）；
 *   2) t.schemas() 若可调用（返回 [{ name, description, ... }]，全局视图 =
 *      全部已注册工具，含 mcp__<server>__<tool>）；
 *   3) 兜底：只试白名单里的只读枚举方法名（entries/schemas/list/keys/
 *      listKeys），不做正则泛配（避免误调写方法）；
 *   4) 全部失败返回空数组（原因记入 errors）。返回 { names, ok }。
 */
function readRegisteredToolNames(ctx, errors) {
  const out = []
  const seen = new Set()
  const t = getService(ctx, 'tools')
  if (t == null) {
    // 单侧失败也留痕：UI 可区分「无工具」与「tools 服务不可用」
    errors.push('tools service unavailable')
    return { names: [], ok: false }
  }
  const tried = new Set()
  const attempt = (method, source) => {
    if (tried.has(method)) return false
    tried.add(method)
    try {
      // 方法属性读取也纳入 try（cordis 代理 getter 可能抛）
      if (typeof t[method] !== 'function') return false
      const result = t[method]()
      // 拿到可迭代结果即视为“服务可用”（即使为空清单）；无结果 / 抛错都跳过
      if (result != null && typeof result[Symbol.iterator] === 'function') {
        collectToolNames(result, out, seen)
        return true
      }
    } catch (err) {
      errors.push(`${source} threw: ${String(err?.message ?? err)}`)
    }
    return false
  }

  // 1) entries() —— cordis Service 层最直观的枚举口（部分版本存在）
  // 2) schemas() —— dsh-tools 公开 API 里能枚举“全部已注册工具名”的口
  let acquired = attempt('entries', 'tools.entries()')
  if (!acquired) acquired = attempt('schemas', 'tools.schemas()')

  // 3) 兜底：只试白名单里的只读枚举方法名（不做正则泛配）；已在 1)/2) 试过
  //    的 entries/schemas 由 tried 去重，不会重复调用
  if (!acquired) {
    for (const m of ['entries', 'schemas', 'list', 'keys', 'listKeys']) {
      if (attempt(m, `tools.${m}()`)) { acquired = true; break }
    }
  }
  // 有服务但枚举口全不可读：同样留痕（区别于「服务可用但工具清单为空」）
  if (!acquired) {
    errors.push('tools service present but no readable enumeration (entries/schemas/list/keys/listKeys)')
  }
  return { names: out, ok: acquired }
}

/**
 * 预设安装轨道探测：0.1.7+ 宿主的 agentPresets 服务是 agent-preset-registry
 * （带 register 方法，声明行轨）；≤0.1.6 的同名服务只做 .agent-presets 目录
 * 扫描、没有 register。ctx.reflect.get(name, false) 读不到服务返回 undefined、
 * 不触发 inject 护栏，整个探测自捕——任何异常都按 directory（安全侧）处理，
 * 永不抛出。
 */
function detectPresetSystemOf(ctx) {
  try {
    const svc = ctx?.reflect?.get?.('agentPresets', false)
    return svc != null && typeof svc.register === 'function' ? 'declarative' : 'directory'
  } catch {
    return 'directory'
  }
}

/**
 * 采集运行时事实（供 collectState 合并 / UI 展示）。
 * 永不抛出：任何异常都会落到 error 里，返回部分结果。
 */
export function collectRuntimeFacts(ctx) {
  const errors = []
  const plugin = collectPluginEntries(ctx, errors)
  const tools = readRegisteredToolNames(ctx, errors)

  // ok 语义：pluginInventory 与 tools 至少一个服务真正可用即为成功；
  // 两个都拿不到才整体失败（UI 据此提示“已回退文件扫描”）。单侧失败的原因
  // 也已各自记入 errors（上方），UI 可区分「无工具」与「tools 服务不可用」。
  const ok = plugin.ok || tools.ok
  if (!ok) errors.unshift('pluginInventory/tools both unavailable: fell back to file scan')

  let error = errors.join('; ')
  if (error.length > MAX_ERROR_LEN) error = error.slice(0, MAX_ERROR_LEN) + '…'
  return {
    ok,
    ...(error !== '' ? { error } : {}),
    pluginEntries: plugin.entries,
    toolNames: tools.names,
    presetSystem: detectPresetSystemOf(ctx),
  }
}
