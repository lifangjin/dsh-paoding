    // ── 工作区选择（配置对象）助手 ───────────────────────────────────────

    // 剥掉两个非目标字段容器键后的全局配置副本：existing 里现在还带 workspaces /
    // profile，工作区视角回落全局时不能把它们当目标字段读。返回 null 表示无。
    function globalConfigOf(d) {
      var existing = d && d.existing;
      if (!existing || typeof existing !== "object") return null;
      var out = Object.assign({}, existing);
      delete out.workspaces;
      delete out.profile;
      return out;
    }

    // 工作区标签条收纳个数的初值与兜底：测量未就绪（首帧）或环境不支持
    // ResizeObserver 时按这个数拆可见区 / 隐藏区；正常路径的收纳个数由装填
    // 算法按标签行实宽决定（见 ConfigPanel 的 tabsRowWidth / wsFitCount）。
    var WS_TABS_FALLBACK_COUNT = 5;

    // 工作区 pill 数据行：宿主注册表列表（GET /api/paoding/workspaces）为主，
    // state.existing.workspaces 里多出的键（宿主列表不可用 / 尚未在 GUI 注册）
    // 补在后面——「配置文件里出现过的工作区」必须永远可见、可切换。
    function workspaceRowsOf(d, list) {
      var rows = [];
      var seen = {};
      (list || []).forEach(function (it) {
        if (!it || typeof it.path !== "string" || it.path === "" || seen[it.path]) return;
        seen[it.path] = true;
        rows.push({
          path: it.path,
          title: typeof it.title === "string" && it.title !== "" ? it.title : null,
          sessionCount: typeof it.sessionCount === "number" ? it.sessionCount : null,
        });
      });
      var wsCfg = (d && d.existing && d.existing.workspaces) || {};
      Object.keys(wsCfg).forEach(function (p) {
        if (seen[p]) return;
        seen[p] = true;
        rows.push({ path: p, title: null, sessionCount: null });
      });
      return rows;
    }

    // pill 文案：宿主 title 优先，缺省回落路径 basename（宿主列表不可用的降级行）。
    function wsLabelOf(row) {
      if (row.title) return row.title;
      var parts = String(row.path).replace(/[\/\\]+$/, "").split(/[\/\\]/); // Windows 路径按 \ 也能取到 basename
      return parts[parts.length - 1] || row.path;
    }

    // 工作区配置状态三态（tab / 菜单项共用的小标签）：
    //   project —— 专属预设已生成（orchestrator-<slug> 已落盘，项目配置生效）
    //   pending —— 配置里存了工作区条目、但预设还没生成（编辑过没应用）
    //   global  —— 没有任何条目（新会话跟随全局 orchestrator 预设）
    // 判定优先级 installed > existing 条目 > 无。existing.workspaces 是磁盘
    // 配置原文透传，meta 的 installed 对账 installedPresets。
    function wsTagOf(existingWs, meta, wsPath) {
      var m = meta && meta[wsPath];
      if (m && m.installed) return "project";
      if (existingWs && Object.prototype.hasOwnProperty.call(existingWs, wsPath)) return "pending";
      return "global";
    }

    // 三态 → 标签文案（中文，与 tooltip 口径一致）
    function wsTagTextOf(kind) {
      return kind === "project" ? "项目" : kind === "pending" ? "待应用" : "全局";
    }

    // 角色卡「默认展开」判定单一来源（toggleRole / roleCard 共用）：主 agent
    // 与外部检索卡默认展开，其余默认收起；openMap 显式开关优先。
    function defaultOpenOf(name) {
      return name === "__main__" || name === "search_external";
    }

    // 工作区 tab / 「更多」菜单项共用的 title 提示串（两处渲染同款拼法，抽
    // 一处防漂移）：路径 + 会话数 + 配置状态（项目 / 待应用 / 全局）。
    function wsTabTipOf(row, meta, existingWs) {
      var m = meta && meta[row.path];
      var kind = wsTagOf(existingWs, meta, row.path);
      return row.path +
        (row.sessionCount != null ? " · " + row.sessionCount + " 会话" : "") +
        (kind === "project"
          ? " · 项目配置（预设 " + (m && m.presetId) + "）"
          : kind === "pending"
            ? " · 已保存项目配置、预设未生成（点「保存并应用」生效）"
            : " · 跟随全局配置");
    }

    // 工作区 tab 的显示顺序：按会话数降序（缺失沉底、同分保持注册表顺序），
    // 激活项再恒置顶（紧跟「全局默认」之后）。收纳装填按这个顺序进行，激活
    // tab 自然永远留在可见区；「更多」按钮上的 omd-tabMoreActive 兜底分支
    // 保留（万一首帧测量未就绪）。
    function wsDisplayOrderOf(rows, activeWs) {
      // 会话数从多到少：常用工作区靠前，冷门的自然沉进「更多」菜单。缺失
      //（null）按 -1 处理沉底；同分保持注册表顺序（V8 的 sort 稳定，不抖）。
      var order = rows.slice().sort(function (a, b) {
        var ca = a && a.sessionCount != null ? a.sessionCount : -1;
        var cb = b && b.sessionCount != null ? b.sessionCount : -1;
        return cb - ca;
      });
      if (activeWs === null) return order;
      // 激活项恒置顶（紧跟「全局默认」）：装填按此顺序进行，正在操作的 tab
      // 永远不会被收进「更多」。
      for (var i = 0; i < order.length; i++) {
        if (order[i].path === activeWs && i > 0) {
          var active = order.splice(i, 1)[0];
          order.unshift(active);
          break;
        }
      }
      return order;
    }

    // 「添加工作区」组合框建议行：服务端候选（GET workspaces?discover=1 的
    // items）按当前输入做子串过滤——完整路径或 basename 命中即可，不分大小写；
    // 空输入 = 全部候选。没拉到候选（null）或无匹配时返回空数组，调用方据此
    // 整块不渲染下拉。
    function wsSuggestionsOf(cands, query) {
      if (!Array.isArray(cands) || !cands.length) return [];
      var q = String(query || "").trim().toLowerCase();
      if (q === "") return cands.slice();
      return cands.filter(function (c) {
        return (typeof c.path === "string" && c.path.toLowerCase().indexOf(q) !== -1) ||
          (typeof c.basename === "string" && c.basename.toLowerCase().indexOf(q) !== -1);
      });
    }

