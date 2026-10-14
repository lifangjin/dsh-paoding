/**
 * 工具条目通配符展开（生成期专用）：配置里的工具条目支持 `*`（任意长字符段，
 * 可为空）与 `?`（恰一个字符）两个通配符 —— 够 MCP 工具族场景使用（如
 * `mcp__tavily__tavily_*` 展开为 search/crawl/extract/map/research 五个），不引
 * 第三方依赖，也不支持字符类 `[...]` 与转义（工具名里它们不是合法成员，无需）。
 * 展开只发生在生成期：产物里只落具体工具名，运行时 toolFilter 语义完全不变。
 * 依赖 util（warn）；被 compose 引用。
 */
import { warn } from './util.mjs'

/**
 * 条目是否含通配符（`*` 或 `?`）：非字符串一律视为不含（配置规范化只放行非空
 * 字符串，这里是 compose 层对 UI / 测试直传 assignments 的兜底口径）。
 */
export function hasWildcard(entry) {
  return typeof entry === 'string' && /[*?]/.test(entry)
}

/** 通配符模式 → 全串锚定正则：`*` → 任意长字符段、`?` → 恰一字符，其余字符
 * 按字面匹配（正则元字符一律转义，防 `mcp__x(y)` 之类名字被当正则解读）。 */
function patternToRegExp(pattern) {
  const source = [...pattern]
    .map((ch) => {
      if (ch === '*') return '[\\s\\S]*'
      if (ch === '?') return '[\\s\\S]'
      return ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    })
    .join('')
  return new RegExp(`^${source}$`)
}

/**
 * 把含通配符的条目对候选集展开为具体工具名列表；不含通配符的条目原样保留。
 *  - 输入不含任何通配符 → 原数组原样返回（同一引用）：零通配的默认路径零开销、
 *    零行为变化，全默认生成产物与源逐字节一致的金测因此不受影响；
 *  - 含通配符时逐条目原位展开：精确名条目留在原相对位置；每个模式条目展开为
 *    命中的候选名，命中名按候选集自身的迭代顺序（Set 插入序，即调用方构造
 *    presetUniverse ∪ inventory 时的稳定顺序）排列。选候选集顺序而非「匹配发现
 *    顺序」的理由：(a) 候选集顺序与条目书写顺序、模式数量正交 —— 两个角色写
 *    同一模式得到完全一致的展开序列，反复生成产物稳定、diff 可比；(b) 原位展开
 *    保住作者书写条目的顺序语义（精确名不动、每个模式的展开成组可读）。若按
 *    匹配发现顺序输出，命中名会被拉离其模式条目的位置、序列还随模式间交互
 *    漂移，产物可读性与稳定性都差；
 *  - 整体保序去重：先出现者保留（跨精确名/展开名统一去重，模式命中已在候选集
 *    里的精确名时不产生重复行）；
 *  - 某模式零匹配 → warn 一条（含模式串本身）并丢弃该条目：展开的契约是「产物
 *    只含具体名」，保留裸模式串等于往运行时 allow 里塞一个永远匹配不上的字面量。
 * candidates 接受 Set 或数组；entries 非数组时原样返回（tools 缺省为 null 的
 * 既有口径由调用方 `?? []` 兜底，这里不再二次加工）。
 */
export function expandToolPatterns(entries, candidates) {
  if (!Array.isArray(entries)) return entries
  if (!entries.some((entry) => hasWildcard(entry))) return entries
  const candidateList = candidates instanceof Set ? [...candidates] : Array.isArray(candidates) ? [...candidates] : []
  const out = []
  const seen = new Set()
  for (const entry of entries) {
    if (!hasWildcard(entry)) {
      if (!seen.has(entry)) {
        seen.add(entry)
        out.push(entry)
      }
      continue
    }
    const re = patternToRegExp(entry)
    let matched = 0
    for (const candidate of candidateList) {
      if (typeof candidate !== 'string' || seen.has(candidate) || !re.test(candidate)) continue
      seen.add(candidate)
      out.push(candidate)
      matched++
    }
    if (matched === 0) warn(`工具通配符模式 '${entry}' 未匹配到任何候选工具名，已忽略该条目`)
  }
  return out
}
