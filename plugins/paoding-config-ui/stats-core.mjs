/**
 * 委派效果统计核心 —— DSH Web 插件 (plugins/paoding-config-ui) 的只读冷读层。
 *
 * A 路 = 宿主 sessionPersistence 服务：逐会话 open(id,'read') 冷读日志抽摘要
 * （另一进程持有会话也能读），文件系统只列会话目录名做枚举与缓存对账，绝不
 * 直接解日志文件——格式代际（session.jsonl / v1…v4、zstd / 明文）与撕尾恢复
 * 都是宿主后端的内部细节。
 *
 * ── 目录与 slug 口径（对照 @deepseek-ai/dsh-session-persistence-jsonl 实测）──
 *   $DSH_HOME/sessions/<项目slug>/<会话id>/session[.vN].jsonl(.zstd)
 * 项目 slug 即后端 projectKey(cwd)：
 *   分隔符 / \ : 折叠成单个 -；安全字符 [A-Za-z0-9._-] 原样；~ 与其余字符按
 *   UTF-16 码元 ~XXXX（大写十六进制）转义；剥前导 - 后以 -- 包头包尾，截 251。
 * 本文件 projectKeyOf 为同款纯函数（真实目录名逐字验证过，见
 * tests/api-stats.test.mjs 与真实 ~/.dsh/sessions 抽查），宿主侧实现有朝一日
 * 变了以真实目录为准（stats 路由的 slug 来自查询参数，本函数只负责「缺省 =
 * 当前面板项目」这一步换算）。
 *
 * ── 失败判据（判据与证据，2026-10 真实库 1278 会话抽查）────────────────────
 * 父会话侧 job/settled 全库 903 条 kind 均为 "bash"——子代理委派不走后台 job
 * 通道，父日志里没有可用的终止记录，判据只能取子会话自身的事件形态。DSH
 * agent 循环每轮助手轮次以 turn/start 开、turn/end 收，据此：
 *   正常完成 = owned 段 turn/start ≥ 1 且 turn/start === turn/end；
 *   失败形态 = (a) turn/start > turn/end —— 轮次中断（进程崩溃 / 中途终止，
 *              真实库存在 2 例）；(b) turn/start === 0 —— 子会话被创建但从未
 *              跑过任何轮次（spawn 后即死，真实库 9 例，含唯一一条真实
 *              paoding-role 样本：存活 88 秒、仅 4 条预置事件 + end-seed）。
 * 计数只看 owned 段（inheritedEventCount 切掉继承前缀）：可续子会话续跑时日
 * 志带上一轮化身的历史，那段 turn 天然平衡；继承切点打在轮次边界（实测 73 处
 * mid 位 end-seed 前一事件以 turn/end 为主），owned 段计数不受污染。时长与
 * 窗口过滤同样只用 owned 段，防跨化身膨胀。
 */

import { readdirSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveDshHome } from './api-core.mjs'
import { ROLE_PRESET_ID_PREFIX } from '../../tools/lib/compose.mjs'

/** 窗口缺省与上限（天）：days 参数整数夹取到 [1, 365]，无法解析回落缺省。 */
export const STATS_DEFAULT_DAYS = 30
export const STATS_MAX_DAYS = 365

// ── 参数清洗 ─────────────────────────────────────────────────────────────────

/** days 清洗：parseInt 夹取 [1, 365]；NaN / 负数 / 0 回落缺省或夹到下限。 */
export function sanitizeStatsDays(raw) {
  const n = Number.parseInt(String(raw ?? ''), 10)
  if (!Number.isFinite(n)) return STATS_DEFAULT_DAYS
  return Math.min(STATS_MAX_DAYS, Math.max(1, n))
}

/**
 * project slug 清洗：仅安全段字符（与会话 id 的 encodeSegment 白名单一致），
 * 显式拒 '.' / '..'，且 resolve 后不得逃出会话根（防符号级穿越）。'all' 放行
 * ——跨项目聚合仅内部 / 测试用，面板 v1 不出此选项。非法返回 null（路由层
 * 回 422）。
 */
export function sanitizeProjectSlug(raw, sessionsRoot) {
  const slug = String(raw ?? '')
  if (slug === 'all') return 'all'
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(slug)) return null
  if (slug === '.' || slug === '..') return null
  // join 后再 resolve 必须原样落回同一深层路径：'..' 之类会指向父目录而被拒
  if (path.resolve(sessionsRoot, slug) !== path.join(sessionsRoot, slug)) return null
  return slug
}

// ── slug 换算（缺省 = 当前面板项目）──────────────────────────────────────────

/**
 * 宿主 projectKey(cwd) 的同款实现（口径见文件头注释）：逐码元扫描，分隔符
 * 连续段折叠成单个 '-'，剥前导 '-'，-- 包头包尾，251 截断。
 */
export function projectKeyOf(cwd) {
  const text = String(cwd ?? '')
  if (text.length === 0) throw new Error('cannot encode an empty project path')
  let readable = ''
  let separatorRun = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch
      separatorRun = false
    } else {
      readable += '~' + text.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0')
      separatorRun = false
    }
  }
  return `--${(readable.replace(/^-+/, '') || 'root').slice(0, 251)}--`
}

