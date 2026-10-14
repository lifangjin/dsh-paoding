      // ── 渲染 ───────────────────────────────────────────────────────────────

      // 配置对象标签页（tablist）：「全局默认」+ 各工作区（preset 已生成的
      // 前缀小圆点标记，元数据来自 state.workspaceMeta）+「更多」下拉 + 末尾
      // 「＋ 添加工作区」按钮（点击打开输入弹窗，弹窗由 wsModalOf 渲染）。露出
      // 几个 tab 不再是固定数：ConfigPanel 的装填算法按标签行实宽算出
      // wsFitCount，本函数照它拆可见 / 隐藏两段；行内另挂一个常驻隐藏测量层
      // （omd-tabsMeasure）供算法读每个 tab 的自然宽度，测量未就绪时
      // wsFitCount 停在兜底值 5（WS_TABS_FALLBACK_COUNT）。tab 点击语义与旧
      // pill 行一致 = switchWorkspace（逻辑不动，只换了皮）。
      function workspaceBarOf() {
        var rows = workspaceRowsOf(data, wsList);
        var meta = (data && data.workspaceMeta) || {};
        var existingWs = (data && data.existing && data.existing.workspaces) || {};
        // 可见 / 隐藏拆分：显示顺序里激活工作区恒排最前，它天然留在可见区；
        // 下标落在 wsFitCount 之后的收进「更多」菜单。
        var order = wsDisplayOrderOf(rows, activeWs);
        var visible = order.slice(0, Math.min(order.length, wsFitCount));
        var hidden = order.slice(visible.length);
        var tabs = [h("button", {
          key: "__global__",
          type: "button",
          role: "tab",
          "aria-selected": activeWs === null ? "true" : "false",
          className: "omd-tab" + (activeWs === null ? " omd-tabActive" : ""),
          title: t("ws.globalTabTip"),
          onClick: function () { switchWorkspace(null); },
        }, h("span", { className: "omd-tabText" }, t("ws.globalTab")))];
        tabs = tabs.concat(visible.map(function (row) {
          var kind = wsTagOf(existingWs, meta, row.path);
          var tip = wsTabTipOf(row, meta, existingWs);
          return h("button", {
            key: row.path,
            type: "button",
            role: "tab",
            "aria-selected": activeWs === row.path ? "true" : "false",
            className: "omd-tab" + (activeWs === row.path ? " omd-tabActive" : ""),
            title: tip,
            onClick: function () { switchWorkspace(row.path); },
          },
            h("span", { className: "omd-tabText" }, wsLabelOf(row)),
            h("span", { className: "omd-tabTag omd-tabTag" + kind.charAt(0).toUpperCase() + kind.slice(1) },
              wsTagTextOf(kind)),
            row.sessionCount != null ? h("span", { className: "omd-tabCount" }, t("ws.sessionCount", { n: row.sessionCount })) : null);
        }));
        // 「更多」入口：仅在确有收进来的工作区时出现。正常路径激活项按显示
        // 顺序排最前、必然可见，这里仍兜底判一次——首帧 wsFitCount 还是兜底
        // 值时激活项可能暂居 hidden，就双挂 omd-tabMoreActive + omd-tabActive
        // 借用激活视觉（主色 + 激活条，CSS 不另画一份）。
        var hiddenActive = false;
        for (var k = 0; k < hidden.length; k++) {
          if (hidden[k].path === activeWs) { hiddenActive = true; break; }
        }
        if (hidden.length > 0) {
          tabs.push(h("button", {
            key: "__more__",
            type: "button",
            className: "omd-tab omd-tabMore" + (hiddenActive ? " omd-tabMoreActive omd-tabActive" : ""),
            title: t("ws.moreTip", { n: hidden.length }),
            "aria-haspopup": "listbox",
            "aria-expanded": wsMenuOpen ? "true" : "false",
            onClick: function () { setWsMenuOpen(!wsMenuOpen); },
          },
            h("span", { className: "omd-tabText" }, t("ws.more")),
            h("span", { className: "omd-tabMoreCount" }, String(hidden.length))));
        }
        // 末尾「＋ 添加工作区」：与 tab 同尺寸的弱化按钮（ghost），点击打开输入弹窗。
        tabs.push(h("button", {
          key: "__add__",
          type: "button",
          className: "omd-tab omd-tabAdd",
          title: t("ws.addTabTip"),
          disabled: busy,
          onClick: function () { setWsAddOpen(true); setWsAddErr(""); },
        },
          h("span", { className: "omd-groupIcon" }, ic(P.IconPlusOutline16, 14)),
          h("span", { className: "omd-tabText" }, t("ws.addTab"))));
        // 测量层单件：与真实 tab 同款 .omd-tab 类，自然宽度因此一致；不进
        // a11y 树、不可聚焦，只负责被装填算法 offsetWidth 量。
        function measureTabOf(key, label) {
          return h("button", { type: "button", "data-ws-key": key, className: "omd-tab", tabIndex: -1 },
            h("span", { className: "omd-tabText" }, label));
        }
        // 行包裹层 omd-tabsRow：给「更多」下拉做锚点——挂在整列容器上的话
        // top:100% 会落到提示行下面，视觉上和标签行脱节；锚在行包裹层上，
        // 下拉恰好贴着标签行的下边框展开。
        return h("div", { className: "omd-wsTabs" },
          h("div", { className: "omd-tabsRow" },
          h("div", { className: "omd-tabs", role: "tablist", "aria-label": t("ws.tablistLabel"), ref: tabsRowRef }, tabs),
          // 宽度测量层：常驻渲染（不随 wsFitCount 变），挪出视口且不可见，只把
          // 各 tab 的自然宽度喂给装填算法。「更多」原型计数固定写 99 按两位数
          // 算宽，与装填里的 SAFETY 余量搭配。
          h("div", { className: "omd-tabsMeasure", ref: tabsMeasureRef, "aria-hidden": "true" },
            measureTabOf("__global__", t("ws.globalTab")),
            order.map(function (row) {
              var m = meta[row.path];
              var mk = wsTagOf(existingWs, meta, row.path);
              return h("button", { key: row.path, type: "button", "data-ws-key": row.path, className: "omd-tab", tabIndex: -1 },
                h("span", { className: "omd-tabText" }, wsLabelOf(row)),
                h("span", { className: "omd-tabTag omd-tabTag" + mk.charAt(0).toUpperCase() + mk.slice(1) },
                  wsTagTextOf(mk)),
                row.sessionCount != null ? h("span", { className: "omd-tabCount" }, t("ws.sessionCount", { n: row.sessionCount })) : null);
            }),
            h("button", { type: "button", "data-ws-key": "__more__", className: "omd-tab omd-tabMore", tabIndex: -1 },
              h("span", { className: "omd-tabText" }, t("ws.more")),
              h("span", { className: "omd-tabMoreCount" }, "99")),
            h("button", { type: "button", "data-ws-key": "__add__", className: "omd-tab omd-tabAdd", tabIndex: -1 },
              h("span", { className: "omd-groupIcon" }, ic(P.IconPlusOutline16, 14)),
              h("span", { className: "omd-tabText" }, t("ws.addTab")))),
          // 「更多」下拉：菜单项信息结构与 tab 同款（小圆点 / 名称 / 会话数，
          // title 拼法也一致），点击直接切过去。role=listbox/option 表达
          // 「从清单里选一个配置对象」的语义，aria-selected 标当前项。
          wsMenuOpen && hidden.length > 0
            ? h("div", { className: "omd-tabMenu", role: "listbox", "aria-label": t("ws.menuLabel") },
                hidden.map(function (row) {
                  var kind = wsTagOf(existingWs, meta, row.path);
                  var tip = wsTabTipOf(row, meta, existingWs);
                  return h("button", {
                    key: row.path,
                    type: "button",
                    role: "option",
                    "aria-selected": activeWs === row.path ? "true" : "false",
                    className: "omd-tabMenuItem" + (activeWs === row.path ? " omd-tabMenuItemActive" : ""),
                    title: tip,
                    onClick: function () { setWsMenuOpen(false); switchWorkspace(row.path); },
                  },
                    h("span", { className: "omd-tabText" }, wsLabelOf(row)),
                    h("span", { className: "omd-tabTag omd-tabTag" + kind.charAt(0).toUpperCase() + kind.slice(1) },
                      wsTagTextOf(kind)),
                    row.sessionCount != null ? h("span", { className: "omd-tabCount" }, t("ws.sessionCount", { n: row.sessionCount })) : null);
                }))
            : null),
          h("div", { className: "omd-hint" },
            t("ws.barHint")));
      }

      // 「添加工作区」弹窗：旧版是 tab 条下方的内联展开行，改为模态框输入。
      // 右上 × / 取消 / 点遮罩空白处 / Esc 都只收弹窗（Esc 分层见上方捕获级
      // useEffect）；确认按钮与输入框 Enter 走 submitWorkspace——成功路径自己
      // 关弹窗、刷新列表并切到新工作区，这里不重复收尾。
      function wsModalOf() {
        if (!wsAddOpen) return null;
        // 建议行：候选按当前输入子串过滤（下拉展开才算）；没拉到候选或无匹配
        // 时是空数组，下拉整块不渲染。（随旧内联行整体迁入弹窗）
        var wsSuggestRows = wsSuggestOpen ? wsSuggestionsOf(wsCands, wsAddPath) : [];
        return h("div", { className: "pd-modalMask",
            // 只点遮罩空白处才收（mousedown 真正落在遮罩上），在卡片内按下拖选不误关
            onMouseDown: function (e) { if (e.target === e.currentTarget) closeWsModal(); } },
          h("div", { className: "pd-modalCard", role: "dialog", "aria-modal": "true", "aria-label": t("ws.addTitle") },
            h("div", { className: "pd-modalHeader" },
              h("h2", { className: "pd-modalTitle" }, t("ws.addTitle")),
              h("button", { type: "button", className: "pd-modalClose", "aria-label": t("common.close"), onClick: closeWsModal },
                h("span", { className: "pd-closeGlyph", "aria-hidden": "true" }, "×"))),
            h("div", { className: "pd-modalBody" },
              h("label", { className: "pd-modalLabel" }, t("ws.pathLabel")),
              h("div", { className: "omd-wsSuggestWrap" },
                h("input", {
                  type: "text",
                  className: "omd-nameInput omd-wsAddInput",
                  value: wsAddPath,
                  placeholder: t("ws.pathPlaceholder"),
                  spellCheck: false,
                  autoFocus: true,
                  onFocus: function () { loadWsCands(); setWsSuggestOpen(true); },
                  onBlur: function () { setWsSuggestOpen(false); },
                  onChange: function (e) { setWsAddPath(e.target.value); setWsSuggestOpen(true); },
                  // 只认 Enter；Esc 不在这里拦——捕获级监听（见上方 useEffect）
                  // 在 document 上先截停并 stopPropagation，事件到不了 React
                  // 合成层，这里写 Escape 分支永远不会触发。
                  onKeyDown: function (e) {
                    if (e.key === "Enter") { setWsSuggestOpen(false); submitWorkspace(); }
                  },
                }),
                wsSuggestRows.length
                  ? h("div", { className: "omd-wsSuggest", role: "listbox" },
                      wsSuggestRows.map(function (c) {
                        return h("button", {
                          key: c.path,
                          type: "button",
                          className: "omd-wsSuggestItem",
                          title: c.path,
                          disabled: busy,
                          // mousedown 的默认行为会把焦点从输入框夺走，blur 先于
                          // click 把下拉卸载、点击就落空——preventDefault 掐掉它，
                          // input 保持聚焦，click 才能安稳到达建议行。
                          onMouseDown: function (e) { e.preventDefault(); },
                          onClick: function () {
                            setWsSuggestOpen(false);
                            setWsAddPath(c.path);
                            submitWorkspace(c.path);
                          },
                        },
                          h("span", { className: "omd-wsSuggestName" }, c.basename || c.path),
                          h("span", { className: "omd-wsSuggestPath" }, c.path));
                      }))
                  : null),
              wsAddErr ? statusRow("omd-statusError", ic(P.IconWarningOutline16, 16), wsAddErr) : null,
              h("div", { className: "omd-hint" }, t("ws.pathHint"))),
            h("div", { className: "pd-modalFooter" },
              h(P.Button, { variant: "outline", size: "md", disabled: busy, onClick: closeWsModal }, t("common.cancel")),
              h(P.Button, {
                variant: "primary",
                size: "md",
                disabled: busy || String(wsAddPath).trim() === "",
                onClick: submitWorkspace,
              }, busyOp === "wsadd" ? t("ws.adding") : t("ws.addConfirm")))));
      }

      // 「新建自定义 agent 角色」弹窗：结构 / 关闭路径与「添加工作区」弹窗
      // （wsModalOf）完全一致——右上 × / 取消 / 点遮罩空白处 / Esc 都只收弹窗
      //（Esc 分层见上方捕获级 useEffect）。两字段表单的 Enter 分工：toolName
      // 框 Enter 不提交（用户多半还想填显示名），只把焦点挪到显示名框；显示
      // 名框 Enter 才走 submitRoleAdd——成功路径自己关弹窗并清残值，这里不
      // 重复收尾。新建是纯本地 setAssign 操作，无请求，按钮不挂 busy 态。
      function roleAddModalOf() {
        if (!roleAddOpen) return null;
        return h("div", { className: "pd-modalMask",
            // 只点遮罩空白处才收（mousedown 真正落在遮罩上），在卡片内按下拖选不误关
            onMouseDown: function (e) { if (e.target === e.currentTarget) closeRoleAddModal(); } },
          h("div", { className: "pd-modalCard", role: "dialog", "aria-modal": "true", "aria-label": t("panel.roleAddTitle") },
            h("div", { className: "pd-modalHeader" },
              h("h2", { className: "pd-modalTitle" }, t("panel.roleAddTitle")),
              h("button", { type: "button", className: "pd-modalClose", "aria-label": t("common.close"), onClick: closeRoleAddModal },
                h("span", { className: "pd-closeGlyph", "aria-hidden": "true" }, "×"))),
            h("div", { className: "pd-modalBody" },
              h("label", { className: "pd-modalLabel" }, t("panel.roleAddToolNameLabel")),
              h("input", {
                type: "text",
                className: "omd-nameInput",
                value: roleAddName,
                placeholder: t("panel.roleAddNamePlaceholder"),
                spellCheck: false,
                autoFocus: true,
                onChange: function (e) { setRoleAddName(e.target.value); },
                // Enter 只移焦不提交：这是两字段表单的第一段，直接提交会跳过
                // 还没填的显示名。Esc 仍不在这里拦——捕获级监听（见上方
                // useEffect）在 document 上先截停并 stopPropagation，事件到不了
                // React 合成层，这里写 Escape 分支永远不会触发。
                onKeyDown: function (e) {
                  if (e.key === "Enter") {
                    var inp = roleAddDispRef.current; // 弹窗条件渲染，此刻必已挂载；仍判空兜极端时序
                    if (inp && typeof inp.focus === "function") inp.focus();
                  }
                },
              }),
              h("label", { className: "pd-modalLabel" }, t("panel.dispNameLabel")),
              h("input", {
                ref: roleAddDispRef,
                type: "text",
                className: "omd-nameInput",
                value: roleAddDispName,
                // 占位语义与 roleTitleBlock 的 subject=toolName 一致：留空 = 事件流标题回落 toolName
                placeholder: t("panel.dispNamePlaceholder"),
                spellCheck: false,
                onChange: function (e) { setRoleAddDispName(e.target.value); },
                // 第二段的 Enter 才是提交：第一段已把焦点送到这里，用户在此按
                // Enter 即视为整个表单填完。
                onKeyDown: function (e) {
                  if (e.key === "Enter") submitRoleAdd();
                },
              }),
              // 「会话模式」单选（与角色卡 roleBgModeBlock 同款语义）：缺省一次性，
              // 选「可续」才写 background_mode: 'continuable'；提示 / 警告行内联。
              h("label", { className: "pd-modalLabel" }, t("panel.bgModeLabel")),
              h("div", { className: "omd-nameRow" },
                h("label", { className: "omd-toolItem" },
                  h("input", {
                    type: "radio",
                    className: "omd-check",
                    name: "pd-bgm-roleadd",
                    checked: roleAddBgMode !== "continuable",
                    onChange: function () { setRoleAddBgMode("one-shot"); },
                  }),
                  h("span", { className: "omd-toolName" }, t("panel.bgOneshot"))),
                h("label", { className: "omd-toolItem" },
                  h("input", {
                    type: "radio",
                    className: "omd-check",
                    name: "pd-bgm-roleadd",
                    checked: roleAddBgMode === "continuable",
                    onChange: function () { setRoleAddBgMode("continuable"); },
                  }),
                  h("span", { className: "omd-toolName" }, t("panel.bgContinuable")))),
              roleAddBgMode === "continuable"
                ? h("div", { className: "omd-hint" }, roleBgContinuableHint())
                : null,
              roleAddBgMode === "continuable" && data && data.persistenceAvailable === false
                ? statusRow("omd-statusWarn", ic(P.IconWarningOutline16, 16), roleBgPersistenceWarn())
                : null,
              // 「启动方式」单选（与角色卡 roleStartModeBlock 同款语义）：缺省全新，
              // 选「继承对话」才写 start_mode: 'fork'（委派块块级 provider 行）。
              h("label", { className: "pd-modalLabel" }, t("panel.startModeLabel")),
              h("div", { className: "omd-nameRow" },
                h("label", { className: "omd-toolItem" },
                  h("input", {
                    type: "radio",
                    className: "omd-check",
                    name: "pd-sm-roleadd",
                    checked: roleAddStartMode !== "fork",
                    onChange: function () { setRoleAddStartMode("fresh"); },
                  }),
                  h("span", { className: "omd-toolName" }, t("panel.smFresh"))),
                h("label", { className: "omd-toolItem" },
                  h("input", {
                    type: "radio",
                    className: "omd-check",
                    name: "pd-sm-roleadd",
                    checked: roleAddStartMode === "fork",
                    onChange: function () { setRoleAddStartMode("fork"); },
                  }),
                  h("span", { className: "omd-toolName" }, t("panel.smFork")))),
              roleAddStartMode === "fork"
                ? h("div", { className: "omd-hint" },
                    t("panel.forkStartHint"))
                : null,
              roleAddErr ? statusRow("omd-statusError", ic(P.IconWarningOutline16, 16), roleAddErr) : null,
              h("div", { className: "omd-hint" },
                t("panel.roleAddHint"))),
            h("div", { className: "pd-modalFooter" },
              h(P.Button, { variant: "outline", size: "md", onClick: closeRoleAddModal }, t("common.cancel")),
              h(P.Button, {
                variant: "primary",
                size: "md",
                disabled: String(roleAddName).trim() === "",
                onClick: submitRoleAdd,
              }, t("panel.roleAddConfirm")))));
      }

      // 「重命名自定义角色」弹窗：结构 / 关闭路径与 roleAddModalOf 一致——
      // 右上 × / 取消 / 点遮罩空白处 / Esc 都只收弹窗（Esc 分层见 70 片段的
      // 捕获级 useEffect）。单字段表单：开窗预填旧名，Enter 直接提交（重命名
      // 没有第二段）；校验失败走弹窗内错误行，成功路径由 submitRoleRename 关
      // 弹窗并清残值。改的是 toolName（身份键），显示名不在此处。
      function roleRenameModalOf() {
        if (!roleRenameFor) return null;
        return h("div", { className: "pd-modalMask",
            // 只点遮罩空白处才收（mousedown 真正落在遮罩上），在卡片内按下拖选不误关
            onMouseDown: function (e) { if (e.target === e.currentTarget) closeRoleRenameModal(); } },
          h("div", { className: "pd-modalCard", role: "dialog", "aria-modal": "true", "aria-label": t("panel.roleRenameTitle") },
            h("div", { className: "pd-modalHeader" },
              h("h2", { className: "pd-modalTitle" }, t("panel.roleRenameTitle")),
              h("button", { type: "button", className: "pd-modalClose", "aria-label": t("common.close"), onClick: closeRoleRenameModal },
                h("span", { className: "pd-closeGlyph", "aria-hidden": "true" }, "×"))),
            h("div", { className: "pd-modalBody" },
              h("label", { className: "pd-modalLabel" }, t("panel.roleRenameLabel")),
              h("input", {
                type: "text",
                className: "omd-nameInput",
                value: roleRenameVal,
                placeholder: roleRenameFor || "", // 占位即旧名（输入框已预填，占位只在清空后可见）
                spellCheck: false,
                autoFocus: true,
                onChange: function (e) { setRoleRenameVal(e.target.value); },
                // Esc 不在这里拦——捕获级监听（见 70 片段 useEffect）在 document
                // 上先截停并 stopPropagation，事件到不了 React 合成层，这里写
                // Escape 分支永远不会触发。
                onKeyDown: function (e) {
                  if (e.key === "Enter") submitRoleRename();
                },
              }),
              roleRenameErr ? statusRow("omd-statusError", ic(P.IconWarningOutline16, 16), roleRenameErr) : null,
              h("div", { className: "omd-hint" },
                t("panel.roleRenameHint"))),
            h("div", { className: "pd-modalFooter" },
              h(P.Button, { variant: "outline", size: "md", onClick: closeRoleRenameModal }, t("common.cancel")),
              h(P.Button, {
                variant: "primary",
                size: "md",
                // 空值 / 与旧名相同都禁用确认：后者点确认只会空转收窗，禁用
                // 让按钮状态与「确实改了名」对齐。
                disabled: String(roleRenameVal).trim() === "" || String(roleRenameVal).trim() === roleRenameFor,
                onClick: submitRoleRename,
              }, t("panel.roleRenameConfirm")))));
      }

      if (!data || !assign) {
        // 面板没起来（含 state 加载失败）才走这条整页分支：失败渲染常驻错误行，
        // 不进 toast——此刻页面还没有内容可依托，错误必须一直可见。
        return h("div", { className: "pd-page" },
          error
            ? statusRow("omd-statusError", ic(P.IconWarningOutline16, 16), error)
            : h("div", { className: "omd-loading" },
                h("span", { className: "omd-spin" }, ic(P.IconLoadingOutline16, 16)),
                h("span", null, t("panel.loading"))));
      }

      // 技能网格数据源（主 agent 软引导/内联 + 下方角色 skills 分组共用）：
      // 工作区视角（activeWs 非空）且已拉到 wsSkills 时用「用户级 + 该工作区
      // 项目级」合并列表；全局视角 / 拉取中 / 拉取失败降级一律回落 state 的
      // 用户级技能 data.skills。gridProj 仅在合并生效时非空（项目角标据此渲染）。
      var gridSkills = activeWs !== null && Array.isArray(wsSkills) ? wsSkills : (data.skills || []);
      var gridProj = activeWs !== null && wsProjSkills ? wsProjSkills : null;

      // 技能网格作用域小字（分组标题旁）：说明当前网格覆盖的技能来源——
      // 全局 = 仅用户级技能；工作区 = 用户级 + 该工作区项目级技能。
      function skillScopeNote() {
        return h("span", { className: "omd-skillScope" },
          activeWs !== null ? t("panel.scopeWs") : t("panel.scopeGlobal"));
      }

      // 角色工具候选（三组网格共用数据源）：所有角色（内置 + 自定义）= SRC
      // allow 面 ∪ 核心工具清单 ∪ host 检测库存。内置角色在 SRC 面上再并核心
      // 工具候选——勾选才生效，默认勾选仍来自 suggested/staticBase，默认面不
      // 变；自定义角色无 SRC 基础面，自然回落核心清单（customCoreToolsOf：去
      // 四个委派名与 mcp__ 工具）。分组口径：mcp__ 前缀 → 「MCP 工具」；其余
      // 名字里在 inventory 中的 → 「插件工具」（mnemon_* 等直注册工具）；两者
      // 皆非 → 「基础工具」。全部拼接后按首次出现去重。
      function roleCandidateTools(name) {
        var base = ((data.blocks && data.blocks[name]) || []).concat(customCoreToolsOf(data));
        return base.concat(data.inventory || []).filter(function (t, i, arr) { return arr.indexOf(t) === i; });
      }

      function personaBlock(name) {
        var open = !!personaMap[name];
        return h("div", { className: "omd-persona" },
          h("button", {
            type: "button",
            className: "omd-personaToggle",
            "aria-expanded": open ? "true" : "false",
            onClick: function () { togglePersona(name); },
          },
            h("span", { className: open ? "omd-chevron omd-chevronOpen" : "omd-chevron" }, ic(P.IconChevronDownOutline14, 14)),
            h("span", null, t("panel.personaToggle")),
            h("span", { className: "omd-personaEdit" }, ic(P.IconEditOutline16, 14))),
          open ? h("div", { className: "omd-personaBody" },
            h("textarea", {
              key: "omd-persona-" + name + "-" + switchRev, // 切视角重挂：defaultValue 显示新目标的 persona
              className: "omd-textarea",
              defaultValue: assign.roles[name].persona || "",
              placeholder: t("panel.personaPlaceholder"),
              spellCheck: false,
              disabled: busy,
              onBlur: function (e) {
                setAssign(function (prev) {
                  var next = JSON.parse(JSON.stringify(prev));
                  next.roles[name].persona = e.target.value.trim() === "" ? null : e.target.value;
                  return next;
                });
              },
            }),
            h("div", { className: "omd-hint" }, t("panel.personaHint")))
          : null);
      }

      // 主 agent「人设追加」：折叠编辑器，结构与角色 personaBlock 一致。
      // textarea 显示生效文本 = 配置值 ?? 后端默认常量（mainPersonaExtraDefault）；
      // 清空保存 = ''（移除默认规则）；文本 == 默认常量时回落 null（跟随默认演进）。
      function mainPersonaExtraBlock() {
        var def = (data && data.mainPersonaExtraDefault) || "";
        var val = assign.main_agent_persona_extra == null ? def : assign.main_agent_persona_extra;
        return h("div", { className: "omd-persona" },
          h("button", {
            type: "button",
            className: "omd-personaToggle",
            "aria-expanded": extraOpen ? "true" : "false",
            onClick: function () { setExtraOpen(!extraOpen); },
          },
            h("span", { className: extraOpen ? "omd-chevron omd-chevronOpen" : "omd-chevron" }, ic(P.IconChevronDownOutline14, 14)),
            h("span", null, t("panel.extraToggle")),
            h("span", { className: "omd-personaEdit" }, ic(P.IconEditOutline16, 14))),
          extraOpen ? h("div", { className: "omd-personaBody" },
            h("textarea", {
              key: "omd-extra-" + extraRev + "-" + switchRev,
              className: "omd-textarea omd-extraArea",
              defaultValue: val,
              placeholder: t("panel.extraPlaceholder"),
              spellCheck: false,
              disabled: busy,
              onBlur: function (e) { setMainPersonaExtra(e.target.value); },
            }),
            h("div", { className: "omd-extraActions" },
              h("button", {
                type: "button",
                className: "omd-extraRestore",
                disabled: busy,
                onClick: restoreMainPersonaExtra,
              }, t("common.restoreDefault")),
              h("span", { className: "omd-extraHint" },
                t("panel.extraActionHint"))),
            h("div", { className: "omd-hint" }, t("panel.extraClearHint")))
          : null);
      }

      // 主 agent「显示名」行（main_agent_display_name）：仅替换 preset 显示名
      //（GUI 预设选择器里的名字），不动 persona 身份行——编排主 agent 的身份
      // 语义不属于可配置项，UI 不提供改名入口。默认文案
      // 「编排模式 (Orchestrator)」为后端默认常量，UI 侧硬编码做占位（后端
      // state 无该默认字段就不引，与 mainPersonaExtraDefault 处理思路一致）。
      // 写回校验与后端一致：trim 后 1-60 字符、不含 \r \n；空 = null（默认显示
      // 名，工作区预设用派生名）；非空纯空白视为非法（防误触把已有显示名静默
      // 清回默认）。
      function mainNameBlock() {
        var DEFAULT_NAME = "编排模式 (Orchestrator)";
        function commitDisplayName(raw) {
          var s = String(raw == null ? "" : raw);
          if (/[\r\n]/.test(s)) {
            toast.warn(t("panel.mainNameNewline"));
            setDisplayNameRev(displayNameRev + 1); // 重挂 input，回到上次生效值
            return;
          }
          var v = s.trim();
          if (s !== "" && v === "") {
            toast.warn(t("panel.mainNameBlank"));
            setDisplayNameRev(displayNameRev + 1);
            return;
          }
          if (v.length > 60) {
            toast.warn(t("panel.mainNameTooLong"));
            setDisplayNameRev(displayNameRev + 1);
            return;
          }
          setAssign(function (prev) {
            var next = JSON.parse(JSON.stringify(prev));
            next.main_agent_display_name = v === "" ? null : v; // null = 默认显示名
            return next;
          });
          if (v === "") setDisplayNameRev(displayNameRev + 1); // 清空 = 默认：重挂显示占位
        }
        function restoreMainDisplayName() {
          setAssign(function (prev) {
            var next = JSON.parse(JSON.stringify(prev));
            next.main_agent_display_name = null; // null = 默认显示名
            return next;
          });
          setDisplayNameRev(displayNameRev + 1);
        }
        return h("div", { className: "omd-mainName" },
          h("div", { className: "omd-glabel" }, t("panel.mainNameLabel")),
          h("div", { className: "omd-nameRow" },
            h("input", {
              key: "omd-displayName-" + displayNameRev + "-" + switchRev,
              type: "text",
              className: "omd-nameInput",
              defaultValue: assign.main_agent_display_name || "",
              placeholder: DEFAULT_NAME,
              spellCheck: false,
              disabled: busy,
              onBlur: function (e) { commitDisplayName(e.target.value); },
            }),
            h("button", { type: "button", className: "omd-extraRestore", disabled: busy, onClick: restoreMainDisplayName }, t("common.restoreDefault"))),
          h("div", { className: "omd-hint" },
            t("panel.mainNameHint")));
      }

      // 内置角色「显示名」input 重挂（key 技巧）：写回校验失败 / 清空回默认时
      // 让对应 input 以生效值重新挂载（defaultValue 重读）；每角色独立计数，
      // 互不牵连（其余内置角色 input 已提交的值不受影响）。
      function bumpRoleNameRev(name) {
        setRoleNameRev(function (prev) {
          var next = Object.assign({}, prev);
          next[name] = (next[name] || 0) + 1;
          return next;
        });
      }

      // 角色「专用模型 / provider」input 重挂（key 技巧）：与 roleNameRev 同款。
      // 仅降级手输模式（模型目录不可用）仍在用：校验失败 / 清空回默认时让对应
      // input 以生效值重新挂载；每角色独立计数，model 与 provider 两个 input
      // 共用同一 rev（成对重挂，不残留旧输入）。下拉模式为受控 select，无此需要。
      function bumpRoleModelRev(name) {
        setRoleModelRev(function (prev) {
          var next = Object.assign({}, prev);
          next[name] = (next[name] || 0) + 1;
          return next;
        });
      }

      // 角色「显示名」行（内置与自定义通用）：
      //   - 内置：替换默认 persona 首行身份句主语（persona 已自定义时后端
      //     忽略，仅提示），同时是事件流委派行的标题；
      //   - 自定义：后端不消费此字段（其 persona 全文自写），纯粹用作事件流
      //     委派行标题——不动 toolName / 调用名 / persona。
      // 校验与主 agent 名同源约束：trim 后 1-60 字符、不含 \r \n；
      // 空 / 纯空白 = 默认（写入 null = 事件流回落缺省标题）。
      function roleTitleBlock(name, isCustom) {
        var subject = isCustom ? name : (ROLE_DEFAULT_SUBJECT[name] || name);
        function commitRoleName(raw) {
          var s = String(raw == null ? "" : raw);
          if (/[\r\n]/.test(s)) {
            toast.warn(t("panel.roleNameNewline", { name: name }));
            bumpRoleNameRev(name); // 重挂 input，回到上次生效值
            return;
          }
          var v = s.trim();
          if (v.length > 60) {
            toast.warn(t("panel.roleNameTooLong", { name: name }));
            bumpRoleNameRev(name);
            return;
          }
          setAssign(function (prev) {
            var next = JSON.parse(JSON.stringify(prev));
            next.roles[name].name = v === "" ? null : v;
            return next;
          });
          if (v === "") bumpRoleNameRev(name); // 空 / 纯空白 = 默认：重挂显示占位
        }
        return h("div", { className: "omd-mainName" },
          h("div", { className: "omd-glabel" },
            isCustom ? t("panel.roleNameLabelCustom") : t("panel.roleNameLabelBuiltin")),
          h("div", { className: "omd-nameRow" },
            h("input", {
              key: "omd-roleName-" + name + "-" + ((roleNameRev && roleNameRev[name]) || 0) + "-" + switchRev,
              type: "text",
              className: "omd-nameInput",
              defaultValue: (assign.roles[name] && assign.roles[name].name) || "",
              placeholder: subject,
              spellCheck: false,
              disabled: busy,
              onBlur: function (e) { commitRoleName(e.target.value); },
            })),
          h("div", { className: "omd-hint" },
            isCustom
              ? t("panel.roleNameHintCustom", { name: name })
              : t("panel.roleNameHintBuiltin", { subject: subject })));
      }

      // 角色「专用模型」行（内置与自定义角色通用同一组件，签名不变）：
      //   - 下拉模式（模型目录可用）：单选 select，选项 = 「跟随主 agent 当前
      //     模型」（value ""）+ 目录里每个 (provider 路由, 模型) 一项；选中目录
      //     项即成对写入 roles[name].provider + model（生成层写入委派块
      //     agentOptions，含冷恢复在内固定）。目录外的已有配置值（手编配置、
      //     目录未刷新等）以「当前配置」选项保真显示并保持选中（round-trip
      //     保护，绝不凭空消失）。
      //   - 降级模式（目录拉取失败 / ok:false / 格式异常）：回退现状的 model +
      //     provider 双 input 手输，全部原有校验保留（禁换行、≤120、空 = null、
      //     provider 单配 hint），失败原因一句话进 omd-hint，不阻塞面板其余功能。
      function roleModelBlock(name) {
        var role = assign.roles[name] || {};

        // ── 降级模式：目录不可用 → 现状双 input ───────────────────────────
        if (!modelGroupsOk) {
          var rev = (roleModelRev && roleModelRev[name]) || 0;
          function labelOf(key) { return key === "provider" ? "provider" : t("panel.modelField"); }
          function commitRoleModel(key, raw) {
            var s = String(raw == null ? "" : raw);
            if (/[\r\n]/.test(s)) {
              toast.warn(t("panel.roleModelNewline", { name: name, field: labelOf(key) }));
              bumpRoleModelRev(name); // 重挂 input，回到上次生效值
              return;
            }
            var v = s.trim();
            if (v.length > 120) {
              toast.warn(t("panel.roleModelTooLong", { name: name, field: labelOf(key) }));
              bumpRoleModelRev(name);
              return;
            }
            // 成对性检查按「本次写入后的最终值」判定（assign 为 blur 前的生效值，
            // 另一字段的已提交值已在其中），不放进 setAssign updater（保持其纯函数）。
            var cur = assign.roles[name] || {};
            var model = key === "model" ? (v === "" ? null : v) : (cur.model || null);
            var provider = key === "provider" ? (v === "" ? null : v) : (cur.provider || null);
            setAssign(function (prev) {
              var next = JSON.parse(JSON.stringify(prev));
              next.roles[name][key] = v === "" ? null : v;
              return next;
            });
            // provider 非空而 model 为空 → 允许保存（后端原样落盘），但明确提示会被忽略
            if (provider && !model) {
              toast.warn(t("panel.providerIgnored", { name: name }));
            }
            if (v === "") bumpRoleModelRev(name); // 清空 = 跟随主 agent：重挂显示占位
          }
          return h("div", { className: "omd-mainName" },
            h("div", { className: "omd-glabel" }, t("panel.roleModelLabel")),
            h("div", { className: "omd-nameRow" },
              h("input", {
                key: "omd-roleModel-" + name + "-" + rev + "-" + switchRev,
                type: "text",
                className: "omd-nameInput",
                defaultValue: role.model || "",
                placeholder: "deepseek-v4-pro",
                spellCheck: false,
                disabled: busy,
                onBlur: function (e) { commitRoleModel("model", e.target.value); },
              }),
              h("input", {
                key: "omd-roleProvider-" + name + "-" + rev + "-" + switchRev,
                type: "text",
                className: "omd-nameInput",
                defaultValue: role.provider || "",
                placeholder: t("panel.providerPlaceholder"),
                spellCheck: false,
                disabled: busy,
                onBlur: function (e) { commitRoleModel("provider", e.target.value); },
              })),
            h("div", { className: "omd-hint" },
              t("panel.modelFallbackHint", { err: modelGroupsErr || t("panel.unknownError") })));
        }

        // ── 下拉模式：选项来自 /api/paoding/models ────────────────────────
        var options = modelOptionsOf(modelGroups);
        var sel = roleModelSelectionOf(options, role.provider || null, role.model || null);
        var children = [h("option", { key: "follow", value: "" }, t("models.followMain"))];
        options.forEach(function (opt) {
          children.push(h("option", { key: opt.value, value: opt.value },
            t("models.option", { model: opt.modelName, provider: opt.providerName })));
        });
        if (sel.extra) children.push(h("option", { key: "current", value: sel.extra.value }, sel.extra.label));
        function commitRoleModelOption(value) {
          if (value === "") {
            // 「跟随主 agent 当前模型」：model / provider 一并归 null
            setAssign(function (prev) {
              var next = JSON.parse(JSON.stringify(prev));
              next.roles[name].model = null;
              next.roles[name].provider = null;
              return next;
            });
            return;
          }
          var dec = decodeModelOption(value);
          if (!dec) return; // 理论不可达：选项 value 均由本组件编码
          setAssign(function (prev) {
            var next = JSON.parse(JSON.stringify(prev));
            next.roles[name].provider = dec.provider || null; // 成对写入；下拉模式不存在「只配 provider」状态
            next.roles[name].model = dec.model || null;
            return next;
          });
        }
        return h("div", { className: "omd-mainName" },
          h("div", { className: "omd-glabel" }, t("panel.roleModelLabel")),
          h("div", { className: "omd-nameRow" },
            h("select", {
              key: "omd-roleModel-" + name, // 每角色独立实例；模式 / 选项集切换可整体重挂
              className: "omd-nameInput",
              disabled: busy,
              value: sel.value,
              onChange: function (e) { commitRoleModelOption(e.target.value); },
            }, children)),
          h("div", { className: "omd-hint" },
            t("panel.modelSelectHint")));
      }

      // 角色「会话模式」行（内置与自定义角色通用，同 roleModelBlock 的定位）：
      // 单选 roles.<toolName>.background_mode ——「一次性（one-shot）」为缺省
      //（字面量 'one-shot'，与 config 层 normalizeBackgroundMode 恒收两个合法
      // 值的序列化形状一致），「可续（continuable）」写 'continuable'。选中
      // 可续时行内展示成本提示；host 层 persistence 后端缺失
      //（state.persistenceAvailable === false，字段缺失的老服务端视为可用不
      // 误报）时再叠加委派将报错的警告——只警示，不拦截预览 / 应用。
      function roleBgModeBlock(name) {
        var continuable = !!(assign.roles[name] && assign.roles[name].background_mode === "continuable");
        function commitBgMode(on) {
          setAssign(function (prev) {
            var next = JSON.parse(JSON.stringify(prev));
            next.roles[name].background_mode = on ? "continuable" : "one-shot";
            return next;
          });
        }
        function bgOption(key, label, checked, on) {
          return h("label", { key: key, className: "omd-toolItem" },
            h("input", {
              type: "radio",
              className: "omd-check",
              name: "pd-bgm-" + name, // 每角色独立单选组；name 含 toolName 不串台
              checked: checked,
              disabled: busy,
              onChange: function () { commitBgMode(on); },
            }),
            h("span", { className: "omd-toolName" }, label));
        }
        return h("div", { className: "omd-mainName" },
          h("div", { className: "omd-glabel" }, t("panel.bgModeLabel")),
          h("div", { className: "omd-nameRow" },
            bgOption("one-shot", t("panel.bgOneshot"), !continuable, false),
            bgOption("continuable", t("panel.bgContinuable"), continuable, true)),
          continuable ? h("div", { className: "omd-hint" }, roleBgContinuableHint()) : null,
          continuable && data.persistenceAvailable === false
            ? statusRow("omd-statusWarn", ic(P.IconWarningOutline16, 16), roleBgPersistenceWarn())
            : null);
      }

      // 角色「启动方式」行（内置与自定义角色通用，同 roleBgModeBlock 的定位）：
      // 单选 roles.<toolName>.start_mode ——「全新（fresh）」为缺省（字面量
      // 'fresh'，与 config 层 normalizeStartMode 恒收两个合法值的序列化形状
      // 一致），「继承对话（fork）」写 'fork'（委派块的块级 provider 行改落
      // fork）。选中继承对话且该角色配了专用模型时行内提示互斥：fork 子代理
      // 继承主 agent 的提供方与模型，专用模型不生效（应用时后端 warn 并忽略）。
      // 注意与「专用模型」行的 provider 字段（LLM 路由）无关。
      function roleStartModeBlock(name) {
        var role = assign.roles[name] || {};
        var fork = role.start_mode === "fork";
        var hasModel = typeof role.model === "string" && role.model !== "";
        function commitStartMode(toFork) {
          setAssign(function (prev) {
            var next = JSON.parse(JSON.stringify(prev));
            next.roles[name].start_mode = toFork ? "fork" : "fresh";
            return next;
          });
        }
        function smOption(key, label, checked, on) {
          return h("label", { key: key, className: "omd-toolItem" },
            h("input", {
              type: "radio",
              className: "omd-check",
              name: "pd-sm-" + name, // 每角色独立单选组；name 含 toolName 不串台
              checked: checked,
              disabled: busy,
              onChange: function () { commitStartMode(on); },
            }),
            h("span", { className: "omd-toolName" }, label));
        }
        return h("div", { className: "omd-mainName" },
          h("div", { className: "omd-glabel" }, t("panel.startModeLabel")),
          h("div", { className: "omd-nameRow" },
            smOption("fresh", t("panel.smFresh"), !fork, false),
            smOption("fork", t("panel.smFork"), fork, true)),
          fork
            ? h("div", { className: "omd-hint" },
                t("panel.forkStartHint"))
            : null,
          fork && hasModel
            ? statusRow("omd-statusWarn", ic(P.IconWarningOutline16, 16), roleForkModelHint())
            : null);
      }

      function roleCard(name) {
        var isMain = name === "__main__";
        var display = isMain ? t("role.mainAgent") : name;
        var isCustom = !isMain && DEFAULT_ROLES.indexOf(name) === -1;
        var open = name in openMap ? openMap[name] : defaultOpenOf(name);

        var d = data;
        var a = assign;

        var head = h("div", { className: "omd-roleHeadWrap" },
          h("button", {
            type: "button",
            className: "omd-roleHead",
            "aria-expanded": open ? "true" : "false",
            onClick: function () { toggleRole(name); },
          },
            h("span", { className: open ? "omd-chevron omd-chevronOpen" : "omd-chevron" }, ic(P.IconChevronDownOutline14, 14)),
            h("span", { className: "omd-roleName" }, display),
            h("span", { className: "omd-roleBadge" }, isMain ? t("role.badgeFixed") : (isCustom ? t("role.badgeCustom") : t("role.badgeBuiltin"))),
            h("span", { className: "omd-roleCount" },
              t("role.toolCount", { n: isMain
                ? ((data.restrictBase || []).length + a.main_agent_extra.length - (a.main_agent_remove || []).length)
                : a.roles[name].tools.length }))),
          // 自定义角色改名按钮：toolName 是身份键（委派调用名 / skills 引用），
          // 与内置角色的「显示名」不是一回事——那个只改 persona 主语。
          isCustom
            ? h("button", {
                type: "button",
                className: "omd-roleEdit",
                title: t("role.renameTitle", { name: name }),
                onClick: function (e) {
                  e.stopPropagation();
                  renameRole(name);
                },
              }, ic(P.IconEditOutline16, 16))
            : null,
          // 删除按钮：自定义角色走 removeRole（仅删 roles key）；内置角色走
          // removeBuiltinRole（删 key + roles_remove 记名 → 卡片消失、可恢复）。
          // 主 agent（__main__）卡不可删。内置卡只渲染存在于 assign.roles 的，删后即隐。
          !isMain
            ? h("button", {
                type: "button",
                className: "omd-roleDel",
                title: isCustom ? t("role.delCustomTitle", { name: name }) : t("role.delBuiltinTitle", { name: name }),
                onClick: function (e) {
                  e.stopPropagation();
                  if (isCustom) removeRole(name);
                  else removeBuiltinRole(name);
                },
              }, ic(P.IconTrashOutline16, 16))
            : null);

        var body = [];
        if (isMain) {
          body.push(mainNameBlock());
          body.push(h("div", { className: "omd-glabel" }, t("panel.baseToolsMain")));
          body.push(h("div", { className: "omd-toolGrid" },
            (data.restrictBase || []).map(function (t) {
              return toolItem(t, "base", (a.main_agent_remove || []).indexOf(t) === -1, busy,
                function (e) { setMainRemove(t, e.target.checked); }, t);
            })));
          // host 检测库存按角色卡同口径拆两组：mcp__ 前缀 → 「MCP 工具」，
          // 其余（mnemon_* 等插件直注册工具）→ 「插件工具」。勾选逻辑不变，
          // 都写入 main_agent_extra。
          var mainInv = data.inventory || [];
          var mainMcpTools = mainInv.filter(function (t) { return hostTool(t); });
          var mainPluginTools = mainInv.filter(function (t) { return !hostTool(t); });
          body.push(h("div", { className: "omd-glabel" }, t("panel.mcpToolsMain")));
          body.push(h("div", { className: "omd-toolGrid" },
            mainMcpTools.length
              ? mainMcpTools.map(function (t) {
                  return toolItem(t, "mcp", a.main_agent_extra.indexOf(t) !== -1, busy,
                    function (e) { setMainExtra(t, e.target.checked); }, t);
                })
              : h("div", { className: "omd-empty" }, t("panel.noMcp"))));
          body.push(h("div", { className: "omd-glabel" }, t("panel.pluginToolsMain")));
          body.push(h("div", { className: "omd-toolGrid" },
            mainPluginTools.length
              ? mainPluginTools.map(function (t) {
                  return toolItem(t, "plugin", a.main_agent_extra.indexOf(t) !== -1, busy,
                    function (e) { setMainExtra(t, e.target.checked); }, t);
                })
              : h("div", { className: "omd-empty" }, t("panel.noPlugin"))));
          body.push(h("div", { className: "omd-glabel" }, t("panel.skillsMain")));
          body.push(gridSkills.length
            ? h("div", null,
                h("div", { className: "omd-toolGrid" }, gridSkills.map(function (s) {
                  return toolItem(s, t("panel.tagReadOnDemand"), a.main_agent_skills.indexOf(s) !== -1, busy,
                    function (e) { setMainSkill(s, e.target.checked); }, s + "s",
                    gridProj && gridProj.has(s) ? t("common.projectBadge") : null);
                })),
                h("div", { className: "omd-glabel" }, t("panel.skillsInline")),
                h("div", { className: "omd-toolGrid" }, gridSkills.map(function (s) {
                  return toolItem(s, t("panel.tagInline"), a.main_agent_skills_inline.indexOf(s) !== -1, busy,
                    function (e) { setMainSkillInline(s, e.target.checked); }, s + "i",
                    gridProj && gridProj.has(s) ? t("common.projectBadge") : null);
                })))
            : h("div", { className: "omd-empty" }, t("panel.noSkills")));
          body.push(mainPersonaExtraBlock());
        } else {
          // 模型行位置：内置角色卡在「显示名」之后、工具面区之前；自定义角色卡
          // 在 body 顶部（其无默认显示名可换，不加 builtinNameBlock）。两个场景
          // 通用同一 roleModelBlock——下拉模式成对写 provider + model（不存在
          // 「只配 provider」）；目录不可用降级双 input 时才可能出现该状态（后端
          // warn 并忽略）。留空 = 跟随主 agent 当前模型。
          // 「会话模式」单选紧随模型行（内置 / 自定义通用）：缺省一次性，
          // 选可续时行内给成本提示 + persistence 缺失警告（如有）。
          // 「启动方式」单选紧随会话模式行（内置 / 自定义通用）：缺省全新，
          // 选继承对话时行内给快照语义提示；配了专用模型再叠加互斥警告。
          body.push(roleTitleBlock(name, isCustom));
          body.push(roleModelBlock(name));
          body.push(roleBgModeBlock(name));
          body.push(roleStartModeBlock(name));
          // 三组网格（同 roleCandidateTools 注释的分组口径）：「基础工具」=
          // 非 mcp__ 且不在检测库存（blocks ∪ customCoreToolsOf 减 inventory）；
          // 「MCP 工具」= mcp__ 前缀（含 SRC 自带行，如 tavily）；「插件工具」
          // = 检测库存中非 mcp__ 的直注册工具（mnemon_* 等）。三组勾选逻辑
          // 一致（setRoleTools），分组只影响展示。
          var candidates = roleCandidateTools(name);
          var inv = data.inventory || [];
          var mcpTools = candidates.filter(function (t) { return hostTool(t); });
          var pluginTools = candidates.filter(function (t) { return !hostTool(t) && inv.indexOf(t) !== -1; });
          var baseTools = candidates.filter(function (t) { return !hostTool(t) && inv.indexOf(t) === -1; });
          var checked = a.roles[name].tools;
          body.push(h("div", { className: "omd-glabel" }, t("panel.baseTools")));
          body.push(h("div", { className: "omd-toolGrid" },
            baseTools.length
              ? baseTools.map(function (t) {
                  return toolItem(t, "base", checked.indexOf(t) !== -1, busy,
                    function (e) { setRoleTools(name, t, e.target.checked); }, t);
                })
              : h("div", { className: "omd-empty" }, t("panel.none"))));
          body.push(h("div", { className: "omd-glabel" }, t("panel.mcpTools")));
          body.push(h("div", { className: "omd-toolGrid" },
            mcpTools.length
              ? mcpTools.map(function (t) {
                  return toolItem(t, "mcp", checked.indexOf(t) !== -1, busy,
                    function (e) { setRoleTools(name, t, e.target.checked); }, t);
                })
              : h("div", { className: "omd-empty" }, t("panel.noMcp"))));
          body.push(h("div", { className: "omd-glabel" }, t("panel.pluginTools")));
          body.push(h("div", { className: "omd-toolGrid" },
            pluginTools.length
              ? pluginTools.map(function (t) {
                  return toolItem(t, "plugin", checked.indexOf(t) !== -1, busy,
                    function (e) { setRoleTools(name, t, e.target.checked); }, t);
                })
              : h("div", { className: "omd-empty" }, t("panel.noPlugin"))));
          body.push(personaBlock(name));
        }

        return h("div", { className: "omd-roleCard", key: name },
          head,
          open ? h("div", { className: "omd-roleBody" }, body) : null);
      }

      function skillsBlock() {
        // 数据源与主 agent 技能网格一致（工作区视角 = 合并列表，见 gridSkills）；
        // 项目级技能在名字旁加「项目」角标。
        var rows = gridSkills.map(function (s) {
          var roleNames = Object.keys(assign.roles);
          var picked = assign.skills[s] || [];
          return h("div", { className: "omd-skillRow", key: s },
            h("span", { className: "omd-skillName", title: s }, s),
            gridProj && gridProj.has(s) ? h("span", { className: "omd-skillProj" }, t("common.projectBadge")) : null,
            h("div", { className: "omd-skillRoles" }, roleNames.map(function (r) {
              return h("label", { className: "omd-skillRole", key: r },
                h("input", {
                  type: "checkbox",
                  className: "omd-check",
                  checked: picked.indexOf(r) !== -1,
                  disabled: busy,
                  onChange: function (e) { setSkill(s, r, e.target.checked); },
                }),
                h("span", null, r));
            })));
        });
        return rows.length ? rows : h("div", { className: "omd-empty" }, t("panel.noSkills"));
      }

      var customRoles = Object.keys(assign.roles).filter(function (n) { return DEFAULT_ROLES.indexOf(n) === -1; });
      // 内置角色可见名单：条目键存在且未被 roles_remove 删除（场景模板切到
      // 轻量/调研档后条目键仍保留——为的是切回全开档时 persona / 模型 / 工具面
      // 原样复原——卡片显隐一律按 roles_remove 判定；标题计数同口径）。
      var visibleBuiltinRoles = DEFAULT_ROLES.filter(function (n) {
        return !!assign.roles[n] && (assign.roles_remove || []).indexOf(n) === -1;
      });

      // persistence 警告横幅：host 层会话持久化后端缺失（state.persistenceAvailable
      // === false；字段缺失的老版服务端视为可用，不误报）且当前视角的任意角色
      // 配了可续（continuable）时，面板顶部警示——只提示不拦截，预览 / 应用照常。
      var persistenceWarn = data.persistenceAvailable === false && hasContinuableRole(assign.roles);

      var applyBtn = h(P.Button, {
        variant: "primary",
        size: "md",
        disabled: busy,
        onClick: doApply,
        icon: busyOp === "apply"
          ? h("span", { className: "omd-spin" }, ic(P.IconLoadingOutline16, 16))
          : ic(P.IconCheckOutline16, 16),
      }, busyOp === "apply" ? t("panel.applying") : t("panel.applyBtn"));

      var previewBtn = h(P.Button, {
        variant: "outline",
        size: "md",
        disabled: busy,
        onClick: doPreview,
        icon: busyOp === "preview"
          ? h("span", { className: "omd-spin" }, ic(P.IconLoadingOutline16, 16))
          : ic(P.IconCordisPluginOutline14, 14),
      }, busyOp === "preview" ? t("panel.previewing") : t("panel.previewBtn"));

      var rescanBtn = h(P.Button, {
        variant: "ghost",
        size: "md",
        disabled: busy,
        onClick: doRescan,
        icon: busyOp === "rescan"
          ? h("span", { className: "omd-spin" }, ic(P.IconLoadingOutline16, 16))
          : ic(P.IconRefreshOutline16, 16),
      }, busyOp === "rescan" ? t("panel.scanning") : t("panel.rescanBtn"));

      return h("div", { className: "pd-page", ref: rootRef },
        // 运行时识别降级：持续状态（不是事件），内联一行小字贴标签行上方，
        // 平时（runtimeOk 正常）零占位
        runtimeNoteOf(data),

        // persistence 警告横幅：仅当前视角确有可续角色且 host 层持久化后端
        // 缺失时出现（判定见上方 persistenceWarn），其余场合零占位
        persistenceWarn
          ? statusRow("omd-statusWarn", ic(P.IconWarningOutline16, 16), roleBgPersistenceWarn())
          : null,

        // 配置对象（全局默认 / 各工作区，标签页）
        workspaceBarOf(),

        // 宿主工作区列表拉取失败的可见降级提示：此时标签条只剩配置文件兜底的
        // tab，一声不吭的话用户会误以为「注册过的工作区不见了」是功能缺陷。
        // 仅请求失败 / 响应异常时出现（wsListErr 非空，成功路径零占位）；贴在
        // 标签条容器下方另起一行，不动标签行自身的收纳 / 下拉锚点布局，
        // role=status 礼貌播报即可（持久化警告同款 statusRow，错误行才用 alert）。
        wsListErr
          ? statusRow("omd-statusWarn", ic(P.IconWarningOutline16, 16), wsListErr, "status")
          : null,

        // 「添加工作区」弹窗：fixed 全屏遮罩不占布局流，挂在根数组末尾即可；
        // 未打开时返回 null，零开销
        wsModalOf(),

        // 「新建自定义 agent 角色」弹窗：同为 fixed 全屏遮罩不占布局流，
        // 未打开时返回 null，零开销
        roleAddModalOf(),

        // 「重命名自定义角色」弹窗：同上（原原生 prompt 改模态框）
        roleRenameModalOf(),

        // 角色与工具
        h("div", { className: "omd-group" },
          h("div", { className: "omd-groupHeading" },
            h("span", { className: "omd-groupIcon" }, ic(P.IconUserOutline16, 14)),
            h("span", null, t("panel.rolesToolsHeading")),
            h("span", { className: "omd-count" }, visibleBuiltinRoles.length + customRoles.length)),
          // 场景模板行：三档快捷预设（只动 roles_remove + main_agent_extra），
          // 贴工具配置区上方；说明进 title 悬浮，不占版面。仅改本地 assign，
          // 保存仍走「保存并应用」。
          h("div", { className: "omd-chips" },
            h("span", { className: "omd-restoreTitle" }, t("panel.tplHeading")),
            PAODING_SCENARIO_TEMPLATES.map(function (tpl) {
              return h("button", {
                type: "button",
                key: tpl.id,
                className: "omd-restorePill",
                title: t(tpl.desc),
                disabled: busy,
                onClick: function () { applyTemplateClick(tpl); },
              }, t(tpl.label));
            })),
          roleCard("__main__"),
          visibleBuiltinRoles.map(function (n) { return roleCard(n); }),
          customRoles.map(function (n) { return roleCard(n); }),
          // 已删除的内置角色恢复区（仅删除过内置角色时出现）
          (assign.roles_remove || []).length
            ? h("div", { className: "omd-restoreRow" },
                h("div", { className: "omd-restoreTitle" }, t("panel.removedHeading")),
                h("div", { className: "omd-chips" }, (assign.roles_remove || []).map(function (n) {
                  return h("button", {
                    type: "button",
                    key: n,
                    className: "omd-restorePill",
                    title: t("role.restoreTitle", { name: n }),
                    onClick: function () { restoreBuiltinRole(n); },
                  }, t("role.restorePill", { name: n }));
                })),
                h("div", { className: "omd-hint" },
                  t("panel.restoreHint")))
            : null,
          h("button", { type: "button", className: "omd-addRole", onClick: openRoleAddModal },
            h("span", { className: "omd-addRoleIcon" }, ic(P.IconPlusOutline16, 16)),
            h("span", null, t("panel.roleAddBtn")))),

        // 技能分配
        h("div", { className: "omd-group" },
          h("div", { className: "omd-groupHeading" },
            h("span", { className: "omd-groupIcon" }, ic(P.IconSkillOutline16, 14)),
            h("span", null, t("panel.skillsHeading")),
            skillScopeNote(),
            h("span", { className: "omd-count" }, gridSkills.length)),
          // 工作区技能拉取失败的降级提示（一句话）：此刻网格数据源已回落用户级。
          activeWs !== null && wsSkillsErr
            ? statusRow("omd-statusWarn", ic(P.IconWarningOutline16, 16), wsSkillsErr)
            : null,
          skillsBlock()),

        // 检查提示卡（预览 / 应用的结构化体检结果；无条目零占位）：
        // preview 源贴着预览区上方，assign 一变即随预览作废；apply 源描述已
        // 落盘结果，保留到下一次预览 / 应用（失效口径见 warnState 注释）。
        warningsCardOf(warnState),

        // 预览生成（预览成功后才出现）
        preview ? h("div", { className: "omd-group", ref: previewRef },
          h("div", { className: "omd-groupHeading" },
            h("span", { className: "omd-groupIcon" }, ic(P.IconDataOutline16, 14)),
            h("span", null, t("panel.previewBtn"))),
          h("div", { className: "omd-previewSummary" },
            t("panel.previewOk") +
            (preview.presetId ? t("panel.previewPreset", { id: preview.presetId }) : "") +
            (preview.roleResults || []).map(function (r) {
              return " · " + r.role + ": " + r.intent.length + " → " + r.kept.length;
            }).join("")),
          h("pre", { className: "omd-pre" }, preview.text)) : null,

        // 悬浮操作坞（sticky bottom：按钮常驻滚动容器底部，改完配置无需滚回顶部再操作）
        h("div", { className: "omd-actionBar" },
          previewBtn, rescanBtn,
          h("span", { className: "omd-applyDock" }, applyBtn)));
    }

