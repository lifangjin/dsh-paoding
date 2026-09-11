/**
 * 主机层（host）工具检测与 MCP 工具名解析：KNOWN_MCP_TOOLS / KNOWN_HOST_PLUGINS
 * 静态表、JSON-RPC initialize + tools/list 握手（stdio / streamable-http /
 * postMcp / parseHttpMessage）、host 相关判定与文案（isHostDependent /
 * pluginLabel / removedReason）与错误收尾（sanitizeError / truncate）。
 * 仅依赖 node:child_process（spawn）；fetch / AbortSignal 为 Node 全局。
 * 被 state / compose / wizard / cli 引用。
 */
import { spawn } from 'node:child_process'

/**
 * Exact tool names of well-known MCP servers (restrict() does not support
 * globs, so the names must be spelled out).  Servers listed here are resolved
 * without a live handshake; unknown servers go through one.
 */
export const KNOWN_MCP_TOOLS = {
  tavily: [
    'tavily_search',
    'tavily_crawl',
    'tavily_extract',
    'tavily_map',
    'tavily_research',
  ],
  codegraph: ['codegraph_explore'],
}

/**
 * Local tool plugins whose tools are added to the host layer.  `match` tests
 * the entry name; `tools` lists the exact tool names the plugin registers.
 * Extend this table when adding more plugins.
 */
export const KNOWN_HOST_PLUGINS = [{ match: /magic-memory/, tools: ['memory_search'] }]

export const HANDSHAKE_TIMEOUT_MS = 15000

export const INIT_REQUEST = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'dsh-paoding-installer', version: '1.0.0' },
  },
})

export const LIST_REQUEST = JSON.stringify({
  jsonrpc: '2.0',
  id: 2,
  method: 'tools/list',
  params: {},
})

// ── host tool detection ─────────────────────────────────────────────────────

export function isMcpEntry(entry) {
  if (!entry || typeof entry !== 'object') return false
  const name = typeof entry.name === 'string' ? entry.name : ''
  const cfg = entry.config && typeof entry.config === 'object' ? entry.config : {}
  const serverName = typeof cfg.serverName === 'string' ? cfg.serverName : ''
  const transport = typeof cfg.transport === 'string' ? cfg.transport : ''
  const hasCommand = typeof cfg.command === 'string' && cfg.command.length > 0
  if (name.endsWith('dsh-mcp-client')) return true
  return serverName !== '' && (['stdio', 'streamable-http', 'sse'].includes(transport) || hasCommand)
}

/** Entry-level enablement (spec rule); plugins additionally check config.enabled. */
export function isEntryEnabled(entry) {
  return entry?.enabled !== false && !entry?.disabled
}

/** Extract the MCP connection details, or null when the config is unusable. */
export function extractMcp(entry) {
  const cfg = entry.config && typeof entry.config === 'object' && !Array.isArray(entry.config) ? entry.config : null
  const serverName = cfg && typeof cfg.serverName === 'string' && cfg.serverName !== '' ? cfg.serverName : ''
  if (!cfg || serverName === '') return null
  return {
    serverName,
    transport: typeof cfg.transport === 'string' ? cfg.transport : undefined,
    command: typeof cfg.command === 'string' ? cfg.command : undefined,
    args: Array.isArray(cfg.args) ? cfg.args.filter((a) => typeof a === 'string') : [],
    url: typeof cfg.url === 'string' ? cfg.url : undefined,
  }
}

// ── MCP tool-name resolution ────────────────────────────────────────────────

/** Never echo real URLs (e.g. a tavily API key) in warnings/reports. */
export function sanitizeError(message) {
  return String(message).replace(/https?:\/\/\S+/g, '<url>').slice(0, 300)
}

export function truncate(text, max) {
  const s = String(text)
  return s.length > max ? `${s.slice(0, max)}…` : s
}

/**
 * Resolve the exact tool names of one MCP server.  Static table first, then a
 * live JSON-RPC handshake.  Never throws: failures return { tools: [], error }.
 */
export async function resolveMCP(mcp) {
  const known = KNOWN_MCP_TOOLS[mcp.serverName]
  if (known) return { tools: [...known], source: 'static' }
  try {
    if (mcp.transport === 'stdio') {
      if (!mcp.command) throw new Error('stdio transport requires config.command')
      return { tools: await handshakeStdio(mcp), source: 'handshake' }
    }
    if (mcp.transport === 'streamable-http') {
      if (!mcp.url) throw new Error('streamable-http transport requires config.url')
      return { tools: await handshakeHttp(mcp), source: 'handshake' }
    }
    if (mcp.transport === 'sse') {
      throw new Error('sse transport is not supported for live tool discovery')
    }
    throw new Error(`unsupported transport: ${mcp.transport ?? '(none)'}`)
  } catch (err) {
    return { tools: [], source: 'failed', error: sanitizeError(err?.message ?? err) }
  }
}