/** 当前面板项目的 slug（cwd 口径与 api-core 的 state 采集一致）。 */
export function currentProjectSlug() {
  const cwd = process.env.DSH_PAODING_CWD || process.cwd()
  try {
    return projectKeyOf(cwd)
  } catch {
    return '_no-cwd'
  }
}

// ── 会话枚举与缓存对账 ───────────────────────────────────────────────────────

/** 会话日志文件名（最高代代际胜出：无版本号 = 0 代，vN 按数值比较）。 */
const SESSION_FILE_RE = /^session(?:\.v(\d+))?\.jsonl(?:\.zstd)?$/

function currentSessionFile(sessionDir) {
  let best = null
  let bestVersion = -1
  let names
  try {
    names = readdirSync(sessionDir)
  } catch {
    return null
  }
  for (const name of names) {
    const m = SESSION_FILE_RE.exec(name)
    if (!m) continue
    const version = m[1] ? Number(m[1]) : 0
    if (version > bestVersion) {
      bestVersion = version
      best = name
    }
  }
  return best
}

/** 列一个项目 slug 下的会话目录名（即会话 id）。目录不存在 / 不可读 → 空数组。 */
function listSessionIds(sessionsRoot, slug) {
  try {
    return readdirSync(path.join(sessionsRoot, slug), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
  } catch {
    return []
  }
}

// ── 冷读摘要 ─────────────────────────────────────────────────────────────────

/** 一个会话的抽摘要结果（JSON-safe 纯数据，可进缓存）。 */
function summarizeEvents(header, allEvents, inheritedCount) {
  const owned = inheritedCount > 0 ? allEvents.slice(inheritedCount) : allEvents
  let firstTime = null
  let lastTime = null
  let turnStarts = 0
  let turnEnds = 0
  for (const event of owned) {
    const time = event && typeof event.time === 'number' ? event.time : null
    if (time !== null) {
      if (firstTime === null) firstTime = time
      lastTime = time
    }
    if (event && event.type === 'turn/start') turnStarts++
    else if (event && event.type === 'turn/end') turnEnds++
  }
  const headerTime = header && typeof header.createdAt === 'number' ? header.createdAt : null
  if (firstTime === null) firstTime = headerTime
  if (lastTime === null) lastTime = firstTime
  return {
    agentPreset: header && typeof header.agentPreset === 'string' ? header.agentPreset : null,
    firstTime,
    lastTime,
    durationMs: firstTime !== null && lastTime !== null ? Math.max(0, lastTime - firstTime) : 0,
    turnStarts,
    turnEnds,
  }
}

/**
 * 冷读一个会话抽摘要。句柄 open / read 任一失败（锁住 / 损坏 / 格式不识）原样
 * 上抛由调用方跳过计数；close 失败不掩盖读结果。read 返回形状按宿主契约
 * { events }，兼容裸数组，其余视为空日志。
 */
export async function readSessionSummary(persistence, sessionId) {
  const handle = await persistence.open(sessionId, 'read')
  try {
    const raw = await handle.read()
    const events = Array.isArray(raw)
      ? raw
      : raw && Array.isArray(raw.events)
        ? raw.events
        : []
    const inherited = handle && typeof handle.inheritedEventCount === 'number' && handle.inheritedEventCount > 0
      ? handle.inheritedEventCount
      : 0
    return summarizeEvents(handle && handle.header, events, inherited)
  } finally {
    try {
      await handle.close()
    } catch {
      // 关不掉就关不掉：读结果已到手，不因 close 异常作废
    }
  }
}

// ── 聚合 ─────────────────────────────────────────────────────────────────────

/**
 * 失败判据（见文件头「失败判据」节）：owned 段跑完过至少一轮且首尾平衡才算
 * 正常完成；没跑过轮次或轮次中断都计入 failures。
 */
function isFailedSummary(summary) {
  if (summary.turnStarts < 1) return true
  return summary.turnStarts !== summary.turnEnds
}

/** 单会话是否落在 days 窗口内（按会话首事件时间；拿不到首时间的丢弃）。 */
function withinWindow(summary, days, nowMs) {
  if (summary.firstTime === null || typeof summary.firstTime !== 'number') return false
  return nowMs - summary.firstTime <= days * 24 * 60 * 60 * 1000
}

/**
 * 聚合：只认 agentPreset 以 paoding-role- 开头的会话（其余忽略）。每角色
 * calls / totalMs / failures / lastUsedAt；roles 按调用数降序，同量按最近使用
 * 新者在前（展示顺序稳定）。返回 roles 与 delegatedSessions 计数。
 */
function aggregateRoles(summaries, days, nowMs) {
  const byRole = new Map()
  let delegatedSessions = 0
  for (const summary of summaries) {
    const preset = summary.agentPreset
    if (typeof preset !== 'string' || !preset.startsWith(ROLE_PRESET_ID_PREFIX)) continue
    if (!withinWindow(summary, days, nowMs)) continue
    delegatedSessions++
    const role = preset.slice(ROLE_PRESET_ID_PREFIX.length) || '(匿名角色)'
    let row = byRole.get(role)
    if (!row) {
      row = { role, calls: 0, totalMs: 0, failures: 0, lastUsedAt: 0 }
      byRole.set(role, row)
    }
    row.calls++
    row.totalMs += summary.durationMs
    if (isFailedSummary(summary)) row.failures++
    if (typeof summary.lastTime === 'number' && summary.lastTime > row.lastUsedAt) {
      row.lastUsedAt = summary.lastTime
    }
  }
  const roles = [...byRole.values()].map((row) => ({
    role: row.role,
    calls: row.calls,
    avgMs: row.calls > 0 ? Math.round(row.totalMs / row.calls) : 0,
    failures: row.failures,
    lastUsedAt: row.lastUsedAt,
  }))
  roles.sort((a, b) => (b.calls - a.calls) || (b.lastUsedAt - a.lastUsedAt))
  return { roles, delegatedSessions }
}

// ── 并发闸（同时最多 4 个读句柄）─────────────────────────────────────────────

async function mapLimited(items, limit, worker) {
  const results = new Array(items.length)
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++
      if (index >= items.length) return
      try {
        results[index] = { ok: true, value: await worker(items[index], index) }
      } catch (err) {
        results[index] = { ok: false, error: err }
      }
    }
  })
  await Promise.all(runners)
  return results
}

