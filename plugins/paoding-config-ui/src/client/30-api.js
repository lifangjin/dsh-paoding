    // ── 服务端 API 助手（PageShell 与 ConfigPanel 共用）──────────────────────
    // GET（无 body）/ POST（有 body）对 /api/paoding/*，非 2xx 抛 Error。
    // 服务端失败响应可能带排障附件（如 upgrade 的子进程输出尾部），Error 只有
    // message 装不下它——挂到 error.output 上，调用方 catch 侧自行取舍（见
    // PageShell doUpgrade 的尾部并入）。
    // 总超时（models 等慢路由同限）：请求挂死时按超时报错，不让按钮永久转圈。
    var PAODING_API_TIMEOUT_MS = 60000;

    function paodingApi(path, body) {
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
            var err = new Error((d && d.error) || ("HTTP " + r.status));
            if (d && typeof d.output === "string" && d.output) err.output = d.output;
            throw err;
          }
          if (!d) throw new Error("HTTP " + r.status + "（响应不是 JSON）");
          return d;
        });
      }).catch(function (err) {
        if (ctrl && err && err.name === "AbortError") throw new Error("请求超时（" + (PAODING_API_TIMEOUT_MS / 1000) + "s 无响应）");
        throw err;
      }).finally(function () {
        if (timer !== null) clearTimeout(timer);
      });
    }

