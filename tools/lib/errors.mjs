/**
 * 面向用户的错误码单表（借自 dsh-superagent 的 USER_ERRORS 设计）：
 * code → { status, kind, message }。HTTP 路由层（plugins/paoding-config-ui）
 * 的所有 4xx 响应从此表取码，响应体在既有 { error } 之外纯增量附带 { code }——
 * 脚本 / 面板按 code 分支（本地化、重载提示），不再解析中文文案。
 *
 * kind 语义（与 dsh-superagent 对齐）：
 *   - missing  → 资源不存在（404 族）
 *   - refused  → 请求被拒（400/422/413 族；请求本身可改后重试）
 *   - conflict → 并发/状态冲突（409 族；需先重载或等待）
 *
 * message 为服务端默认文案（含 {占位符}，interpolate 填充）；面板按
 * api.err.<code> 本地化，缺 key 回落本文案。新增错误 = 加一行；错误码一经
 * 发布不再改名（对外契约），只允许追加与文案修正。
 */

export const USER_ERRORS = {
  // —— 409 conflict ——
  apply_in_flight: { status: 409, kind: 'conflict', message: '已有一次应用（apply）正在进行，请稍后重试' },
  config_stale: {
    status: 409,
    kind: 'conflict',
    message: '配置已被其他入口（面板 / API / CLI / 手编）修改，请重新加载后再保存（baseRevision 过期）',
  },
  // —— 404 missing ——
  route_not_found: { status: 404, kind: 'missing', message: 'no such route: {route}' },
  preset_not_found: { status: 404, kind: 'missing', message: '未找到预设: {presetId}' },
  backup_not_found: { status: 404, kind: 'missing', message: '备份不存在: {file}' },
  // —— 403 refused ——
  forbidden: { status: 403, kind: 'refused', message: 'forbidden' },
  preset_delete_forbidden: {
    status: 403,
    kind: 'refused',
    message: '全局 orchestrator 预设不支持删除：插件启动自愈会自动重装；卸载请移除 dsh-paoding 插件',
  },
  // —— 422 refused：请求参数 ——
  workspace_path_missing: { status: 422, kind: 'refused', message: '缺少工作区目录绝对路径（{where}）' },
  workspace_not_dir: { status: 422, kind: 'refused', message: '目录不存在或不是目录：{path}' },
  assignments_missing: { status: 422, kind: 'refused', message: '缺少预设配置（body.assignments）' },
  config_text_missing: { status: 422, kind: 'refused', message: '缺少配置文本（body.content）' },
  // 生成/安装管线失败（零工具角色、配置不可信护栏等）：message 由调用方带入
  //（installAssignments / generateAndInstall 抛出的原始错误），code 恒定。
  generation_failed: { status: 422, kind: 'refused', message: '{message}' },
  // —— 请求体（readBody）——
  body_too_large: { status: 413, kind: 'refused', message: '请求体超过大小上限' },
  body_invalid_json: { status: 400, kind: 'refused', message: '请求体不是合法 JSON' },
}

/** 占位符插值：{name} → values.name（缺省保留原样；split/join 防替换串 $ 模式）。 */
function interpolate(text, values = {}) {
  let out = String(text)
  for (const [key, value] of Object.entries(values)) {
    out = out.split(`{${key}}`).join(String(value))
  }
  return out
}

/**
 * 构造一个带 statusCode 的用户错误（路由层 json(res, err.statusCode, ...) 或
 * 外层 catch 统一回包）。values 填充 message 占位符；err.data 携带 { code } 供
 * 响应体附带。
 */
export function userError(code, values = {}, extra = {}) {
  const entry = USER_ERRORS[code]
  if (entry === undefined) {
    throw new Error(`unknown error code: ${code}（USER_ERRORS 单表缺行）`)
  }
  const err = new Error(interpolate(entry.message, values))
  err.statusCode = entry.status
  err.code = code
  err.data = { code, ...extra }
  return err
}

/** 直接取 { status, message(插值后), code }（不走 Error 对象的轻量调用点用）。 */
export function errorPayload(code, values = {}, extra = {}) {
  const entry = USER_ERRORS[code]
  if (entry === undefined) {
    throw new Error(`unknown error code: ${code}（USER_ERRORS 单表缺行）`)
  }
  return { status: entry.status, code, error: interpolate(entry.message, values), ...extra }
}
