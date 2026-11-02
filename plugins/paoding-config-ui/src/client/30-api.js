    // ── 服务端 API 助手（PageShell 与 ConfigPanel 共用）──────────────────────
    // GET（无 body）/ POST（有 body）对 /api/paoding/*，非 2xx 抛 Error。
    // 服务端失败响应可能带排障附件（如 upgrade 的子进程输出尾部），Error 只有
    // message 装不下它——挂到 error.output 上，调用方 catch 侧自行取舍（见
    // PageShell doUpgrade 的尾部并入）。
    // 总超时（models 等慢路由同限）：请求挂死时按超时报错，不让按钮永久转圈。
    var PAODING_API_TIMEOUT_MS = 60000;

    // ── 配置版本链 revision 跟踪（乐观并发 CAS）────────────────────────────
    // GET state 的 configRevision 与每次写响应的 revision 就地更新；写路由的
    // POST body 自动附带 baseRevision（服务端与磁盘不一致 → 409 config_stale，
    // 见 tools/lib/history.mjs）。老宿主（无版本链）响应里没有该字段 → 恒
    // null，不附带，行为与旧版完全一致。
    var PAODING_REVISION = null;
    // baseRevision 只对「写配置」路由附带（preview 是干跑、rescan/models 等
    // 只读路由附带了也无人消费；统一白名单，不猜服务端语义）。
    var PAODING_WRITE_ROUTES = { "apply": 1, "workspaces": 1, "config/import": 1, "config/restore": 1 };

    function paodingRevision() { return PAODING_REVISION; }
    function paodingSetRevision(n) {
      if (typeof n === "number" && isFinite(n) && n >= 0) PAODING_REVISION = Math.floor(n);
    }

    function paodingApi(path, body) {
      // 写路由 body 附加 baseRevision：浅拷贝再挂（不动调用方对象），已显式
      // 携带的（测试 / 特殊调用点）不覆盖；presets/* 的写子路由（POST/PUT/
      // DELETE）一并覆盖。
      var isWrite = PAODING_WRITE_ROUTES[path] === 1 || String(path || "").indexOf("presets/") === 0;
      if (body && typeof body === "object" && !Array.isArray(body) &&
          isWrite && PAODING_REVISION !== null && body.baseRevision === undefined) {
        body = Object.assign({}, body, { baseRevision: PAODING_REVISION });
      }
      var opts = body === undefined ? {} : {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      };
      // AbortController 超时；老环境没有该构造器就降级为无超时（功能不变）。
      var ctrl = typeof AbortController === "function" ? new AbortController() : null;
      var timer = null;
      if (ctrl) {
        opts.signal = ctrl.signal;
        timer = setTimeout(function () { ctrl.abort(); }, PAODING_API_TIMEOUT_MS);
      }
      return fetch("/api/paoding/" + path, opts).then(function (r) {
        // 先取全文再 JSON.parse：非 JSON 响应（代理错误页 / 空体）不再抛
        // SyntaxError，回落 HTTP <status> 的可读错误。
        return r.text().then(function (raw) {
          var d = null;
          try { d = raw ? JSON.parse(raw) : null; } catch (err) { d = null; }
          if (!r.ok) {
            // 错误码本地化：服务端 0.4.9 起所有 4xx 响应附带稳定 code（见
            // tools/lib/errors.mjs 单表）。api.err.<code> 有文案就用它（按 UI
            // 语言），没有回落服务端 message（仅中文）；generation_failed 的
            // 服务端 message 是具体生成错误原因（动态、必读），永不本地化覆盖。
            var msg = (d && d.error) || ("HTTP " + r.status);
            if (d && typeof d.code === "string" && d.code !== "generation_failed") {
              var key = "api.err." + d.code;
              var loc = t(key);
              if (loc !== key) msg = loc;
            }
            var err = new Error(msg);
            if (d && typeof d.code === "string") err.code = d.code;
            if (d && typeof d.currentRevision === "number") err.currentRevision = d.currentRevision;
            if (d && typeof d.output === "string" && d.output) err.output = d.output;
            // 结构化体检结果（preview/apply 的 422 会把 warnings 一并带回，如
            // 零工具角色的可读说明）：message 装不下多条，挂 error.warnings，
            // 调用方 catch 侧渲染成检查提示卡（见 ConfigPanel 的 warnState）。
            if (d && Array.isArray(d.warnings)) err.warnings = d.warnings;
            throw err;
          }
          if (!d) throw new Error(t("api.notJson", { status: r.status }));
          // revision 就地跟踪：state 的 configRevision（读取基线）与写响应的
          // revision（写后最新）统一进 PAODING_REVISION。
          if (typeof d.configRevision === "number") paodingSetRevision(d.configRevision);
          if (typeof d.revision === "number") paodingSetRevision(d.revision);
          return d;
        });
      }).catch(function (err) {
        if (ctrl && err && err.name === "AbortError") throw new Error(t("api.timeout", { s: PAODING_API_TIMEOUT_MS / 1000 }));
        throw err;
      }).finally(function () {
        if (timer !== null) clearTimeout(timer);
      });
    }
