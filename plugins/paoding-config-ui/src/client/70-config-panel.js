    // ── 通用确认弹窗（confirm 型模态框）────────────────────────────────────
    // 照 80-mount 的 createWorkspaceController 做模块级小状态器 + 单例：发起方
    // （ConfigPanel 的删除 / 保存并应用、86 页头的升级）与渲染方（86 的
    // ConfirmLayer）分属两棵 React 子树，中间隔着懒挂载的 createRoot，props
    // 传不通，靠快照 + subscribe 同步。req 纯 JS 对象直存（含 onConfirm 回调），
    // 不经 JSON 序列化。本片段拼接序在 86 之前，confirmCtrl / confirmModalOf
    // 由 86 直接共用，不得重复声明。
    function createConfirmController() {
      var snapshot = { req: null };
      var listeners = [];
      function notify() {
        listeners.slice().forEach(function (listener) { listener(); });
      }
      return {
        getSnapshot: function () { return snapshot; },
        subscribe: function (listener) {
          listeners.push(listener);
          return function () {
            var i = listeners.indexOf(listener);
            if (i !== -1) listeners.splice(i, 1);
          };
        },
        // 弹出确认框：opts = { title, body, confirmText, cancelText, danger, onConfirm }。
        // 不在这里执行 onConfirm——确认键点击时（confirmModalOf）先 close 再调，
        // req 先行清空，异步 onConfirm 期间弹窗已卸载，双击 / Enter 不会二触发。
        ask: function (opts) {
          snapshot = {
            req: {
              title: opts.title,
              body: opts.body,
              confirmText: opts.confirmText || "确认",
              cancelText: opts.cancelText || "取消",
              danger: !!opts.danger,
              onConfirm: opts.onConfirm,
            },
          };
          notify();
        },
        close: function () {
          if (snapshot.req === null) return;
          snapshot = { req: null };
          notify();
        },
      };
    }
    var confirmCtrl = createConfirmController();

    // 确认弹窗纯渲染函数：只依赖模块级 h / P，与控制器同址声明。结构对齐
    // wsModalOf / roleAddModalOf（pd-modalMask/Card/Header/Title/Close/Body/
    // Footer），正文用 pd-modalText（多行文案 pre-line），danger 时确认钮加
    // pd-dangerBtn（红底，删除类操作专用）。close 由 ConfirmLayer 传入。
    function confirmModalOf(req, close) {
      if (!req) return null;
      return h("div", { className: "pd-modalMask",
          // 只点遮罩空白处才收（mousedown 真正落在遮罩上），在卡片内按下拖选不误关
          onMouseDown: function (e) { if (e.target === e.currentTarget) close(); } },
        h("div", { className: "pd-modalCard pd-confirmCard", role: "alertdialog", "aria-modal": "true",
            "aria-label": req.title, "aria-describedby": "pd-confirmBody" },
          h("div", { className: "pd-modalHeader" },
            h("h2", { className: "pd-modalTitle" }, req.title),
            h("button", { type: "button", className: "pd-modalClose", "aria-label": "关闭", onClick: close },
              h("span", { className: "pd-closeGlyph", "aria-hidden": "true" }, "×"))),
          h("div", { className: "pd-modalBody" },
            h("div", { className: "pd-modalText", id: "pd-confirmBody" }, req.body)),
          h("div", { className: "pd-modalFooter" },
            // 焦点默认落在确认钮（危险操作落在取消钮）：开窗即可 Enter 确认 /
            // 取消，与原生 confirm 的键盘习惯对齐；danger 反向落焦是让破坏性
            // 操作多一道显式点击的门槛。弹窗关闭即整体卸载，重开重新自动聚焦。
            h(P.Button, { variant: "outline", size: "md", autoFocus: !!req.danger, onClick: close },
              req.cancelText || "取消"),
            h(P.Button, {
              variant: "primary",
              size: "md",
              className: req.danger ? "pd-dangerBtn" : undefined,
              autoFocus: !req.danger,
              onClick: function () {
                // 先 close 再执行：req 立即清空、按钮随弹窗卸载，onConfirm
                // 异步期间的重复点击 / Enter 都不会再命中确认路径。
                close();
                if (typeof req.onConfirm === "function") req.onConfirm();
              },
            }, req.confirmText || "确认"))));
    }

    // ── 主面板 ─────────────────────────────────────────────────────────────

    function ConfigPanel(props) {
      var _s = useState(null), data = _s[0], setData = _s[1];
      var _e = useState(null), error = _e[0], setError = _e[1];
      var _a = useState(null), assign = _a[0], setAssign = _a[1];
      var _b = useState(false), busy = _b[0], setBusy = _b[1];
      var _op = useState(null), busyOp = _op[0], setBusyOp = _op[1];
      var _p = useState(null), preview = _p[0], setPreview = _p[1];
      var _o = useState({}), openMap = _o[0], setOpenMap = _o[1];
      var _m = useState({}), personaMap = _m[0], setPersonaMap = _m[1];
      var _x = useState(false), extraOpen = _x[0], setExtraOpen = _x[1];
      var _r = useState(0), extraRev = _r[0], setExtraRev = _r[1];
      var _dnr = useState(0), displayNameRev = _dnr[0], setDisplayNameRev = _dnr[1]; // 主 agent 显示名 input 重挂（key 技巧）
      var _rn = useState({}), roleNameRev = _rn[0], setRoleNameRev = _rn[1]; // 内置角色显示名 input 重挂（每角色独立 key 计数）
      var _rm = useState({}), roleModelRev = _rm[0], setRoleModelRev = _rm[1]; // 角色专用模型/provider input 重挂（仅降级手输模式用；每角色独立 key 计数）
      var _mg = useState(null), modelGroups = _mg[0], setModelGroups = _mg[1]; // 模型目录 groups（/api/paoding/models）
      var _mgok = useState(false), modelGroupsOk = _mgok[0], setModelGroupsOk = _mgok[1]; // 目录可用 = 下拉模式；false = 降级双 input
      var _mgerr = useState(""), modelGroupsErr = _mgerr[0], setModelGroupsErr = _mgerr[1]; // 目录拉取失败原因（降级 hint 一句话展示）
      // 版本信息（/api/paoding/version；null = 未取到/检测失败，静默不显示）。
      // 状态挂在页头 PageShell（版本号展示在标题旁），经 props 下发：
      // setVerInfo 供 loadVersion 回写页头（版本号与更新卡都在 PageShell）。
      var setVerInfo = props && props.setVerInfo;
      var _ws = useState(null), activeWs = _ws[0], setActiveWs = _ws[1]; // 当前配置对象：null = 全局默认；否则工作区绝对路径
      // 视角切换计数：switchWorkspace 每次自增，拼进全部未受控（defaultValue）
      // 编辑器的 key——否则切 tab 不重挂，旧工作区输入框里未提交的文本会在
      // blur 时写进新工作区的 assign（串台）。现有各 rev 只覆盖「校验失败 /
      // 恢复默认」重挂，不覆盖切视角，故统一再加这一维。
      var _swr = useState(0), switchRev = _swr[0], setSwitchRev = _swr[1];
      var _wsl = useState([]), wsList = _wsl[0], setWsList = _wsl[1]; // 宿主工作区列表（GET /api/paoding/workspaces；失败降级为空数组，pill 由配置文件键兜底）
      var _wslt = useState(false), wsListTried = _wslt[0], setWsListTried = _wslt[1]; // 列表请求尘埃落定标记（成败均置位）：pendingOpenWs 消费条件用
      var _wsao = useState(false), wsAddOpen = _wsao[0], setWsAddOpen = _wsao[1]; // 「添加工作区」弹窗开合态（旧版是 tab 条下方的内联展开行）
      var _wsap = useState(""), wsAddPath = _wsap[0], setWsAddPath = _wsap[1];
      var _wsae = useState(""), wsAddErr = _wsae[0], setWsAddErr = _wsae[1];
      var _rao = useState(false), roleAddOpen = _rao[0], setRoleAddOpen = _rao[1]; // 「新建自定义 agent 角色」弹窗开合态（原原生 prompt 改模态框）
      var _ran = useState(""), roleAddName = _ran[0], setRoleAddName = _ran[1];
      var _radn = useState(""), roleAddDispName = _radn[0], setRoleAddDispName = _radn[1]; // 弹窗第二字段「显示名」（可选；残值语义同 roleAddName，成功提交才清）
      var _rabm = useState("one-shot"), roleAddBgMode = _rabm[0], setRoleAddBgMode = _rabm[1]; // 弹窗第三字段「会话模式」：'one-shot' | 'continuable'（残值语义同上，成功提交才复位）
      var _rae = useState(""), roleAddErr = _rae[0], setRoleAddErr = _rae[1];
      // 「重命名自定义角色」弹窗三件套（原原生 prompt 改模态框）：For 为
      // null = 关闭，非空 = 待改名的旧 toolName（身份键，提交时迁移 skills 引用）。
      var _rrf = useState(null), roleRenameFor = _rrf[0], setRoleRenameFor = _rrf[1];
      var _rrv = useState(""), roleRenameVal = _rrv[0], setRoleRenameVal = _rrv[1]; // 弹窗输入值（开窗预填旧名）
      var _rre = useState(""), roleRenameErr = _rre[0], setRoleRenameErr = _rre[1];
      var roleAddDispRef = useRef(null); // 显示名 input 引用：toolName 框 Enter 的移焦落点（两字段分工见 roleAddModalOf 注释）
      var _wsc = useState(null), wsCands = _wsc[0], setWsCands = _wsc[1]; // 服务端候选目录（?discover=1）；null = 未拉到（含失败），纯手输兜底
      var _wsso = useState(false), wsSuggestOpen = _wsso[0], setWsSuggestOpen = _wsso[1]; // 建议下拉展开态（跟随输入框焦点 / Esc）
      var _wsmo = useState(false), wsMenuOpen = _wsmo[0], setWsMenuOpen = _wsmo[1]; // 「更多」下拉展开态（放不下收进来的那批工作区）
      var _wssk = useState(null), wsSkills = _wssk[0], setWsSkills = _wssk[1]; // 当前工作区技能合并列表（用户级 + 该工作区项目级；null = 全局视角 / 未拉到）
      var _wspk = useState(null), wsProjSkills = _wspk[0], setWsProjSkills = _wspk[1]; // 项目级技能子集（Set，与 wsSkills 同源同步；项目角标据此渲染）
      var _wsse = useState(""), wsSkillsErr = _wsse[0], setWsSkillsErr = _wsse[1]; // 工作区技能拉取失败的降级一句话提示
      var wsSkillsCacheRef = useRef({}); // 工作区技能缓存：每路径只拉一次（面板生命周期；失败也记 null 不重试）
      var wsCandsTriedRef = useRef(false); // 候选只拉一次的面板级闸门（失败的尝试也算数，防聚焦一次请求一次）
      var activeWsRef = useRef(activeWs); // load / rescan / preview / apply 等异步回调里读最新值，不依赖闭包里的旧 activeWs
      activeWsRef.current = activeWs; // 渲染期同步（回调只在这些 setter 之后触发，安全）
      var rootRef = useRef(null); // 面板根节点（重新检测后回顶用）
      var previewRef = useRef(null); // 预览生成组根节点（条件渲染，预览成功后定位用）
      var assignRef = useRef(assign); // doPreview 完成回调里比对请求时快照：生成期间 assign 变过则结果作废
      assignRef.current = assign; // 渲染期同步（同 activeWsRef 的做法）
      var _sr = useState(null), scrollReq = _sr[0], setScrollReq = _sr[1]; // 滚动请求："preview" | "top" | null
      // 工作区标签行自动收纳：量出标签行实宽后由装填算法决定直接露出几个
      // tab（wsFitCount），放不下的收进「更多」。tabWidthsRef 缓存测量层量到
      // 的每个 tab 自然宽度（data-ws-key → offsetWidth），跨渲染复用。
      var tabsRowRef = useRef(null); // .omd-tabs 标签行（宽度来源）
      var tabsMeasureRef = useRef(null); // 隐藏测量层容器
      var tabWidthsRef = useRef({});
      var _rw = useState(0), tabsRowWidth = _rw[0], setTabsRowWidth = _rw[1];
      var _fc = useState(WS_TABS_FALLBACK_COUNT), wsFitCount = _fc[0], setWsFitCount = _fc[1]; // 初值与兜底 = 测量未就绪时的固定 5 个

      var ready = !!(data && assign); // 面板数据就绪：宽度观察 / 装填计算只在就绪后跑
      // 装填计算的依赖指纹：工作区集合、显示顺序、文案或安装标记任一变化都会
      // 改变这个串，effect 据此重算收纳个数（行宽变化经 tabsRowWidth 触达）。
      // 必须先于下方用到它的 useEffect 求值，依赖数组才能拿到当次渲染的值。
      var wsMetaNow = (data && data.workspaceMeta) || {};
      var existingWsKey = (data && data.existing && data.existing.workspaces) || null;
      var wsWidthKey = "";
      (function buildKey() {
        var rowsFor = workspaceRowsOf(data, wsList);
        var ord = wsDisplayOrderOf(rowsFor, activeWs);
        for (var i = 0; i < ord.length; i++) {
          var m = wsMetaNow[ord[i].path];
          wsWidthKey += (i ? "|" : "") + ord[i].path + ":" + wsLabelOf(ord[i]) + ":"
            + (ord[i].sessionCount != null ? ord[i].sessionCount : "-") + ":"
            + (m && m.installed ? "2" : existingWsKey && Object.prototype.hasOwnProperty.call(existingWsKey, ord[i].path) ? "1" : "0");
        }
      })();

      // 实现在模块级 paodingApi（PageShell 的页头升级卡也用它），这里薄包一层
      // 保持既有调用点与 useCallback 依赖口径不变。
      var api = useCallback(function (path, body) { return paodingApi(path, body); }, []);

      // 目标配置基座选取：工作区视角（wsPath 非空）优先取该工作区已保存条目
      // （existing.workspaces[wsPath]，没应用过则回落剥掉 workspaces/profile 的
      // 全局 existing），全局视角直接用 existing（同样剥污染键）、再回落建议值。
      // 返回的 assignments 只由下方显式字段拼出，workspaces / profile 两个容器
      // 键天然混不进 POST 体。
      var buildTargetAssignments = useCallback(function (d, wsPath) {
        var base = null;
        if (wsPath) {
          var wsCfg = d.existing && d.existing.workspaces && d.existing.workspaces[wsPath];
          if (wsCfg) base = wsCfg;
        }
        if (!base) {
          base = globalConfigOf(d) || d.suggested || { roles: {}, roles_remove: [], main_agent_display_name: null, main_agent_extra: [], main_agent_remove: [], main_agent_skills: [], main_agent_skills_inline: [], main_agent_persona_extra: null, skills: {} };
        }
        // roles_remove：被删除的内置角色名单（只含 DEFAULT_ROLES 名）。名单内的内置角色
        // 不重建进 roles —— 删除状态跨刷新 / 重新检测保留，卡片消失，仅留在恢复区。
        var removed = (base.roles_remove || []).filter(function (n) { return DEFAULT_ROLES.indexOf(n) !== -1; });
        var roles = {};
        DEFAULT_ROLES.forEach(function (name) {
          if (removed.indexOf(name) !== -1) return;
          roles[name] = {
            persona: (base.roles && base.roles[name] && base.roles[name].persona) || null,
            // 显示名透传：string 非 '' 保留，缺省 / '' / null 一律 null（内置默认条目 name:null）
            name: roleNameOf(base.roles, name),
            // 专用模型 / provider 透传：string 非 '' 保留，缺省 / '' / null 一律 null
            //（null = 跟随主 agent 当前模型；provider 只配不配 model 时后端 warn 并忽略）
            model: roleStringRef(base.roles, name, "model"),
            provider: roleStringRef(base.roles, name, "provider"),
            // 会话模式透传：仅 'continuable' 认可，其余归 'one-shot'（字面量，
            // 与 config 层 normalizeBackgroundMode 的序列化形状一致）
            background_mode: roleBgModeOf(base.roles, name),
            tools: (base.roles && base.roles[name] && base.roles[name].tools) ||
              (d.blocks && d.blocks[name]) || [],
          };
        });
        Object.keys(base.roles || {}).forEach(function (name) {
          if (DEFAULT_ROLES.indexOf(name) !== -1) return;
          roles[name] = {
            persona: base.roles[name].persona || null,
            name: roleNameOf(base.roles, name),
            // 自定义角色同样携带 model / provider（null 或 string），形状与内置一致
            model: roleStringRef(base.roles, name, "model"),
            provider: roleStringRef(base.roles, name, "provider"),
            // 会话模式与内置同款收法：'one-shot' = 缺省一次性，'continuable' = 可续
            background_mode: roleBgModeOf(base.roles, name),
            tools: base.roles[name].tools || [],
          };
        });
        return {
          roles: roles,
          roles_remove: removed,
          // 显示名键（仅 preset 显示名，persona 身份行不可改名）：null / '' / 缺省
          // 一律归一为 null（= 默认「编排模式 (Orchestrator)」，工作区预设用派生名）
          main_agent_display_name: base.main_agent_display_name == null || base.main_agent_display_name === "" ? null : base.main_agent_display_name,
          main_agent_extra: base.main_agent_extra || [],
          main_agent_remove: base.main_agent_remove || [],
          main_agent_skills: (base.main_agent_skills || []).slice(),
          main_agent_skills_inline: (base.main_agent_skills_inline || []).slice(),
          // 语义：null/缺省 = 用默认常量（compose 时回落）；'' = 明确清空；其他 = 用户覆盖
          main_agent_persona_extra: base.main_agent_persona_extra == null ? null : base.main_agent_persona_extra,
          skills: Object.assign({}, base.skills || {}),
        };
      }, []);

      var load = useCallback(function () {
        api("state").then(function (d) {
          setData(d);
          setAssign(buildTargetAssignments(d, activeWsRef.current));
        }).catch(function (err) { setError(err.message); });
      }, [api, buildTargetAssignments]);

      useEffect(load, [load]);

      // 工作区列表：面板加载时拉一次宿主注册表（与 state 并行）。失败降级为
      // 空列表——workspaceRowsOf 会用 state.existing.workspaces 的键兜底出 pill，
      // 绝不阻塞面板。
      var loadWorkspaces = useCallback(function () {
        api("workspaces").then(function (d) {
          if (!d || d.ok !== true || !Array.isArray(d.items)) throw new Error("工作区列表响应格式异常");
          setWsList(d.items);
          setWsListTried(true);
        }).catch(function () {
          setWsList([]); // 静默降级：只用配置文件里已有的工作区键
          setWsListTried(true);
        });
      }, [api]);

      useEffect(loadWorkspaces, [loadWorkspaces]);

      // 宿主菜单「庖丁配置」入口的落地：state 与工作区列表都就绪（列表成败
      // 均算就绪，wsListTried 见 loadWorkspaces）后，把 pendingOpenWs 指着的
      // 工作区切为激活 tab。找不到（未注册 / 列表拉失败）给 warn、留在当前
      // tab，一次性消费不再重试。
      useEffect(function () {
        if (pendingOpenWs === null || !data || !wsListTried) return;
        var target = pendingOpenWs;
        pendingOpenWs = null;
        var rows = workspaceRowsOf(data, wsList);
        var hit = null;
        for (var i = 0; i < rows.length; i++) {
          if (rows[i].path.replace(/[\/\\]+$/, "") === target) { hit = rows[i].path; break; }
        }
        if (hit) switchWorkspace(hit);
        else toast.warn("工作区 " + target + " 不在列表里，未切换 tab");
      }, [data, wsListTried]);

      // 「添加工作区」候选：输入框首次聚焦时拉一次服务端扫描
      //（GET workspaces?discover=1），面板生命周期内缓存不重拉（含失败的
      // 尝试——不该每次聚焦都打一遍接口）。请求错误 / 响应异常一律静默：
      // 候选保持 null，输入框退化成现状的纯手输，不弹错不打扰。
      function loadWsCands() {
        if (wsCandsTriedRef.current) return;
        wsCandsTriedRef.current = true;
        api("workspaces?discover=1").then(function (d) {
          if (d && d.ok === true && Array.isArray(d.items)) setWsCands(d.items);
        }).catch(function () { /* 静默降级：纯手输 */ });
      }

      // 按工作区拉技能（GET workspaces?skills=1&path=…）：切到某工作区时拉取
      // 该目录的技能全集（用户级 + 该工作区项目级）与项目级子集。面板生命周期
      // 内每路径只拉一次（结果存 wsSkillsCacheRef，失败也记 null 不重试）。
      // 失败降级：wsSkills 置 null（技能网格回落 data.skills 用户级）并留一句
      // 提示；切回全局清空两态。响应回来时若已切走（activeWsRef 对不上）只写
      // 缓存、不再动当前视图，防串台。
      function applyWsSkills(wsPath) {
        if (!wsPath) {
          setWsSkills(null);
          setWsProjSkills(null);
          setWsSkillsErr("");
          return;
        }
        var cached = wsSkillsCacheRef.current[wsPath];
        if (cached !== undefined) {
          setWsSkills(cached ? cached.skills : null);
          setWsProjSkills(cached ? new Set(cached.projectSkills) : null);
          setWsSkillsErr(cached ? "" : "该工作区技能列表拉取失败，技能网格已回退用户级技能");
          return;
        }
        api("workspaces?skills=1&path=" + encodeURIComponent(wsPath)).then(function (d) {
          if (!d || d.ok !== true || !Array.isArray(d.skills)) throw new Error("技能列表响应格式异常");
          var proj = Array.isArray(d.projectSkills) ? d.projectSkills : [];
          wsSkillsCacheRef.current[wsPath] = { skills: d.skills, projectSkills: proj };
          if (activeWsRef.current !== wsPath) return; // 期间已切走：只留缓存
          setWsSkills(d.skills);
          setWsProjSkills(new Set(proj));
          setWsSkillsErr("");
        }).catch(function () {
          wsSkillsCacheRef.current[wsPath] = null;
          if (activeWsRef.current !== wsPath) return;
          setWsSkills(null);
          setWsProjSkills(null);
          setWsSkillsErr("该工作区技能列表拉取失败，技能网格已回退用户级技能");
        });
      }

      // 切换配置对象（全局 ↔ 工作区）：按新视角重建 assign，并清掉上一视角的
      // 预览（预览文本对应的是旧目标，留着只会误导）；切到工作区时顺带
      // 拉取该工作区的技能列表（带缓存，见 applyWsSkills）。
      function switchWorkspace(wsPath) {
        setActiveWs(wsPath);
        activeWsRef.current = wsPath;
        if (data) setAssign(buildTargetAssignments(data, wsPath));
        setPreview(null);
        setSwitchRev(switchRev + 1); // 未受控编辑器随 key 变化重挂：显示新目标值，blur 不再把旧视角文本写进新视角
        applyWsSkills(wsPath);
      }

      // 添加工作区：POST /api/paoding/workspaces 注册到宿主（幂等），成功后
      // 刷新工作区列表并切到该工作区（未应用过配置的工作区先回落全局现状，
      // 首次「保存并应用」才生成工作区专属 preset 与 workspaces 条目）。
      // rawPath 仅组合框建议行点击时传选中的候选路径（只认 string，按钮
      // onClick 透传进来的事件对象等一律回落当前输入值，Enter 语义不变）。
      function submitWorkspace(rawPath) {
        var p = String(typeof rawPath === "string" ? rawPath : wsAddPath || "").trim();
        if (p === "") return;
        setBusy(true);
        setBusyOp("wsadd");
        api("workspaces", { path: p }).then(function (r) {
          var ws = (r && r.workspace) || {};
          var wsPath = typeof ws.path === "string" && ws.path !== "" ? ws.path : p;
          setWsAddPath("");
          setWsAddOpen(false);
          setWsSuggestOpen(false);
          setWsAddErr("");
          return api("workspaces").then(function (d) {
            if (d && d.ok === true && Array.isArray(d.items)) setWsList(d.items);
            switchWorkspace(wsPath);
            toast.ok((r.created === false ? "工作区已在列表里：" : "已注册工作区：") + wsPath + "；配置后点「保存并应用」生成专属预设");
          });
        }).catch(function (err) {
          setWsAddErr(err.message);
        }).finally(function () {
          setBusy(false);
          setBusyOp(null);
        });
      }

      // 收起「添加工作区」弹窗（右上 × / 取消按钮 / 点遮罩空白处共用）。不清
      // wsAddPath / wsAddErr：成功路径由 submitWorkspace 自己清理，取消后重开
      // 保留残值——改两个字就能续填，报错文案也留着，重开即见上次失败原因。
      function closeWsModal() {
        setWsAddOpen(false);
        setWsSuggestOpen(false);
      }

      // 收起「新建自定义 agent 角色」弹窗（右上 × / 取消按钮 / 点遮罩空白处
      // 共用）。同样不清 roleAddName / roleAddDispName / roleAddErr：取消重开
      // 保留残值续填。
      function closeRoleAddModal() {
        setRoleAddOpen(false);
      }

      // 收起「重命名自定义角色」弹窗（右上 × / 取消按钮 / 点遮罩空白处 /
      // Esc 共用）。同样不清 roleRenameVal / roleRenameErr：取消重开保留
      // 残值续填，重开时由 renameRole 重置（预填旧名 + 清错误行）。
      function closeRoleRenameModal() {
        setRoleRenameFor(null);
      }

      // 弹窗 / 「更多」菜单的 Esc 分层拦截：捕获阶段先于 PageShell 的冒泡监听
      // 触发，stopPropagation 之后页面级关页逻辑不再收到该事件。优先级：更多
      // 菜单 > 弹窗；弹窗里建议下拉还开着时先只收下拉，再按一次才收弹窗。
      // 确认弹窗（confirmCtrl）不在本链里——它的 Esc 由 86 的 ConfirmLayer
      // 自带捕获级监听处理（注册在本监听之后，本监听只在自己弹窗开着时才
      // stopPropagation，互不踩踏）。
      useEffect(function () {
        var onKey = function (e) {
          if (!e || e.key !== "Escape") return;
          if (wsMenuOpen) { e.stopPropagation(); setWsMenuOpen(false); return; }
          if (wsAddOpen) {
            e.stopPropagation();
            if (wsSuggestOpen) setWsSuggestOpen(false);
            else setWsAddOpen(false);
          }
          if (roleAddOpen) { e.stopPropagation(); closeRoleAddModal(); }
          if (roleRenameFor) { e.stopPropagation(); closeRoleRenameModal(); }
        };
        document.addEventListener("keydown", onKey, true);
        return function () { document.removeEventListener("keydown", onKey, true); };
      }, [wsAddOpen, wsSuggestOpen, wsMenuOpen, roleAddOpen, roleRenameFor]);

      // 「更多」菜单的外点关闭：目标不在菜单本体、也不在「更多」按钮内就收起。
      // 不 stopPropagation——正常点击照常生效；菜单项与「更多」按钮自身的
      // onClick 已各自收菜单，这里只兜「点面板其它地方」这一种情况。
      useEffect(function () {
        if (!wsMenuOpen) return;
        var onDocClick = function (e) {
          var t = e && e.target;
          if (t && typeof t.closest === "function" && t.closest(".omd-tabMenu, .omd-tabMore")) return;
          setWsMenuOpen(false);
        };
        document.addEventListener("click", onDocClick, true);
        return function () { document.removeEventListener("click", onDocClick, true); };
      }, [wsMenuOpen]);

      // 标签行宽度观察：就绪后先量一次行宽，再挂 ResizeObserver 跟随窗口缩放、
      // 侧栏开合等布局变化。老环境没有 ResizeObserver 就止步于这一次测量，
      // 收纳个数停在兜底值（WS_TABS_FALLBACK_COUNT），交互不缺失只是不自适应。
      useEffect(function () {
        if (!ready) return;
        var row = tabsRowRef.current;
        if (!row) return;
        var measure = function () { setTabsRowWidth(row.clientWidth); };
        measure();
        if (typeof ResizeObserver !== "function") return;
        var ro = new ResizeObserver(measure);
        ro.observe(row);
        return function () { ro.disconnect(); };
      }, [ready]);

      // 装填计算：先从测量层收一轮实测宽度（data-ws-key → offsetWidth），再按
      // 「全局默认必放、工作区按显示顺序逐个尝试」做前缀和装填，算出直接露出
      // 的 tab 个数。行宽为 0 或某行宽度还没量到（首帧）就维持现值等下一轮——
      // 首帧 wsFitCount 仍是兜底 5，宽度到位后这里修正，可能轻微跳变，可接受。
      useEffect(function () {
        if (!ready) return;
        var layer = tabsMeasureRef.current;
        if (layer) {
          var nodes = layer.querySelectorAll("[data-ws-key]");
          for (var i = 0; i < nodes.length; i++) {
            tabWidthsRef.current[nodes[i].getAttribute("data-ws-key")] = nodes[i].offsetWidth;
          }
        }
        var widths = tabWidthsRef.current;
        var globalW = widths.__global__ || 0;
        var addW = widths.__add__ || 0;
        var moreW = widths.__more__ || 0;
        if (!globalW || !addW || !tabsRowWidth) return; // 测量未就绪：维持现值
        var order = wsDisplayOrderOf(workspaceRowsOf(data, wsList), activeWs);
        // gap 4px、行内边距 2px×2，再留 8px 安全余量抵消「更多」计数徽标的
        // 位数差与亚像素取整。
        var GAP = 4, SAFETY = 8;
        var avail = tabsRowWidth - 4 - SAFETY;
        var prefix = [0];
        for (var j = 0; j < order.length; j++) {
          var w = widths[order[j].path] || 0;
          if (!w) return; // 某行还没量到（首帧）：等下一轮，别算出缩水值
          prefix.push(prefix[j] + w);
        }
        var N = order.length, k = 0;
        while (k < N) {
          var next = k + 1;
          // 放进 next 个工作区时整行要摆：全局默认 + 这 next 个 + 「＋」，
          // 还有装不下的（next < N）就再为「更多」预留一位；间隙数 = 项数 - 1。
          var need = globalW + prefix[next] + addW + (next < N ? moreW : 0) + GAP * (1 + next + (next < N ? 1 : 0));
          if (need > avail) break;
          k = next;
        }
        setWsFitCount(k);
      }, [ready, tabsRowWidth, wsWidthKey]);

      // 模型目录：与 loadState 并行拉一次（目录发现可能稍慢，属正常；失败不
      // 阻塞面板，只把角色专用模型降级为双 input 手输）。请求错误 / ok:false /
      // 响应格式异常都归入降级，原因一句话留在 modelGroupsErr。
      var loadModels = useCallback(function () {
        api("models").then(function (d) {
          var groups = d && Array.isArray(d.groups) ? d.groups : null;
          if (!d || d.ok !== true || !groups) throw new Error("模型目录响应格式异常");
          setModelGroups(groups);
          setModelGroupsOk(true);
          setModelGroupsErr("");
        }).catch(function (err) {
          setModelGroupsOk(false);
          setModelGroupsErr(err.message);
        });
      }, [api]);

      useEffect(loadModels, [loadModels]);

      // 版本提示：面板挂载后异步拉一次 /api/paoding/version（api 助手无 body
      // 即 GET，与首屏 state/models 并行、不阻塞渲染；服务端带 1 小时缓存且
      // 绝不 5xx）。失败静默：不设 error 状态——检测只是锦上添花，网络不通、
      // 接口异常都不该打扰面板；error/latest 皆空时 versionRowOf 也不渲染。
      var loadVersion = useCallback(function () {
        api("version").then(function (d) {
          if (d && typeof d.current === "string" && d.current && typeof setVerInfo === "function") setVerInfo(d);
        }).catch(function () { /* 静默：版本检测失败不影响面板 */ });
      }, [api]);

      useEffect(loadVersion, [loadVersion]);

      // 滚动请求：preview 需等条件渲染挂载后生效（effect 在 commit 后运行），top 立即生效。
      useEffect(function () {
        if (!scrollReq) return;
        var el = scrollReq === "preview" ? previewRef.current : rootRef.current;
        if (el && el.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "start" });
        setScrollReq(null);
      }, [scrollReq, preview]);

      function setRoleTools(name, tool, on) {
        setAssign(function (prev) {
          var next = JSON.parse(JSON.stringify(prev));
          var list = next.roles[name].tools;
          if (on && list.indexOf(tool) === -1) list.push(tool);
          if (!on) next.roles[name].tools = list.filter(function (t) { return t !== tool; });
          return next;
        });
      }

      function setMainExtra(tool, on) {
        setAssign(function (prev) {
          var next = JSON.parse(JSON.stringify(prev));
          if (on && next.main_agent_extra.indexOf(tool) === -1) next.main_agent_extra.push(tool);
          if (!on) next.main_agent_extra = next.main_agent_extra.filter(function (t) { return t !== tool; });
          return next;
        });
      }

      function setMainRemove(tool, on) {
        setAssign(function (prev) {
          var next = JSON.parse(JSON.stringify(prev));
          next.main_agent_remove = next.main_agent_remove || [];
          if (on && next.main_agent_remove.indexOf(tool) !== -1) next.main_agent_remove = next.main_agent_remove.filter(function (t) { return t !== tool; });
          if (!on && next.main_agent_remove.indexOf(tool) === -1) next.main_agent_remove.push(tool);
          return next;
        });
      }

      function setMainSkill(skill, on) {
        setAssign(function (prev) {
          var next = JSON.parse(JSON.stringify(prev));
          next.main_agent_skills = next.main_agent_skills || [];
          if (on && next.main_agent_skills.indexOf(skill) === -1) next.main_agent_skills.push(skill);
          if (!on) next.main_agent_skills = next.main_agent_skills.filter(function (s) { return s !== skill; });
          return next;
        });
      }

      function setMainSkillInline(skill, on) {
        setAssign(function (prev) {
          var next = JSON.parse(JSON.stringify(prev));
          next.main_agent_skills_inline = next.main_agent_skills_inline || [];
          if (on && next.main_agent_skills_inline.indexOf(skill) === -1) next.main_agent_skills_inline.push(skill);
          if (!on) next.main_agent_skills_inline = next.main_agent_skills_inline.filter(function (s) { return s !== skill; });
          return next;
        });
      }

      function setSkill(skill, role, on) {
        setAssign(function (prev) {
          var next = JSON.parse(JSON.stringify(prev));
          var picked = next.skills[skill] || [];
          if (on && picked.indexOf(role) === -1) picked.push(role);
          if (!on) picked = picked.filter(function (r) { return r !== role; });
          if (picked.length) next.skills[skill] = picked;
          else delete next.skills[skill];
          return next;
        });
      }

      // 主 persona 尾部追加（main_agent_persona_extra）写入：
      // 全空 → ''（明确清空，不追加任何内容）；与默认常量一致 → null（= 用默认常量，
      // 代码里 DEFAULT_MAIN_AGENT_PERSONA_EXTRA 演进时自动跟随）；其余 → 用户覆盖文本。
      function setMainPersonaExtra(raw) {
        setAssign(function (prev) {
          var next = JSON.parse(JSON.stringify(prev));
          var v = String(raw || "").replace(/[ \t\r\n]+$/, "");
          var def = (data && data.mainPersonaExtraDefault) || "";
          if (v.trim() === "") next.main_agent_persona_extra = "";
          else next.main_agent_persona_extra = v === def ? null : v;
          return next;
        });
      }

      function restoreMainPersonaExtra() {
        setAssign(function (prev) {
          var next = JSON.parse(JSON.stringify(prev));
          next.main_agent_persona_extra = null; // null = 用默认常量
          return next;
        });
        setExtraRev(extraRev + 1); // 重挂 textarea，defaultValue 重新取默认文本
      }

      // 「新建自定义 agent 角色」三件套（原原生 prompt 实现改为模态框，
      // 弹窗本体见下方 roleAddModalOf）：open 开弹窗，close 收起，submit
      // 做校验 + 创建。校验失败走弹窗内错误行，不再用原生弹窗 / toast。
      function openRoleAddModal() {
        setRoleAddErr(""); // 上次失败原因开弹窗即清；roleAddName / roleAddDispName
        // 故意不清——与 closeWsModal「取消保留残值」同语义，重开接着上次输入续填。
        setRoleAddOpen(true);
      }

      function submitRoleAdd() {
        var name = String(roleAddName || "").trim();
        // 空名静默吞掉：确认按钮在空值时本来就 disabled，这里只兜输入框直接
        // 按 Enter 的路径（与旧 prompt 实现的 if (!name) return 同语义）。
        if (name === "") return;
        if (!/^[a-z][a-z0-9_-]{1,31}$/.test(name)) { setRoleAddErr("角色名须为 2-32 位小写字母/数字/下划线/连字符"); return; }
        // 内置名不可经「新建」再造：已删除（不在 roles、在 roles_remove）的
        // 内置名在此拦截并引导走恢复区，避免同一内置名同时出现在卡片流与
        // 「已删除的内置角色」恢复区；仍正常存在的内置名由下方「已存在」命中。
        if (DEFAULT_ROLES.indexOf(name) !== -1) { setRoleAddErr('内置角色不可新建（"' + name + '"如已删除，请在下方「已删除的内置角色」区恢复）'); return; }
        // 已存在检查从 setAssign updater 挪到外层：报错要走弹窗内错误行，
        // setState 副作用不能塞进 updater；闭包 assign 与点击时刻一致，双击
        // 极端场景下重复创建也只是同形状覆盖，幂等无害。
        if (assign.roles[name]) { setRoleAddErr('角色 "' + name + '" 已存在'); return; }
        // 显示名校验与 roleTitleBlock 的 commitRoleName 同源（不含 \r \n、
        // trim 后 ≤60、空 = null）：新建时就把显示名写进出厂形状，省得建完
        // 再去卡片里补一枪。报错走弹窗内错误行（不 toast）——此刻弹窗还开着，
        // 错误行就贴在输入框下面，比 toast 更贴输入现场。
        var dispRaw = String(roleAddDispName == null ? "" : roleAddDispName);
        if (/[\r\n]/.test(dispRaw)) { setRoleAddErr("显示名不能包含换行（\\r / \\n）"); return; }
        var dispTrim = dispRaw.trim();
        if (dispTrim.length > 60) { setRoleAddErr("显示名过长：trim 后最多 60 字符"); return; }
        var disp = dispTrim === "" ? null : dispTrim; // 空 / 纯空白 = null：事件流标题回落 toolName
        setAssign(function (prev) {
          var next = JSON.parse(JSON.stringify(prev));
          // 新角色全字段出厂形状：与 buildAssignments / restoreBuiltinRole 条目一致
          //（model/provider 置 null = 跟随主 agent 当前模型；background_mode
          // 用弹窗单选值，字面量 'one-shot' | 'continuable'）。name 是可选
          // 显示名（null = 用 toolName 当标题），不再恒 null。
          next.roles[name] = {
            persona: null,
            name: disp,
            model: null,
            provider: null,
            background_mode: roleAddBgMode,
            // 出厂 tools 默认全选 = 核心工具面（customCoreToolsOf：restrictBase
            // 去四个委派名与 mcp__ 工具）+ host 检测库存。两集合不相交，无需去重
            //（render 侧 roleCandidateTools 拼候选时自带去重兜底）。
            tools: customCoreToolsOf(data).concat((data && data.inventory) || []),
          };
          return next;
        });
        setRoleAddOpen(false);
        setRoleAddName("");
        setRoleAddDispName("");
        setRoleAddBgMode("one-shot"); // 成功提交即复位出厂默认（取消重开才保留残值）
        setRoleAddErr("");
        toast.ok('已新建角色 "' + name + '"，记得「保存并应用」');
      }

      // 自定义角色改名（toolName = 委派调用名）：名称是身份键，改它要联动
      // 迁移 skills 里的角色引用（skills.<技能> = [角色名…]）。roles 键按原
      // 顺序重建（旧名位置原位替换）；校验与新建同源（2-32 位小写字母/数字/
      // 下划线/连字符），内置名 / 已存在的名字一律拦。只改当前视角的
      // assignments——工作区视角改的是该工作区条目，别的视角不动（与编辑
      // 语义一致）。应用后生成侧换 delegation-<新名> 委派块，旧调用名消失，
      // 需重启 / 新会话生效。
      // 原原生 prompt 实现改为模态框三件套（弹窗本体见 72 片段的
      // roleRenameModalOf）：open 开窗预填旧名，close 收起，submit 走校验链。
      // 校验失败走弹窗内错误行，不再 toast。
      function renameRole(name) {
        setRoleRenameVal(name); // 预填当前名：多数场景只改一两个字
        setRoleRenameErr("");
        setRoleRenameFor(name);
      }

      function submitRoleRename() {
        var name = roleRenameFor; // 旧名（身份键）
        var v = String(roleRenameVal || "").trim();
        // 未改动：原 prompt 下按 Enter 即关窗（只是没改名），这里对齐——直接收起。
        if (v === name) { closeRoleRenameModal(); return; }
        if (!/^[a-z][a-z0-9_-]{1,31}$/.test(v)) { setRoleRenameErr("角色名须为 2-32 位小写字母/数字/下划线/连字符"); return; }
        if (DEFAULT_ROLES.indexOf(v) !== -1) { setRoleRenameErr('不可改成内置角色名 "' + v + '"'); return; }
        // 已存在检查从 setAssign updater 挪到外层（与 submitRoleAdd 同款）：
        // 报错要走弹窗内错误行，setState 副作用不能塞进 updater；闭包 assign
        // 与点击时刻一致。
        if (assign.roles[v]) { setRoleRenameErr('角色 "' + v + '" 已存在'); return; }
        setAssign(function (prev) {
          var next = JSON.parse(JSON.stringify(prev));
          var roles = {};
          Object.keys(next.roles).forEach(function (k) { roles[k === name ? v : k] = next.roles[k]; });
          next.roles = roles;
          Object.keys(next.skills || {}).forEach(function (sk) {
            var arr = next.skills[sk];
            if (Array.isArray(arr) && arr.indexOf(name) !== -1) {
              next.skills[sk] = arr.map(function (r) { return r === name ? v : r; });
            }
          });
          return next;
        });
        // 卡片开合状态跟着换键（旧键遗留无碍，顺手清干净）
        setOpenMap(function (m) {
          if (!(name in m)) return m;
          var c = Object.assign({}, m);
          c[v] = c[name];
          delete c[name];
          return c;
        });
        closeRoleRenameModal();
        setRoleRenameVal("");
        setRoleRenameErr("");
        toast.ok('已重命名 "' + name + '" → "' + v + '"，记得「保存并应用」');
      }

      function removeRole(name) {
        // 原原生 confirm 改通用确认弹窗：删除属破坏性操作，danger 红底确认钮。
        confirmCtrl.ask({
          title: "删除自定义角色",
          body: "删除自定义角色 \"" + name + "\"？",
          danger: true,
          confirmText: "确认删除",
          onConfirm: function () {
            setAssign(function (prev) {
              var next = JSON.parse(JSON.stringify(prev));
              delete next.roles[name];
              Object.keys(next.skills).forEach(function (s) {
                next.skills[s] = next.skills[s].filter(function (r) { return r !== name; });
              });
              return next;
            });
          },
        });
      }

      // 内置角色删除：roles 删 key + skills 引用剔除 + roles_remove 记名（去重）。
      // 后端语义：roles_remove 里的内置名 = 已删除（卡片消失、生成不再委派），
      // 可经 restoreBuiltinRole 恢复；自定义角色删除语义不变（只删 roles key，不进 roles_remove）。
      function removeBuiltinRole(name) {
        // 原原生 confirm 改通用确认弹窗；文案含恢复引导（多行由
        // pd-modalText 的 pre-line 保留换行），danger 红底确认钮。
        confirmCtrl.ask({
          title: "删除内置角色",
          body: "删除内置角色 \"" + name + "\"？\n该角色的委派工具、工具面、persona 与主 agent 的委派指引将一并移除；\n可在下方「已删除的内置角色」区一键恢复。",
          danger: true,
          confirmText: "确认删除",
          onConfirm: function () {
            setAssign(function (prev) {
              var next = JSON.parse(JSON.stringify(prev));
              delete next.roles[name];
              Object.keys(next.skills).forEach(function (s) {
                next.skills[s] = next.skills[s].filter(function (r) { return r !== name; });
              });
              next.roles_remove = next.roles_remove || [];
              if (next.roles_remove.indexOf(name) === -1) next.roles_remove.push(name);
              return next;
            });
          },
        });
      }

      // 内置角色恢复：roles_remove 除名 + 重建角色。工具面取内置默认 allow
      // （data.blocks[name]），不沿用删前自定义配置——恢复即出厂默认，简化处理。
      // 显示名同样置 null（出厂默认），重建条目与 buildAssignments 形状一致。
      // 专用模型 / provider 同理置 null：恢复 = 回到「跟随主 agent 当前模型」，
      // 不保留删前的模型固定配置。background_mode 置 'one-shot'（出厂缺省）。
      function restoreBuiltinRole(name) {
        setAssign(function (prev) {
          var next = JSON.parse(JSON.stringify(prev));
          next.roles_remove = (next.roles_remove || []).filter(function (r) { return r !== name; });
          var defTools = (data && data.blocks && data.blocks[name]) || [];
          next.roles[name] = { persona: null, name: null, model: null, provider: null, background_mode: "one-shot", tools: defTools.slice() };
          return next;
        });
      }

      function doPreview() {
        if (!assign) return;
        var reqAssign = assign;
        setBusy(true);
        setBusyOp("preview");
        setPreview(null);
        // workspace 透传当前配置对象（null = 全局默认），服务端据此选生成落点。
        api("preview", { assignments: reqAssign, workspace: activeWsRef.current }).then(function (r) {
          if (assignRef.current !== reqAssign) return; // 生成期间配置已改：结果过期，不挂旧预览
          setPreview(r);
          setScrollReq("preview"); // 预览成功后自动滚动定位到预览生成区
        }).catch(function (err) { toast.err(err.message); }).finally(function () {
          setBusy(false);
          setBusyOp(null);
        });
      }

      // 预览时效：assign 一变即作废已挂出的预览——预览文本对应生成时刻的目标
      // 配置，继续挂着「✅ 生成成功」只会误导（switchWorkspace 自带
      // setPreview(null) 只覆盖切视角，这里兜住其余一切编辑路径；生成中的
      // 请求由 doPreview 里的 assignRef 快照比对作废）。
      useEffect(function () {
        setPreview(null);
      }, [assign]);

      function doApply() {
        if (!assign) return;
        var wsPath = activeWsRef.current;
        // 确认文案按配置对象分流（语义原样保留）：全局覆盖共享的 orchestrator
        // 预设（现状文案）；工作区落独立预设、只并进 workspaces 段，全局预设
        // 不受影响。写预设非破坏性操作，danger 不置位（主色确认钮）。
        var applyMsg = wsPath
          ? "确认应用当前配置？将为该工作区生成专属预设（orchestrator-<slug>）并保存到 dsh-paoding.config.yml 的 workspaces 段，全局 orchestrator 预设不受影响。"
          : "确认应用当前配置？将写入 preset 并覆盖 ~/.dsh/.agent-presets/orchestrator，且保存到 dsh-paoding.config.yml。";
        confirmCtrl.ask({
          title: "保存并应用",
          body: applyMsg,
          danger: false,
          confirmText: "确认应用",
          onConfirm: function () {
            setBusy(true);
            setBusyOp("apply");
            api("apply", { assignments: assign, workspace: wsPath }).then(function (r) {
              var notes = (r.roleResults || []).map(function (x) {
                return x.role + ": " + x.intent.length + " → " + x.kept.length;
              });
              var summary = notes.join("；") + "。";
              if (wsPath) {
                // 工作区应用：点明生成的 preset id，提示去预设选择器选用（工作区
                // 预设不会自动成为默认，须在新建会话时显式选择）。
                toast.ok("已生成预设 " + (r.presetId || "orchestrator-<slug>") + "：" + summary + "新建会话时在预设选择器选它。" + (r.staleNote ? " ⚠️ patch 较新，重新应用后生效。" : ""));
                // 服务端 apply 后已重刷状态缓存：静默拉一次，让 workspaceMeta /
                // existing.workspaces 跟上（全局路径保持旧交互，不额外拉取）。
                api("state").then(function (d) {
                  setData(d);
                  setAssign(buildTargetAssignments(d, activeWsRef.current));
                }).catch(function () { /* 静默：落盘已成功，仅展示层暂旧 */ });
              } else {
                toast.ok("已安装：" + summary + (r.staleNote ? " ⚠️ patch 较新，重启后生效。" : " 重启 DSH 或新建会话后生效。"));
              }
              // 显示名 / 角色名单可能变了：事件流委派行键控注册跟着刷新（行组件
              // 标题读 delegateMeta，刷新即可见，无需重开会话）。
              refreshDelegateRows();
            }).catch(function (err) { toast.err(err.message); }).finally(function () {
              setBusy(false);
              setBusyOp(null);
            });
          },
        });
      }

      function doRescan() {
        setBusy(true);
        setBusyOp("rescan");
        setScrollReq("top"); // 立即滚动回面板顶部（不等接口返回，结果经 toast 播报）
        api("rescan", {}).then(function (d) {
          setData(d);
          setAssign(buildTargetAssignments(d, activeWsRef.current));
          // 回调参数 d 即重扫后的新 state，直接报数字，补回原徽标条的信息量
          toast.ok("已重新检测：" + (d.inventory || []).length + " 个 MCP / 插件工具 · " + (d.skills || []).length + " 个技能");
        }).catch(function (err) { toast.err(err.message); }).finally(function () {
          setBusy(false);
          setBusyOp(null);
        });
      }

      function toggleRole(name) {
        setOpenMap(function (prev) {
          var next = Object.assign({}, prev);
          next[name] = !(name in prev ? prev[name] : defaultOpenOf(name));
          return next;
        });
      }

      function togglePersona(name) {
        setPersonaMap(function (prev) {
          var next = Object.assign({}, prev);
          next[name] = !prev[name];
          return next;
        });
      }

