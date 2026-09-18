    // ── 委派事件流行（tool.call.toolview 键控行替换）────────────────────────
    // 事件流里每个工具调用行由 ToolCallTree 按 toolName 查 tool.call.toolview
    // 键控插槽，键命中则整行替换成注册组件（bash / read / grep / cordis 等都
    // 走这条路）。这里为庖丁的委派工具（内置四角色 + 自定义角色名）注册行：
    // 标题 = 显示名（roles.<toolName>.name，未配走中文缺省映射 / toolName），
    // 副题 = 调用参数 description（模型写的任务一句话），尾部状态点，点击展开
    // 子 agent 返回文本——通用行的结果查看能力不能丢。
    // 边界：只管工具调用行；子 agent 会话树 / 面包屑标题来自服务端会话摘要，
    // 不在客户端控制面。标题取全局配置的显示名（行渲染时不知道会话属于哪个
    // 工作区，工作区级显示名够不着）。
    var DELEGATE_TITLE_FALLBACK = {
      search_external: "外部检索",
      design: "设计",
      implement: "实现",
      search_internal_deep: "深搜",
    };
    // 静态委派工具：不在 roles 键里（无条目、不可删不可改名），恒注册。
    var DELEGATE_STATIC_TOOLS = ["search_internal_deep"];

    function buildDelegateMeta(d) {
      var cfg = globalConfigOf(d) || (d && d.suggested) || {};
      var roles = (cfg && typeof cfg.roles === "object" && cfg.roles) || {};
      var removed = Array.isArray(cfg.roles_remove) ? cfg.roles_remove : [];
      var titles = {};
      var tools = DELEGATE_STATIC_TOOLS.slice();
      DELEGATE_STATIC_TOOLS.forEach(function (n) { titles[n] = DELEGATE_TITLE_FALLBACK[n] || n; });
      Object.keys(roles).forEach(function (n) {
        if (removed.indexOf(n) !== -1) return; // 已删内置角色：委派工具不存在，键命中不了，不注册
        if (tools.indexOf(n) === -1) tools.push(n);
        var nm = roles[n] && typeof roles[n].name === "string" ? roles[n].name.trim() : "";
        titles[n] = nm !== "" ? nm : (DELEGATE_TITLE_FALLBACK[n] || n);
      });
      return { titles: titles, tools: tools };
    }

    var delegateMeta = { titles: {}, tools: [] };
    var delegateRowsDispose = null;
    var delegateRowsCtx = null;

    // 调用块是双形态（与宿主 toolRowModel 同源判据）：进行中块无 kind、
    // 参数在 block.argsRaw；结算块有 kind、参数挪进 block.call.argsRaw，
    // 结果在 block.content，error.code === "interrupted" 表示被停。
    function delegateArgsRawOf(block) {
      if (!block || typeof block !== "object") return "";
      var raw = "kind" in block
        ? (block.call && typeof block.call.argsRaw === "string" ? block.call.argsRaw : "")
        : (typeof block.argsRaw === "string" ? block.argsRaw : "");
      return raw || "";
    }

    function delegateStatusOf(block) {
      if (!block || typeof block !== "object" || !("kind" in block)) return "running";
      if (block.error && block.error.code === "interrupted") return "stopped";
      if (block.isError || block.error) return "error";
      return "done";
    }

    // 展开用的结果文本：文本块原文 + 其余块 pretty JSON；空内容回落错误行。
    function delegateResultText(block) {
      var parts = [];
      var content = block && Array.isArray(block.content) ? block.content : [];
      for (var i = 0; i < content.length; i++) {
        var c = content[i];
        if (c && c.type === "text" && typeof c.text === "string") parts.push(c.text);
        else if (c) parts.push(JSON.stringify(c, null, 2));
      }
      if (parts.length === 0 && block && block.error) {
        parts.push((block.error.name || "error") + ": " + (block.error.code || ""));
      }
      return parts.join("\n");
    }

    function DelegateRow(props) {
      var block = props && props.block ? props.block : {};
      var toolName = (props && props.toolName) || "";
      var _o = useState(false), open = _o[0], setOpen = _o[1];
      var args = {};
      var argsRaw = delegateArgsRawOf(block);
      if (argsRaw !== "") {
        try {
          var parsed = JSON.parse(argsRaw);
          if (parsed && typeof parsed === "object") args = parsed;
        } catch (err) { /* 原始参数非 JSON：忽略，副题留空 */ }
      }
      var desc = typeof args.description === "string" ? args.description.trim() : "";
      var prompt = typeof args.prompt === "string" ? args.prompt : "";
      var status = delegateStatusOf(block);
      var stateCls = status === "running" ? "pd-delegateRunning" : (status === "error" ? "pd-delegateFailed" : (status === "stopped" ? "pd-delegateStopped" : "pd-delegateDone"));
      var stateGlyph = status === "running" ? "◌" : (status === "error" ? "✕" : (status === "stopped" ? "⊘" : "✓"));
      var title = delegateMeta.titles[toolName] || DELEGATE_TITLE_FALLBACK[toolName] || toolName;
      return h("div", { className: "pd-delegateRow" + (status === "error" ? " pd-delegateErr" : "") },
        h("button", {
          type: "button",
          className: "pd-delegateHead",
          "aria-expanded": open ? "true" : "false",
          title: prompt ? prompt.slice(0, 400) : "",
          onClick: function () { setOpen(!open); },
        },
          h("span", { className: "pd-delegateState " + stateCls, "aria-hidden": "true" }, stateGlyph),
          h("span", { className: "pd-delegateTitle" }, title),
          desc ? h("span", { className: "pd-delegateDesc" }, desc) : null,
          h("span", { className: open ? "pd-delegateChev pd-delegateChevOpen" : "pd-delegateChev", "aria-hidden": "true" }, "▸")),
        open ? h("pre", { className: "pd-delegateBody" }, delegateResultText(block)) : null);
    }

    // 重注册：先撤旧键（inject 返回处置器，dsh-mnemon 同款用法），再按当前
    // 名单重建——自定义角色增删 / 显示名改动后由 refreshDelegateRows 触发。
    function syncDelegateRows() {
      if (delegateRowsDispose) {
        try { delegateRowsDispose(); } catch (err) { /* 撤旧失败不阻断重建 */ }
        delegateRowsDispose = null;
      }
      var ctx = delegateRowsCtx;
      if (!ctx || !ctx.slots || typeof ctx.slots.inject !== "function" || typeof ctx.slots.register !== "function") return;
      if (delegateMeta.tools.length === 0) return;
      delegateRowsDispose = ctx.slots.inject("tool.call.toolview", function () {
        var disposers = [];
        try {
          delegateMeta.tools.forEach(function (n) {
            disposers.push(ctx.slots.register({ name: "tool.call.toolview", key: n }, DelegateRow));
          });
        } catch (err) {
          disposers.forEach(function (d) { try { d(); } catch (e2) { /* 连锁失败静默 */ } });
          throw err;
        }
        return function () { disposers.forEach(function (d) { try { d(); } catch (e2) { /* 静默 */ } }); };
      });
    }

    function refreshDelegateRows() {
      paodingApi("state").then(function (d) {
        var next = buildDelegateMeta(d);
        // 比对串必须并进 titles 的值：显示名单独变更时键集合不变，只比键会
        // 漏判，事件流委派行标题刷不出来。
        var oldKeys = Object.keys(delegateMeta.titles).sort().map(function (k) { return k + ":" + delegateMeta.titles[k]; }).join("|")
          + "//" + delegateMeta.tools.slice().sort().join("|");
        var newKeys = Object.keys(next.titles).sort().map(function (k) { return k + ":" + next.titles[k]; }).join("|")
          + "//" + next.tools.slice().sort().join("|");
        if (newKeys !== oldKeys) {
          delegateMeta = next;
          syncDelegateRows();
        }
      }).catch(function () { /* 静默：行回落通用卡片 */ });
    }

    function mountDelegateRows(ctx) {
      if (typeof document === "undefined") return function () {};
      delegateRowsCtx = ctx;
      refreshDelegateRows();
      var offReset = null;
      if (ctx && typeof ctx.on === "function") {
        try {
          var r = ctx.on("connection/reset", function () { refreshDelegateRows(); });
          if (typeof r === "function") offReset = r;
        } catch (err) { /* 事件口不可用：仅失去断线重连后的刷新 */ }
      }
      return function () {
        if (delegateRowsDispose) { try { delegateRowsDispose(); } catch (err) { /* 静默 */ } }
        delegateRowsDispose = null;
        if (offReset) { try { offReset(); } catch (err) { /* 静默 */ } }
        delegateRowsCtx = null;
      };
    }

