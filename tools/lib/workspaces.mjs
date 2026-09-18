/**
 * 工作区 slug 与 preset id：工作区目录路径 → 稳定的 preset 目录名后缀。
 * sanitizeSlugBase 取 basename 归一成合法 id 片段（DSH preset 目录名约束
 * /^[a-z0-9][a-z0-9-]*$/），stableHash 用 sha1 前 6 位给冲突路径加后缀，
 * assignSlugs 对整组路径一次性分配（同 basename 冲突才加 hash，非冲突路径
 * 保持可读的裸 basename），presetIdOf 拼出最终 preset id。
 * 仅依赖 node:crypto / node:path；被 state（工作区 preset 落盘定位）引用，
 * 并经 tools/install.mjs re-export 供插件侧（api-core 的 workspaceMeta）消费。
 */
import { createHash } from 'node:crypto'
import path from 'node:path'

/**
 * basename → slug 片段：小写；[^a-z0-9-]+ 折叠为 '-'；去首尾 '-'。
 * 空串（如 basename 为 '/' 或全非法字符）与保留名 'orchestrator'（会撞基础
 * preset 本体）一律回落 'ws'，保证结果永远是合法且不冲突的 id 片段。
 */
export function sanitizeSlugBase(base) {
  let slug = String(base ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (slug === '' || slug === 'orchestrator') slug = 'ws'
  return slug
}

/** 稳定短哈希：sha1 hex 前 6 位。只用于 slug 冲突消解，非安全用途。 */
export function stableHash(str) {
  return createHash('sha1').update(String(str)).digest('hex').slice(0, 6)
}

/**
 * 给一组工作区绝对路径分配 slug（Map<path, slug>）：basename 互不冲突的路径
 * 直接用 basename；同 basename 的多个路径（含重复路径）各自加 stableHash(path)
 * 后缀。先数后派两趟走，保证同一批输入下每个路径的 slug 稳定且互不相同；
 * 分配完再做一次 Set 唯一性断言——basename+hash 组合仍可能相撞（如某路径的
 * basename 恰为另一路径的 `<base>-<hash>` 形态），冲突者追加一层 hash 后缀
 * 重试，直到全组互不相同。
 */
export function assignSlugs(paths) {
  const list = (Array.isArray(paths) ? paths : []).map((p) => String(p)).filter((p) => p !== '')
  const baseCount = new Map()
  for (const p of list) {
    const base = sanitizeSlugBase(path.basename(p))
    baseCount.set(base, (baseCount.get(base) ?? 0) + 1)
  }
  const out = new Map()
  for (const p of list) {
    const base = sanitizeSlugBase(path.basename(p))
    out.set(p, baseCount.get(base) > 1 ? `${base}-${stableHash(p)}` : base)
  }
  // 唯一性断言 + 冲突消解：按插入序扫一遍，撞名者依次试 `<slug>-<hash(p#n)>`。
  // hash 输入含完整路径与轮次，实际上第一轮即唯一；上限兜底防病态输入死循环。
  const seen = new Set()
  for (const [p, slug] of out) {
    if (!seen.has(slug)) {
      seen.add(slug)
      continue
    }
    let candidate = slug
    for (let round = 1; seen.has(candidate) && round <= 64; round++) {
      candidate = `${slug}-${stableHash(`${p}#${round}`)}`
    }
    if (seen.has(candidate)) throw new Error(`assignSlugs: cannot derive a unique slug for ${p}`)
    out.set(p, candidate)
    seen.add(candidate)
  }
  return out
}

/** 工作区 slug → preset id（即 .agent-presets/ 下的目录名）。 */
export function presetIdOf(slug) {
  return `orchestrator-${slug}`
}
