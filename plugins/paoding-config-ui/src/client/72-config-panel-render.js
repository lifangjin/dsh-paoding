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
          title: "全局默认：写入共享的 orchestrator 预设",
          onClick: function () { switchWorkspace(null); },
        }, h("span", { className: "omd-tabText" }, "全局默认"))];
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
            row.sessionCount != null ? h("span", { className: "omd-tabCount" }, row.sessionCount + " 会话") : null);
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
            title: "其余 " + hidden.length + " 个工作区",
            "aria-haspopup": "listbox",
            "aria-expanded": wsMenuOpen ? "true" : "false",
            onClick: function () { setWsMenuOpen(!wsMenuOpen); },
          },
            h("span", { className: "omd-tabText" }, "更多"),
            h("span", { className: "omd-tabMoreCount" }, String(hidden.length))));
        }
        // 末尾「＋ 添加工作区」：与 tab 同尺寸的弱化按钮（ghost），点击打开输入弹窗。
        tabs.push(h("button", {
          key: "__add__",
          type: "button",
          className: "omd-tab omd-tabAdd",
          title: "注册新的工作区目录",
          disabled: busy,
          onClick: function () { setWsAddOpen(true); setWsAddErr(""); },
        },
          h("span", { className: "omd-groupIcon" }, ic(P.IconPlusOutline16, 14)),
          h("span", { className: "omd-tabText" }, "添加工作区")));
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
          h("div", { className: "omd-tabs", role: "tablist", "aria-label": "配置对象", ref: tabsRowRef }, tabs),
          // 宽度测量层：常驻渲染（不随 wsFitCount 变），挪出视口且不可见，只把
          // 各 tab 的自然宽度喂给装填算法。「更多」原型计数固定写 99 按两位数
          // 算宽，与装填里的 SAFETY 余量搭配。
          h("div", { className: "omd-tabsMeasure", ref: tabsMeasureRef, "aria-hidden": "true" },
            measureTabOf("__global__", "全局默认"),
            order.map(function (row) {
              var m = meta[row.path];
              var mk = wsTagOf(existingWs, meta, row.path);
              return h("button", { key: row.path, type: "button", "data-ws-key": row.path, className: "omd-tab", tabIndex: -1 },
                h("span", { className: "omd-tabText" }, wsLabelOf(row)),
                h("span", { className: "omd-tabTag omd-tabTag" + mk.charAt(0).toUpperCase() + mk.slice(1) },
                  wsTagTextOf(mk)),
                row.sessionCount != null ? h("span", { className: "omd-tabCount" }, row.sessionCount + " 会话") : null);
            }),
            h("button", { type: "button", "data-ws-key": "__more__", className: "omd-tab omd-tabMore", tabIndex: -1 },
              h("span", { className: "omd-tabText" }, "更多"),
              h("span", { className: "omd-tabMoreCount" }, "99")),
            h("button", { type: "button", "data-ws-key": "__add__", className: "omd-tab omd-tabAdd", tabIndex: -1 },
              h("span", { className: "omd-groupIcon" }, ic(P.IconPlusOutline16, 14)),
              h("span", { className: "omd-tabText" }, "添加工作区"))),
          // 「更多」下拉：菜单项信息结构与 tab 同款（小圆点 / 名称 / 会话数，
          // title 拼法也一致），点击直接切过去。role=listbox/option 表达
          // 「从清单里选一个配置对象」的语义，aria-selected 标当前项。
          wsMenuOpen && hidden.length > 0
            ? h("div", { className: "omd-tabMenu", role: "listbox", "aria-label": "更多工作区" },
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
                    row.sessionCount != null ? h("span", { className: "omd-tabCount" }, row.sessionCount + " 会话") : null);
                }))
            : null),
          h("div", { className: "omd-hint" },
            "「全局默认」写入共享的 orchestrator 预设；选中某个工作区后，预览 / 应用会生成该工作区专属预设（orchestrator-<目录名>），两者互不影响。"));
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
          h("div", { className: "pd-modalCard", role: "dialog", "aria-modal": "true", "aria-label": "添加工作区" },
            h("div", { className: "pd-modalHeader" },
              h("h2", { className: "pd-modalTitle" }, "添加工作区"),
              h("button", { type: "button", className: "pd-modalClose", "aria-label": "关闭", onClick: closeWsModal },
                h("span", { className: "pd-closeGlyph", "aria-hidden": "true" }, "×"))),
            h("div", { className: "pd-modalBody" },
              h("label", { className: "pd-modalLabel" }, "工作区目录绝对路径"),
              h("div", { className: "omd-wsSuggestWrap" },
                h("input", {
                  type: "text",
                  className: "omd-nameInput omd-wsAddInput",
                  value: wsAddPath,
                  placeholder: "输入工作区目录绝对路径，如 /Users/me/code/project-a",
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
              h("div", { className: "omd-hint" }, "目录需已存在；已注册的目录重复提交幂等返回。")),
            h("div", { className: "pd-modalFooter" },
              h(P.Button, { variant: "outline", size: "md", disabled: busy, onClick: closeWsModal }, "取消"),
              h(P.Button, {
                variant: "primary",
                size: "md",
                disabled: busy || String(wsAddPath).trim() === "",
                onClick: submitWorkspace,
              }, busyOp === "wsadd" ? "添加中…" : "确认添加"))));
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
          h("div", { className: "pd-modalCard", role: "dialog", "aria-modal": "true", "aria-label": "新建自定义 agent 角色" },
            h("div", { className: "pd-modalHeader" },
              h("h2", { className: "pd-modalTitle" }, "新建自定义 agent 角色"),
              h("button", { type: "button", className: "pd-modalClose", "aria-label": "关闭", onClick: closeRoleAddModal },
                h("span", { className: "pd-closeGlyph", "aria-hidden": "true" }, "×"))),
            h("div", { className: "pd-modalBody" },
              h("label", { className: "pd-modalLabel" }, "角色 toolName（主 agent 的委派调用名）"),
              h("input", {
                type: "text",
                className: "omd-nameInput",
                value: roleAddName,
                placeholder: "输入英文小写角色名，如 reviewer",
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
              h("label", { className: "pd-modalLabel" }, "显示名（可选）"),
              h("input", {
                ref: roleAddDispRef,
                type: "text",
                className: "omd-nameInput",
                value: roleAddDispName,
                // 占位语义与 roleTitleBlock 的 subject=toolName 一致：留空 = 事件流标题回落 toolName
                placeholder: "如 代码评审，留空 = 用 toolName",
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
              h("label", { className: "pd-modalLabel" }, "会话模式"),
              h("div", { className: "omd-nameRow" },
                h("label", { className: "omd-toolItem" },
                  h("input", {
                    type: "radio",
                    className: "omd-check",
                    name: "pd-bgm-roleadd",
                    checked: roleAddBgMode !== "continuable",
                    onChange: function () { setRoleAddBgMode("one-shot"); },
                  }),
                  h("span", { className: "omd-toolName" }, "一次性（one-shot）")),
                h("label", { className: "omd-toolItem" },
                  h("input", {
                    type: "radio",
                    className: "omd-check",
                    name: "pd-bgm-roleadd",
                    checked: roleAddBgMode === "continuable",
                    onChange: function () { setRoleAddBgMode("continuable"); },
                  }),
                  h("span", { className: "omd-toolName" }, "可续（continuable）"))),
              roleAddBgMode === "continuable"
                ? h("div", { className: "omd-hint" }, ROLE_BG_CONTINUABLE_HINT)
                : null,
              roleAddBgMode === "continuable" && data && data.persistenceAvailable === false
                ? statusRow("omd-statusWarn", ic(P.IconWarningOutline16, 16), ROLE_BG_PERSISTENCE_WARN)
                : null,
              roleAddErr ? statusRow("omd-statusError", ic(P.IconWarningOutline16, 16), roleAddErr) : null,
              h("div", { className: "omd-hint" },
                "角色名须为 2-32 位小写字母/数字/下划线/连字符，小写字母开头；内置名不可新建。显示名可选，不能换行，trim 后最多 60 字符，留空用 toolName 当标题。新角色工具面默认放开全部检测到的工具，可在卡片里再收窄。会话模式缺省一次性（one-shot），选「可续」后仍可在角色卡里改。")),
            h("div", { className: "pd-modalFooter" },
              h(P.Button, { variant: "outline", size: "md", onClick: closeRoleAddModal }, "取消"),
              h(P.Button, {
                variant: "primary",
                size: "md",
                disabled: String(roleAddName).trim() === "",
                onClick: submitRoleAdd,
              }, "确认新建"))));
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
          h("div", { className: "pd-modalCard", role: "dialog", "aria-modal": "true", "aria-label": "重命名自定义角色" },
            h("div", { className: "pd-modalHeader" },
              h("h2", { className: "pd-modalTitle" }, "重命名自定义角色"),
              h("button", { type: "button", className: "pd-modalClose", "aria-label": "关闭", onClick: closeRoleRenameModal },
                h("span", { className: "pd-closeGlyph", "aria-hidden": "true" }, "×"))),
            h("div", { className: "pd-modalBody" },
              h("label", { className: "pd-modalLabel" }, "新 toolName（主 agent 的委派调用名）"),
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
                "2-32 位小写字母/数字/下划线/连字符，小写字母开头；不可改成内置名或已存在的名字。skills 里的引用自动迁移；改名后需重启 / 新会话生效。")),
            h("div", { className: "pd-modalFooter" },
              h(P.Button, { variant: "outline", size: "md", onClick: closeRoleRenameModal }, "取消"),
              h(P.Button, {
                variant: "primary",
                size: "md",
                // 空值 / 与旧名相同都禁用确认：后者点确认只会空转收窗，禁用
                // 让按钮状态与「确实改了名」对齐。
                disabled: String(roleRenameVal).trim() === "" || String(roleRenameVal).trim() === roleRenameFor,
                onClick: submitRoleRename,
              }, "确认重命名"))));
      }

      if (!data || !assign) {
        // 面板没起来（含 state 加载失败）才走这条整页分支：失败渲染常驻错误行，
        // 不进 toast——此刻页面还没有内容可依托，错误必须一直可见。
        return h("div", { className: "pd-page" },
          error
            ? statusRow("omd-statusError", ic(P.IconWarningOutline16, 16), error)
            : h("div", { className: "omd-loading" },
                h("span", { className: "omd-spin" }, ic(P.IconLoadingOutline16, 16)),
                h("span", null, "加载检测状态…")));
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
          activeWs !== null ? "用户级 + 该工作区项目级技能" : "仅用户级技能");
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
            h("span", null, "persona（可选，覆盖默认角色说明）"),
            h("span", { className: "omd-personaEdit" }, ic(P.IconEditOutline16, 14))),
          open ? h("div", { className: "omd-personaBody" },
            h("textarea", {
              key: "omd-persona-" + name + "-" + switchRev, // 切视角重挂：defaultValue 显示新目标的 persona
              className: "omd-textarea",
              defaultValue: assign.roles[name].persona || "",
              placeholder: "输入该角色的 persona 说明…",
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
            h("div", { className: "omd-hint" }, "技能引导会自动追加到 persona 末尾；自定义角色必填此说明。"))
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
            h("span", null, "人设追加（主 agent 提示词尾部，可编辑）"),
            h("span", { className: "omd-personaEdit" }, ic(P.IconEditOutline16, 14))),
          extraOpen ? h("div", { className: "omd-personaBody" },
            h("textarea", {
              key: "omd-extra-" + extraRev + "-" + switchRev,
              className: "omd-textarea omd-extraArea",
              defaultValue: val,
              placeholder: "留空并保存 = 不追加任何内容（默认 codegraph 规则将被移除）…",
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
              }, "恢复默认"),
              h("span", { className: "omd-extraHint" },
                "保存并应用时按此追加到主 agent persona 末尾（顺序：SRC 本体 → 技能行 → 此处）。改动需重启 GUI / 新会话生效。")),
            h("div", { className: "omd-hint" }, "清空保存 = 移除默认 codegraph 规则（配置键 main_agent_persona_extra 记为 ''）。"))
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
            toast.warn("主 agent 显示名（仅 preset 显示名）不能包含换行（\\r / \\n），未保存");
            setDisplayNameRev(displayNameRev + 1); // 重挂 input，回到上次生效值
            return;
          }
          var v = s.trim();
          if (s !== "" && v === "") {
            toast.warn("主 agent 显示名（仅 preset 显示名）不能为纯空白（清空字段或点「恢复默认」= 默认显示名），未保存");
            setDisplayNameRev(displayNameRev + 1);
            return;
          }
          if (v.length > 60) {
            toast.warn("主 agent 显示名（仅 preset 显示名）过长：trim 后最多 60 字符，未保存");
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
          h("div", { className: "omd-glabel" }, "主 agent 显示名（仅 preset 显示名）"),
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
            h("button", { type: "button", className: "omd-extraRestore", disabled: busy, onClick: restoreMainDisplayName }, "恢复默认")),
          h("div", { className: "omd-hint" },
            "仅替换预设显示名，persona 身份行（You are the …）不动；留空 = 默认「编排模式 (Orchestrator)」（工作区预设用派生名）。改动需重启 GUI / 新会话生效。"));
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
            toast.warn('角色 "' + name + '" 显示名不能包含换行（\\r / \\n），未保存');
            bumpRoleNameRev(name); // 重挂 input，回到上次生效值
            return;
          }
          var v = s.trim();
          if (v.length > 60) {
            toast.warn('角色 "' + name + '" 显示名过长：trim 后最多 60 字符，未保存');
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
            isCustom ? "角色显示名（事件流委派行标题；不动 toolName / persona）" : "角色显示名（persona 身份句主语 + 事件流委派行标题；不动工具名/调用名）"),
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
              ? '留空 = 事件流显示 toolName（' + name + '）；保存并应用后生效（仅 GUI 展示，不影响生成产物与调用名）。'
              : '留空 = 默认身份（如 "You are the ' + subject + ' agent."）；已为该角色自定义 persona 时仅作事件流标题。'));
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
          function labelOf(key) { return key === "provider" ? "provider" : "专用模型"; }
          function commitRoleModel(key, raw) {
            var s = String(raw == null ? "" : raw);
            if (/[\r\n]/.test(s)) {
              toast.warn('角色 "' + name + '" ' + labelOf(key) + "不能包含换行（\\r / \\n），未保存");
              bumpRoleModelRev(name); // 重挂 input，回到上次生效值
              return;
            }
            var v = s.trim();
            if (v.length > 120) {
              toast.warn('角色 "' + name + '" ' + labelOf(key) + "过长：trim 后最多 120 字符，未保存");
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
              toast.warn('角色 "' + name + '"：provider 仅在同时配置模型时生效（后端将忽略），已保存');
            }
            if (v === "") bumpRoleModelRev(name); // 清空 = 跟随主 agent：重挂显示占位
          }
          return h("div", { className: "omd-mainName" },
            h("div", { className: "omd-glabel" }, "专用模型（可选；留空 = 跟随主 agent 当前模型）"),
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
                placeholder: "provider（留空=跟随主 agent）",
                spellCheck: false,
                disabled: busy,
                onBlur: function (e) { commitRoleModel("provider", e.target.value); },
              })),
            h("div", { className: "omd-hint" },
              "模型目录不可用（" + (modelGroupsErr || "未知错误") + "），已回退手输。写入该角色委派块的 agentOptions；含冷恢复在内，子 agent 固定用该模型。provider 需与模型成对（如 deepseek-official）。"));
        }

        // ── 下拉模式：选项来自 /api/paoding/models ────────────────────────
        var options = modelOptionsOf(modelGroups);
        var sel = roleModelSelectionOf(options, role.provider || null, role.model || null);
        var children = [h("option", { key: "follow", value: "" }, "跟随主 agent 当前模型")];
        options.forEach(function (opt) {
          children.push(h("option", { key: opt.value, value: opt.value },
            opt.modelName + "（" + opt.providerName + "）"));
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
          h("div", { className: "omd-glabel" }, "专用模型（可选；留空 = 跟随主 agent 当前模型）"),
          h("div", { className: "omd-nameRow" },
            h("select", {
              key: "omd-roleModel-" + name, // 每角色独立实例；模式 / 选项集切换可整体重挂
              className: "omd-nameInput",
              disabled: busy,
              value: sel.value,
              onChange: function (e) { commitRoleModelOption(e.target.value); },
            }, children)),
          h("div", { className: "omd-hint" },
            "选项来自 DSH 已注册的模型路由；留空 = 跟随主 agent，主 agent 换模型时未固定的角色跟着变。"));
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
          h("div", { className: "omd-glabel" }, "会话模式"),
          h("div", { className: "omd-nameRow" },
            bgOption("one-shot", "一次性（one-shot）", !continuable, false),
            bgOption("continuable", "可续（continuable）", continuable, true)),
          continuable ? h("div", { className: "omd-hint" }, ROLE_BG_CONTINUABLE_HINT) : null,
          continuable && data.persistenceAvailable === false
            ? statusRow("omd-statusWarn", ic(P.IconWarningOutline16, 16), ROLE_BG_PERSISTENCE_WARN)
            : null);
      }

      function roleCard(name) {
        var isMain = name === "__main__";
        var display = isMain ? "主 agent" : name;
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
            h("span", { className: "omd-roleBadge" }, isMain ? "固定" : (isCustom ? "自定义" : "内置")),
            h("span", { className: "omd-roleCount" },
              (isMain ? ((data.restrictBase || []).length + a.main_agent_extra.length - (a.main_agent_remove || []).length) : a.roles[name].tools.length) + " 个工具")),
          // 自定义角色改名按钮：toolName 是身份键（委派调用名 / skills 引用），
          // 与内置角色的「显示名」不是一回事——那个只改 persona 主语。
          isCustom
            ? h("button", {
                type: "button",
                className: "omd-roleEdit",
                title: '重命名角色 "' + name + '"（toolName = 委派调用名）',
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
                title: isCustom ? '删除角色 "' + name + '"' : '删除内置角色 "' + name + '"（可在下方恢复）',
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
          body.push(h("div", { className: "omd-glabel" }, "基础工具（取消勾选即从主 agent 移除——写入 main_agent_remove）"));
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
          body.push(h("div", { className: "omd-glabel" }, "MCP 工具（可加入主 agent）"));
          body.push(h("div", { className: "omd-toolGrid" },
            mainMcpTools.length
              ? mainMcpTools.map(function (t) {
                  return toolItem(t, "mcp", a.main_agent_extra.indexOf(t) !== -1, busy,
                    function (e) { setMainExtra(t, e.target.checked); }, t);
                })
              : h("div", { className: "omd-empty" }, "未检测到 MCP 工具")));
          body.push(h("div", { className: "omd-glabel" }, "插件工具（可加入主 agent）"));
          body.push(h("div", { className: "omd-toolGrid" },
            mainPluginTools.length
              ? mainPluginTools.map(function (t) {
                  return toolItem(t, "plugin", a.main_agent_extra.indexOf(t) !== -1, busy,
                    function (e) { setMainExtra(t, e.target.checked); }, t);
                })
              : h("div", { className: "omd-empty" }, "未检测到插件工具")));
          body.push(h("div", { className: "omd-glabel" }, "技能分配（read 按需：勾选 = persona 写入技能行，主 agent 用 read 加载正文）", skillScopeNote()));
          body.push(gridSkills.length
            ? h("div", null,
                h("div", { className: "omd-toolGrid" }, gridSkills.map(function (s) {
                  return toolItem(s, "read按需", a.main_agent_skills.indexOf(s) !== -1, busy,
                    function (e) { setMainSkill(s, e.target.checked); }, s + "s",
                    gridProj && gridProj.has(s) ? "项目" : null);
                })),
                h("div", { className: "omd-glabel" }, "内联全文（硬生效，每轮固定 persona 开销，适合 caveman 等风格技能）"),
                h("div", { className: "omd-toolGrid" }, gridSkills.map(function (s) {
                  return toolItem(s, "内联全文", a.main_agent_skills_inline.indexOf(s) !== -1, busy,
                    function (e) { setMainSkillInline(s, e.target.checked); }, s + "i",
                    gridProj && gridProj.has(s) ? "项目" : null);
                })))
            : h("div", { className: "omd-empty" }, "未检测到技能目录"));
          body.push(mainPersonaExtraBlock());
        } else {
          // 模型行位置：内置角色卡在「显示名」之后、工具面区之前；自定义角色卡
          // 在 body 顶部（其无默认显示名可换，不加 builtinNameBlock）。两个场景
          // 通用同一 roleModelBlock——下拉模式成对写 provider + model（不存在
          // 「只配 provider」）；目录不可用降级双 input 时才可能出现该状态（后端
          // warn 并忽略）。留空 = 跟随主 agent 当前模型。
          // 「会话模式」单选紧随模型行（内置 / 自定义通用）：缺省一次性，
          // 选可续时行内给成本提示 + persistence 缺失警告（如有）。
          body.push(roleTitleBlock(name, isCustom));
          body.push(roleModelBlock(name));
          body.push(roleBgModeBlock(name));
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
          body.push(h("div", { className: "omd-glabel" }, "基础工具"));
          body.push(h("div", { className: "omd-toolGrid" },
            baseTools.length
              ? baseTools.map(function (t) {
                  return toolItem(t, "base", checked.indexOf(t) !== -1, busy,
                    function (e) { setRoleTools(name, t, e.target.checked); }, t);
                })
              : h("div", { className: "omd-empty" }, "无")));
          body.push(h("div", { className: "omd-glabel" }, "MCP 工具"));
          body.push(h("div", { className: "omd-toolGrid" },
            mcpTools.length
              ? mcpTools.map(function (t) {
                  return toolItem(t, "mcp", checked.indexOf(t) !== -1, busy,
                    function (e) { setRoleTools(name, t, e.target.checked); }, t);
                })
              : h("div", { className: "omd-empty" }, "未检测到 MCP 工具")));
          body.push(h("div", { className: "omd-glabel" }, "插件工具"));
          body.push(h("div", { className: "omd-toolGrid" },
            pluginTools.length
              ? pluginTools.map(function (t) {
                  return toolItem(t, "plugin", checked.indexOf(t) !== -1, busy,
                    function (e) { setRoleTools(name, t, e.target.checked); }, t);
                })
              : h("div", { className: "omd-empty" }, "未检测到插件工具")));
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
            gridProj && gridProj.has(s) ? h("span", { className: "omd-skillProj" }, "项目") : null,
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
        return rows.length ? rows : h("div", { className: "omd-empty" }, "未检测到技能目录");
      }

      var customRoles = Object.keys(assign.roles).filter(function (n) { return DEFAULT_ROLES.indexOf(n) === -1; });

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
      }, busyOp === "apply" ? "处理中…" : "保存并应用");

      var previewBtn = h(P.Button, {
        variant: "outline",
        size: "md",
        disabled: busy,
        onClick: doPreview,
        icon: busyOp === "preview"
          ? h("span", { className: "omd-spin" }, ic(P.IconLoadingOutline16, 16))
          : ic(P.IconCordisPluginOutline14, 14),
      }, busyOp === "preview" ? "生成中…" : "预览生成");

      var rescanBtn = h(P.Button, {
        variant: "ghost",
        size: "md",
        disabled: busy,
        onClick: doRescan,
        icon: busyOp === "rescan"
          ? h("span", { className: "omd-spin" }, ic(P.IconLoadingOutline16, 16))
          : ic(P.IconRefreshOutline16, 16),
      }, busyOp === "rescan" ? "检测中…" : "重新检测");

      return h("div", { className: "pd-page", ref: rootRef },
        // 运行时识别降级：持续状态（不是事件），内联一行小字贴标签行上方，
        // 平时（runtimeOk 正常）零占位
        runtimeNoteOf(data),

        // persistence 警告横幅：仅当前视角确有可续角色且 host 层持久化后端
        // 缺失时出现（判定见上方 persistenceWarn），其余场合零占位
        persistenceWarn
          ? statusRow("omd-statusWarn", ic(P.IconWarningOutline16, 16), ROLE_BG_PERSISTENCE_WARN)
          : null,

        // 配置对象（全局默认 / 各工作区，标签页）
        workspaceBarOf(),

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
            h("span", null, "角色与工具"),
            h("span", { className: "omd-count" }, Object.keys(assign.roles).length)),
          roleCard("__main__"),
          // 内置角色卡只渲染 assign.roles 里存在的（roles_remove 中的已删名不重建、不渲染）
          DEFAULT_ROLES.filter(function (n) { return !!assign.roles[n]; }).map(function (n) { return roleCard(n); }),
          customRoles.map(function (n) { return roleCard(n); }),
          // 已删除的内置角色恢复区（仅删除过内置角色时出现）
          (assign.roles_remove || []).length
            ? h("div", { className: "omd-restoreRow" },
                h("div", { className: "omd-restoreTitle" }, "已删除的内置角色"),
                h("div", { className: "omd-chips" }, (assign.roles_remove || []).map(function (n) {
                  return h("button", {
                    type: "button",
                    key: n,
                    className: "omd-restorePill",
                    title: '恢复内置角色 "' + n + '"（工具面重建为内置默认 allow）',
                    onClick: function () { restoreBuiltinRole(n); },
                  }, "恢复 " + n);
                })),
                h("div", { className: "omd-hint" },
                  "恢复后卡片回到上方内置列表；工具面取内置默认（不沿用删前自定义配置）。"))
            : null,
          h("button", { type: "button", className: "omd-addRole", onClick: openRoleAddModal },
            h("span", { className: "omd-addRoleIcon" }, ic(P.IconPlusOutline16, 16)),
            h("span", null, "新建自定义 agent 角色"))),

        // 技能分配
        h("div", { className: "omd-group" },
          h("div", { className: "omd-groupHeading" },
            h("span", { className: "omd-groupIcon" }, ic(P.IconSkillOutline16, 14)),
            h("span", null, "技能分配（软约束：写入对应 agent 的 persona 引导）"),
            skillScopeNote(),
            h("span", { className: "omd-count" }, gridSkills.length)),
          // 工作区技能拉取失败的降级提示（一句话）：此刻网格数据源已回落用户级。
          activeWs !== null && wsSkillsErr
            ? statusRow("omd-statusWarn", ic(P.IconWarningOutline16, 16), wsSkillsErr)
            : null,
          skillsBlock()),

        // 预览生成（预览成功后才出现）
        preview ? h("div", { className: "omd-group", ref: previewRef },
          h("div", { className: "omd-groupHeading" },
            h("span", { className: "omd-groupIcon" }, ic(P.IconDataOutline16, 14)),
            h("span", null, "预览生成")),
          h("div", { className: "omd-previewSummary" },
            "✅ 生成成功（未写盘）" +
            (preview.presetId ? " · 预设 " + preview.presetId : "") +
            (preview.roleResults || []).map(function (r) {
              return " · " + r.role + ": " + r.intent.length + " → " + r.kept.length;
            }).join("")),
          h("pre", { className: "omd-pre" }, preview.text)) : null,

        // 悬浮操作坞（sticky bottom：按钮常驻滚动容器底部，改完配置无需滚回顶部再操作）
        h("div", { className: "omd-actionBar" },
          previewBtn, rescanBtn,
          h("span", { className: "omd-applyDock" }, applyBtn)));
    }