/** JSON-RPC handshake over stdio: initialize (id 1) then tools/list (id 2). */
export function handshakeStdio(mcp) {
  return new Promise((resolve, reject) => {
    const child = spawn(mcp.command, Array.isArray(mcp.args) ? mcp.args : [], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdoutBuf = ''
    let stderrBuf = ''
    let settled = false
    const timer = setTimeout(
      () => fail(`handshake timed out after ${HANDSHAKE_TIMEOUT_MS / 1000}s`),
      HANDSHAKE_TIMEOUT_MS,
    )

    function fail(message) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        child.kill('SIGTERM')
      } catch {
        /* already gone */
      }
      reject(new Error(sanitizeError(message)))
    }
    function finish(tools) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        child.kill('SIGTERM')
      } catch {
        /* already gone */
      }
      resolve(tools)
    }
    function send(payload) {
      try {
        child.stdin.write(`${payload}\n`)
      } catch {
        /* the exit handler will surface the failure */
      }
    }

    child.stdout.on('data', (chunk) => {
      stdoutBuf += chunk.toString()
      let newline
      while ((newline = stdoutBuf.indexOf('\n')) !== -1) {
        const line = stdoutBuf.slice(0, newline).trim()
        stdoutBuf = stdoutBuf.slice(newline + 1)
        if (line === '') continue
        let msg
        try {
          msg = JSON.parse(line)
        } catch {
          continue
        }
        if (msg.id === 1) {
          send(LIST_REQUEST)
        } else if (msg.id === 2) {
          if (msg.error) {
            fail(`tools/list error: ${JSON.stringify(msg.error).slice(0, 300)}`)
            return
          }
          const tools = Array.isArray(msg.result?.tools)
            ? msg.result.tools.map((t) => t?.name).filter((n) => typeof n === 'string' && n !== '')
            : []
          finish(tools)
        }
      }
    })
    child.stderr.on('data', (chunk) => {
      stderrBuf = (stderrBuf + chunk.toString()).slice(-2000)
    })
    child.on('error', (err) => fail(`spawn failed: ${err.message}`))
    child.on('exit', (code, signal) => {
      if (settled) return
      const tail = stderrBuf.trim() ? `: ${truncate(stderrBuf.trim(), 200)}` : ''
      fail(`process exited early (code=${code}, signal=${signal ?? 'none'})${tail}`)
    })

    send(INIT_REQUEST)
  })
}

/** JSON-RPC handshake over streamable-http (plain JSON or SSE `data:` lines). */
export async function handshakeHttp(mcp) {
  const headers = {
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json',
  }
  const initRes = await postMcp(mcp.url, INIT_REQUEST, headers)
  const initMsg = parseHttpMessage(await initRes.text())
  if (initMsg.id !== 1) throw new Error(`unexpected initialize response id: ${initMsg?.id ?? 'none'}`)
  const listRes = await postMcp(mcp.url, LIST_REQUEST, headers)
  const listMsg = parseHttpMessage(await listRes.text())
  if (listMsg.id !== 2) throw new Error(`unexpected tools/list response id: ${listMsg?.id ?? 'none'}`)
  if (listMsg.error) throw new Error(`tools/list error: ${JSON.stringify(listMsg.error).slice(0, 300)}`)
  const tools = Array.isArray(listMsg.result?.tools)
    ? listMsg.result.tools.map((t) => t?.name).filter((n) => typeof n === 'string' && n !== '')
    : []
  return tools
}

export async function postMcp(url, body, headers) {
  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(HANDSHAKE_TIMEOUT_MS),
    })
  } catch (err) {
    throw new Error(`http request failed: ${sanitizeError(err.message)}`)
  }
  if (!res.ok) throw new Error(`http ${res.status} ${res.statusText ?? ''}`.trim())
  return res
}

/** Parse a streamable-http response: plain JSON object or SSE `data:` events. */
export function parseHttpMessage(text) {
  const trimmed = String(text).trim()
  if (trimmed.startsWith('{')) return JSON.parse(trimmed)
  for (const line of trimmed.split(/\r?\n/)) {
    const match = line.match(/^data:\s?(.*)$/)
    if (!match) continue
    const payload = match[1].trim()
    if (payload === '') continue
    try {
      const obj = JSON.parse(payload)
      if (obj && typeof obj === 'object' && obj.id !== undefined) return obj
    } catch {
      /* try the next data line */
    }
  }
  throw new Error('no JSON-RPC message found in HTTP response')
}

/**
 * Whether `name` can only be provided by the host patch layer.  Only these
 * names are filtered against the detection inventory; everything else is
 * guaranteed by the standard composition and stays untouched.
 */
export function isHostDependent(name) {
  if (name.startsWith('mcp__')) return true
  return KNOWN_HOST_PLUGINS.some((p) => p.tools.includes(name))
}

export function pluginLabel(plugin) {
  return String(plugin.match).replace(/^\//, '').replace(/\/$/, '')
}

/** Human reason for removing `name` from an allow list. */
export function removedReason(name, mcpReports) {
  if (name.startsWith('mcp__')) {
    const [, serverName, tool] = name.split('__')
    const report = mcpReports.find((r) => r.serverName === serverName)
    if (!report) return `${serverName} MCP 未启用`
    if (report.source === 'failed') return `${serverName} MCP 握手失败: ${report.error}`
    return `${serverName} MCP 未提供工具 ${tool}`
  }
  const plugin = KNOWN_HOST_PLUGINS.find((p) => p.tools.includes(name))
  if (plugin) return `${pluginLabel(plugin)} 已停用`
  return 'host 工具未启用'
}