// ── 摘要缓存（内存即可，进程重启重建）────────────────────────────────────────
// sessionId（含 slug 前缀的复合键）→ { file, mtimeMs, size, summary }：目录里
// 选中日志文件的 mtime / size 都没变就直用缓存摘要，不再开读句柄。活跃会话的
// 日志持续增长，mtime 变化即自然失效。条目随会话删除残留几 KB 无妨，不做上限。

const summaryCache = new Map()

/**
 * 委派效果统计主入口。ctx 缺 sessionPersistence（reflect 软探测，绝不进
 * inject——硬注入会让缺服务的老宿主挂载即炸）→ { ok:false,
 * reason:'persistence-unavailable' }，面板据此整卡不渲染。project 非法抛
 * 422（外层 catch 统一回 { error } 信封）。
 */
export async function collectDelegationStats(ctx, { project, days } = {}) {
  const persistence = reflectService(ctx, 'sessionPersistence')
  if (!persistence) return { ok: false, reason: 'persistence-unavailable' }

  const windowDays = sanitizeStatsDays(days)
  const sessionsRoot = path.join(resolveDshHome(), 'sessions')
  const slug = sanitizeProjectSlug(project !== undefined && project !== null && project !== '' ? project : currentProjectSlug(), sessionsRoot)
  if (slug === null) {
    const err = new Error(`project 参数不合法（仅允许 [A-Za-z0-9._-]，或 all）: ${String(project).slice(0, 64)}`)
    err.statusCode = 422
    throw err
  }

  // 枚举：all = 列会话根下全部项目目录；单 slug 只列该目录。
  const slugs = slug === 'all'
    ? (() => {
        try {
          return readdirSync(sessionsRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
        } catch {
          return []
        }
      })()
    : [slug]
  const targets = []
  for (const dir of slugs) {
    for (const id of listSessionIds(sessionsRoot, dir)) {
      targets.push({ slug: dir, id })
    }
  }

  const nowMs = Date.now()
  const reads = await mapLimited(targets, 4, async ({ slug: dir, id }) => {
    const sessionDir = path.join(sessionsRoot, dir, id)
    const file = currentSessionFile(sessionDir)
    if (file === null) throw new Error('no session log file')
    const st = statSync(path.join(sessionDir, file)) // stat 失败 → 跳过计数
    const cacheKey = dir + '\u0000' + id
    const hit = summaryCache.get(cacheKey)
    if (hit && hit.file === file && hit.mtimeMs === st.mtimeMs && hit.size === st.size) {
      return { id, summary: hit.summary }
    }
    const summary = await readSessionSummary(persistence, id)
    summaryCache.set(cacheKey, { file, mtimeMs: st.mtimeMs, size: st.size, summary })
    return { id, summary }
  })

  let skipped = 0
  const summaries = []
  for (const r of reads) {
    if (r.ok) summaries.push(r.value.summary)
    else skipped++
  }
  const { roles, delegatedSessions } = aggregateRoles(summaries, windowDays, nowMs)
  return {
    ok: true,
    project: slug,
    windowDays,
    generatedAt: new Date(nowMs).toISOString(),
    roles,
    sessionsScanned: targets.length,
    delegatedSessions,
    skipped,
  }
}

/** reflect 软探测（与 persistenceAvailableOf 同款口径，任何异常按缺失处理）。 */
function reflectService(ctx, name) {
  try {
    const reflect = ctx.reflect
    if (!reflect || typeof reflect.get !== 'function') return undefined
    return reflect.get(name, false)
  } catch {
    return undefined
  }
}
