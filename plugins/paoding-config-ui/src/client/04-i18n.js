    // ── i18n（zh / en 双语）───────────────────────────────────────────────
    //
    // 机制：
    //  - 字典 PAODING_I18N_DICT 是「纯数据字面量」——对象里只有字符串值，无
    //    函数、无外部变量引用，便于 tests/i18n.test.mjs 用 node:vm 直接执行本
    //    片段提取字典，做 zh/en key 对账、占位符校验与「文案 key 必须在字典」
    //    的静态扫描。key 按片段/功能分命名空间：dom.*（渲染助手）/ api.* /
    //    ver.*（版本更新卡）/ models.* / tpl.*（场景模板）/ ws.*（工作区）/
    //    panel.*（配置面板正文）/ role.*（角色卡与委派行标题）/ warn.*（体检
    //    告警卡）/ nav.*（侧栏入口与页头壳）/ menu.*（页头「更多」菜单与升级）/
    //    common.*（跨片段复用的短词）。
    //  - t(key, params)：按当前语言取文案，params 做 {name} 插值（split/join
    //    而非 replace，避免替换串里的 $ 模式被二次解释）。缺 key 原样返回 key
    //    本身——线上宁可露出 key 也不静默吞掉，测试侧保证不会发生。
    //  - 语言解析：localStorage "paoding-lang"（"zh"/"en"）显式优先 →
    //    navigator.language 以 zh 开头 → zh，否则 en（首次使用者多半是中文
    //    文档进来的，缺省 en 但 zh 环境自动命中）。
    //  - 切语言：setLang(lang) 写 localStorage + 同步广播 onLangChange；
    //    监听方各自刷新（86 PageShell 整页重渲染、82 委派行重建标题），面板
    //    数据重拉复用既有 registerReload 通道，不另造机制。
    //  - 取舍：服务端下发的文案（API error message、体检 items 的 message、
    //    升级 note/message）本轮保持原文展示（服务端仅中文），字典只补本地化
    //    的标题/框架文案；warn.title.<code> 按 code 给行级标题，服务端 message
    //    原文作正文。

    var PAODING_LANG_KEY = "paoding-lang";

    // 语言探测：localStorage 显式值优先；其余按 navigator.language 首缀猜 zh，
    // 兜底 en。全程 try/catch——非浏览器/受限环境（vm 测试、老内核）不炸，逐层回落。
    function paodingDetectLang() {
      try {
        var saved = window.localStorage.getItem(PAODING_LANG_KEY);
        if (saved === "zh" || saved === "en") return saved;
      } catch (err) { /* localStorage 不可用：继续探测 */ }
      try {
        if (typeof navigator !== "undefined" && navigator.language
          && String(navigator.language).toLowerCase().indexOf("zh") === 0) return "zh";
      } catch (err) { /* navigator 不可用：落兜底 */ }
      return "en";
    }

    var paodingLang = paodingDetectLang();

    // 当前语言（组件渲染期读；setLang 后经广播触发重渲染再读到新值）。
    function pdLang() { return paodingLang; }

    // 取文案 + {name} 插值。缺 key 原样返回 key（显式暴露，防静默错文案）。
    function t(key, params) {
      var entry = PAODING_I18N_DICT[key];
      var s = entry ? (entry[paodingLang] != null ? entry[paodingLang] : entry.zh) : key;
      if (params) {
        Object.keys(params).forEach(function (name) {
          s = s.split("{" + name + "}").join(String(params[name]));
        });
      }
      return s;
    }

    // key 是否在字典（动态拼 key 时防「缺 key 露 key 串」的守卫，如 warn.title.<code>）。
    function tHas(key) {
      return Object.prototype.hasOwnProperty.call(PAODING_I18N_DICT, key);
    }

    // 语言变更广播：setLang 同步通知；返回反注册函数（组件卸载时退订）。
    var paodingLangListeners = [];
    function onLangChange(fn) {
      paodingLangListeners.push(fn);
      return function () {
        var i = paodingLangListeners.indexOf(fn);
        if (i !== -1) paodingLangListeners.splice(i, 1);
      };
    }

    // 切语言：只认 zh/en（其余一律归 zh，与探测兜底口径一致）；写盘失败只降级
    // 为「本次会话生效」（隐私模式等场景不炸）。
    function setLang(lang) {
      var next = lang === "en" ? "en" : "zh";
      if (next === paodingLang) return;
      paodingLang = next;
      try { window.localStorage.setItem(PAODING_LANG_KEY, next); } catch (err) { /* 写不进就只换内存态 */ }
      paodingLangListeners.slice().forEach(function (fn) {
        try { fn(); } catch (err) { /* 单个监听失败不阻断其余刷新 */ }
      });
    }

    // ── 字典（纯数据字面量：无函数、无外部引用，测试按整个片段 vm 执行提取）──
    var PAODING_I18N_DICT = {
      // common.*：跨片段复用的短词
      "common.confirm": { zh: "确认", en: "Confirm" },
      "common.cancel": { zh: "取消", en: "Cancel" },
      "common.close": { zh: "关闭", en: "Close" },
      "common.closeToast": { zh: "关闭提示", en: "Dismiss notification" },
      "common.confirmDelete": { zh: "确认删除", en: "Delete" },
      "common.restoreDefault": { zh: "恢复默认", en: "Restore default" },
      "common.listSep": { zh: "；", en: "; " },
      "common.period": { zh: "。", en: "." },
      "common.projectBadge": { zh: "项目", en: "Project" },

      // dom.*：20 片段渲染助手的定稿文案
      "dom.runtimeFallback": { zh: "运行时识别不可用，已回退文件扫描（{err}）", en: "Runtime detection unavailable — fell back to file scanning ({err})" },
      "dom.bgContinuableHint": { zh: "可续会话跨轮保留子代理上下文：产出不满可用 send_message 就地续修；无自动清理，落盘与 token 成本随轮次累积，建议仅多轮打磨类角色开启。", en: "Continuable sessions keep the child conversation across turns: when a result falls short, the main agent can refine it in place via send_message. Nothing is cleaned up automatically — disk and token costs accumulate per turn, so enable it only for iterate-and-polish roles." },
      "dom.bgPersistenceWarn": { zh: "未检测到会话持久化后端（sessionPersistence）。可续模式在委派时会直接报错 PERSISTENCE_UNAVAILABLE：需在 ~/.dsh/cordis.patch.yml 挂 @deepseek-ai/dsh-session-persistence-jsonl（host 层、机器级改动，详见 docs/orchestration.md）。", en: "No session persistence backend (sessionPersistence) detected. Delegating to a continuable role fails outright with PERSISTENCE_UNAVAILABLE: mount @deepseek-ai/dsh-session-persistence-jsonl in ~/.dsh/cordis.patch.yml (a host-level, machine-wide change — see docs/orchestration.md)." },
      "dom.forkModelHint": { zh: "继承对话的子代理随主 agent 的当前模型启动，上方专用模型不会生效；应用时会忽略该项模型配置。", en: "A forked child starts with the main agent's current model — the dedicated model above has no effect and is ignored on apply." },

      // api.*：30 片段请求助手的可读错误
      "api.notJson": { zh: "HTTP {status}（响应不是 JSON）", en: "HTTP {status} (response was not JSON)" },
      "api.timeout": { zh: "请求超时（{s}s 无响应）", en: "Request timed out (no response for {s}s)" },

      // ver.*：40 片段页头版本更新卡
      "ver.checkFailed": { zh: "版本检测失败", en: "Version check failed" },
      "ver.checking": { zh: "检测中…", en: "Checking…" },
      "ver.retry": { zh: "重试", en: "Retry" },
      "ver.newAvailable": { zh: "新版本 {v} 可用 · ", en: "New version {v} available · " },
      "ver.viewUpdate": { zh: "查看更新", en: "View release" },
      "ver.upgrade": { zh: "升级", en: "Upgrade" },
      "ver.upgrading": { zh: "升级中…", en: "Upgrading…" },
      "ver.downloadHint": { zh: "下载安装中，最长约 2 分钟", en: "Downloading and installing — may take up to 2 minutes" },

      // models.*：50 片段模型选项与 70/72 的目录降级文案
      "models.followRouting": { zh: "（跟随主 agent 路由）", en: "follows main agent routing" },
      "models.current": { zh: "当前配置：{provider} · {model}", en: "Current config: {provider} · {model}" },
      "models.currentNoModel": { zh: "当前配置：{provider} ·（无模型，后端忽略）", en: "Current config: {provider} · (no model — ignored by the backend)" },
      "models.followMain": { zh: "跟随主 agent 当前模型", en: "Follow the main agent's current model" },
      "models.option": { zh: "{model}（{provider}）", en: "{model} ({provider})" },
      "models.listBadResponse": { zh: "模型目录响应格式异常", en: "Unexpected model catalog response format" },

      // tpl.*：55 片段场景模板（档位名 + 场景说明；55 的 label/desc 字段存的就是这里的 key）
      "tpl.lite.label": { zh: "轻量档", en: "Lite" },
      "tpl.lite.desc": { zh: "只留实现角色（implement），主 agent 不额外带工具。适合纯写代码。", en: "Keeps only the implement role; the main agent carries no extra tools. For pure coding sessions." },
      "tpl.research.label": { zh: "调研档", en: "Research" },
      "tpl.research.desc": { zh: "只留检索角色（search_external + 深搜），去掉设计与实现。", en: "Keeps only the research roles (search_external + deep search); drops design and implement." },
      "tpl.full.label": { zh: "全开档", en: "Full" },
      "tpl.full.desc": { zh: "四个内置角色全留，主 agent 额外工具勾上检测到的全部库存。", en: "Keeps all four built-in roles; the main agent's extra tools cover the full detected inventory." },

      // ws.*：60 片段工作区助手 + 72 的标签条 / 添加工作区弹窗
      "ws.tag.project": { zh: "项目", en: "Project" },
      "ws.tag.pending": { zh: "待应用", en: "Pending" },
      "ws.tag.global": { zh: "全局", en: "Global" },
      "ws.sessionCount": { zh: "{n} 会话", en: "{n} sessions" },
      "ws.tip.sessions": { zh: " · {n} 会话", en: " · {n} sessions" },
      "ws.tip.project": { zh: " · 项目配置（预设 {id}）", en: " · project config (preset {id})" },
      "ws.tip.pending": { zh: " · 已保存项目配置、预设未生成（点「保存并应用」生效）", en: " · project config saved, preset not generated yet (click Save & Apply to apply it)" },
      "ws.tip.global": { zh: " · 跟随全局配置", en: " · follows the global config" },
      "ws.globalTab": { zh: "全局默认", en: "Global default" },
      "ws.globalTabTip": { zh: "全局默认：写入共享的 orchestrator 预设", en: "Global default: writes the shared orchestrator preset" },
      "ws.more": { zh: "更多", en: "More" },
      "ws.moreTip": { zh: "其余 {n} 个工作区", en: "{n} more workspaces" },
      "ws.addTab": { zh: "添加工作区", en: "Add workspace" },
      "ws.addTabTip": { zh: "注册新的工作区目录", en: "Register a new workspace directory" },
      "ws.tablistLabel": { zh: "配置对象", en: "Config target" },
      "ws.menuLabel": { zh: "更多工作区", en: "More workspaces" },
      "ws.barHint": { zh: "「全局默认」写入共享的 orchestrator 预设；选中某个工作区后，预览 / 应用会生成该工作区专属预设（orchestrator-<目录名>），两者互不影响。", en: "\"Global default\" writes the shared orchestrator preset; with a workspace selected, preview/apply generates that workspace's own preset (orchestrator-<directory name>). The two never interfere." },
      "ws.addTitle": { zh: "添加工作区", en: "Add workspace" },
      "ws.pathLabel": { zh: "工作区目录绝对路径", en: "Absolute path of the workspace directory" },
      "ws.pathPlaceholder": { zh: "输入工作区目录绝对路径，如 /Users/me/code/project-a", en: "Enter an absolute directory path, e.g. /Users/me/code/project-a" },
      "ws.pathHint": { zh: "目录需已存在；已注册的目录重复提交幂等返回。", en: "The directory must already exist; re-submitting a registered path is an idempotent no-op." },
      "ws.addConfirm": { zh: "确认添加", en: "Add" },
      "ws.adding": { zh: "添加中…", en: "Adding…" },
      "ws.addedToast": { zh: "已注册工作区：{path}；配置后点「保存并应用」生成专属预设", en: "Workspace registered: {path}. Configure it, then hit Save & Apply to generate its preset" },
      "ws.existsToast": { zh: "工作区已在列表里：{path}；配置后点「保存并应用」生成专属预设", en: "Workspace already listed: {path}. Configure it, then hit Save & Apply to generate its preset" },
      "ws.listBadResponse": { zh: "工作区列表响应格式异常", en: "Unexpected workspace list response format" },
      "ws.listFailHint": { zh: "宿主工作区列表拉取失败，仅显示配置文件中的工作区；重启 DSH 后通常可恢复", en: "Failed to fetch the host workspace list — showing only workspaces from the config file; usually recovers after restarting DSH" },
      "ws.listFailDetail": { zh: "（{msg}）", en: " ({msg})" },
      "ws.notInList": { zh: "工作区 {path} 不在列表里，未切换 tab", en: "Workspace {path} is not in the list — tab not switched" },
      "ws.skillsFail": { zh: "该工作区技能列表拉取失败，技能网格已回退用户级技能", en: "Failed to fetch this workspace's skill list — the skill grid fell back to user-level skills" },

      // panel.*：70/72 配置面板正文（表单标签 / 占位符 / 提示 / toast / 按钮）
      "panel.loading": { zh: "加载检测状态…", en: "Loading detection state…" },
      "panel.scopeGlobal": { zh: "仅用户级技能", en: "User-level skills only" },
      "panel.scopeWs": { zh: "用户级 + 该工作区项目级技能", en: "User-level + this workspace's project-level skills" },
      "panel.applyBtn": { zh: "保存并应用", en: "Save & Apply" },
      "panel.applying": { zh: "处理中…", en: "Working…" },
      "panel.previewBtn": { zh: "预览生成", en: "Generate preview" },
      "panel.previewing": { zh: "生成中…", en: "Generating…" },
      "panel.rescanBtn": { zh: "重新检测", en: "Rescan" },
      "panel.scanning": { zh: "检测中…", en: "Scanning…" },
      "panel.rolesToolsHeading": { zh: "角色与工具", en: "Roles & tools" },
      "panel.tplHeading": { zh: "场景模板", en: "Scenario templates" },
      "panel.removedHeading": { zh: "已删除的内置角色", en: "Removed built-in roles" },
      "panel.restoreHint": { zh: "恢复后卡片回到上方内置列表；工具面取内置默认（不沿用删前自定义配置）。", en: "Restored cards return to the built-in list above; the toolset is rebuilt from the built-in default (pre-deletion customizations are not kept)." },
      "panel.roleAddBtn": { zh: "新建自定义 agent 角色", en: "New custom role" },
      "panel.skillsHeading": { zh: "技能分配（软约束：写入对应 agent 的 persona 引导）", en: "Skill assignment (soft constraint: written into each agent's persona guidance)" },
      "panel.skillsMain": { zh: "技能分配（read 按需：勾选 = persona 写入技能行，主 agent 用 read 加载正文）", en: "Skill assignment (read on demand: checking writes a skill line into the persona; the main agent loads the body with read)" },
      "panel.skillsInline": { zh: "内联全文（硬生效，每轮固定 persona 开销，适合 caveman 等风格技能）", en: "Inline full text (hard effect, fixed persona cost every turn — for style skills like caveman)" },
      "panel.baseToolsMain": { zh: "基础工具（取消勾选即从主 agent 移除——写入 main_agent_remove）", en: "Base tools (unchecking removes them from the main agent — written to main_agent_remove)" },
      "panel.mcpToolsMain": { zh: "MCP 工具（可加入主 agent）", en: "MCP tools (can join the main agent)" },
      "panel.pluginToolsMain": { zh: "插件工具（可加入主 agent）", en: "Plugin tools (can join the main agent)" },
      "panel.baseTools": { zh: "基础工具", en: "Base tools" },
      "panel.mcpTools": { zh: "MCP 工具", en: "MCP tools" },
      "panel.pluginTools": { zh: "插件工具", en: "Plugin tools" },
      "panel.noMcp": { zh: "未检测到 MCP 工具", en: "No MCP tools detected" },
      "panel.noPlugin": { zh: "未检测到插件工具", en: "No plugin tools detected" },
      "panel.noSkills": { zh: "未检测到技能目录", en: "No skill directories detected" },
      "panel.none": { zh: "无", en: "None" },
      "panel.tagReadOnDemand": { zh: "read按需", en: "read on demand" },
      "panel.tagInline": { zh: "内联全文", en: "Inline" },
      "panel.previewOk": { zh: "✅ 生成成功（未写盘）", en: "✅ Generated (nothing written to disk)" },
      "panel.previewPreset": { zh: " · 预设 {id}", en: " · preset {id}" },
      // 「编排模式 (Orchestrator)」是后端默认 preset 显示名的「值」，不是界面标签——
      // 占位符展示的就是生效值本身，不本地化（英文文档也沿用中文名）。
      "panel.mainNameLabel": { zh: "主 agent 显示名（仅 preset 显示名）", en: "Main agent display name (preset display name only)" },
      "panel.mainNameHint": { zh: "仅替换预设显示名，persona 身份行（You are the …）不动；留空 = 默认「编排模式 (Orchestrator)」（工作区预设用派生名）。改动需重启 GUI / 新会话生效。", en: "Replaces only the preset display name — the persona identity line (You are the …) is untouched; leave empty for the default \"编排模式 (Orchestrator)\" (workspace presets use a derived name). Takes effect after a GUI restart or in new sessions." },
      "panel.mainNameNewline": { zh: "主 agent 显示名（仅 preset 显示名）不能包含换行（\\r / \\n），未保存", en: "Main agent display name (preset display name only) cannot contain line breaks (\\r / \\n) — not saved" },
      "panel.mainNameBlank": { zh: "主 agent 显示名（仅 preset 显示名）不能为纯空白（清空字段或点「恢复默认」= 默认显示名），未保存", en: "Main agent display name (preset display name only) cannot be whitespace-only (clear the field or click Restore default for the default name) — not saved" },
      "panel.mainNameTooLong": { zh: "主 agent 显示名（仅 preset 显示名）过长：trim 后最多 60 字符，未保存", en: "Main agent display name (preset display name only) is too long: at most 60 characters after trim — not saved" },
      "panel.personaToggle": { zh: "persona（可选，覆盖默认角色说明）", en: "Persona (optional, overrides the default role description)" },
      "panel.personaPlaceholder": { zh: "输入该角色的 persona 说明…", en: "Enter this role's persona description…" },
      "panel.personaHint": { zh: "技能引导会自动追加到 persona 末尾；自定义角色必填此说明。", en: "Skill guidance is appended to the end of the persona automatically; custom roles must fill this in." },
      "panel.extraToggle": { zh: "人设追加（主 agent 提示词尾部，可编辑）", en: "Persona addendum (tail of the main agent prompt, editable)" },
      "panel.extraPlaceholder": { zh: "留空并保存 = 不追加任何内容（默认 codegraph 规则将被移除）…", en: "Leave empty and save to append nothing (the default codegraph rules will be removed)…" },
      "panel.extraActionHint": { zh: "保存并应用时按此追加到主 agent persona 末尾（顺序：SRC 本体 → 技能行 → 此处）。改动需重启 GUI / 新会话生效。", en: "Appended to the end of the main agent persona on Save & Apply (order: SRC body → skill lines → this). Takes effect after a GUI restart or in new sessions." },
      "panel.extraClearHint": { zh: "清空保存 = 移除默认 codegraph 规则（配置键 main_agent_persona_extra 记为 ''）。", en: "Save while empty to remove the default codegraph rules (config key main_agent_persona_extra is stored as \'\')." },
      "panel.roleNameLabelCustom": { zh: "角色显示名（事件流委派行标题；不动 toolName / persona）", en: "Role display name (title of the delegation row in the event stream; does not touch toolName / persona)" },
      "panel.roleNameLabelBuiltin": { zh: "角色显示名（persona 身份句主语 + 事件流委派行标题；不动工具名/调用名）", en: "Role display name (subject of the persona identity line + delegation row title; does not touch tool names / call names)" },
      "panel.roleNameHintCustom": { zh: "留空 = 事件流显示 toolName（{name}）；保存并应用后生效（仅 GUI 展示，不影响生成产物与调用名）。", en: "Leave empty to show the toolName ({name}) in the event stream; takes effect on Save & Apply (GUI display only — no effect on generated artifacts or call names)." },
      "panel.roleNameHintBuiltin": { zh: "留空 = 默认身份（如 \"You are the {subject} agent.\"）；已为该角色自定义 persona 时仅作事件流标题。", en: "Leave empty for the default identity (e.g. \"You are the {subject} agent.\"); serves only as the event-stream title when this role has a custom persona." },
      "panel.roleNameNewline": { zh: "角色 \"{name}\" 显示名不能包含换行（\\r / \\n），未保存", en: "Display name of role \"{name}\" cannot contain line breaks (\\r / \\n) — not saved" },
      "panel.roleNameTooLong": { zh: "角色 \"{name}\" 显示名过长：trim 后最多 60 字符，未保存", en: "Display name of role \"{name}\" is too long: at most 60 characters after trim — not saved" },
      "panel.roleModelLabel": { zh: "专用模型（可选；留空 = 跟随主 agent 当前模型）", en: "Dedicated model (optional; leave empty to follow the main agent's current model)" },
      "panel.roleModelNewline": { zh: "角色 \"{name}\" {field}不能包含换行（\\r / \\n），未保存", en: "{field} of role \"{name}\" cannot contain line breaks (\\r / \\n) — not saved" },
      "panel.roleModelTooLong": { zh: "角色 \"{name}\" {field}过长：trim 后最多 120 字符，未保存", en: "{field} of role \"{name}\" is too long: at most 120 characters after trim — not saved" },
      "panel.modelField": { zh: "专用模型", en: "Dedicated model" },
      "panel.providerIgnored": { zh: "角色 \"{name}\"：provider 仅在同时配置模型时生效（后端将忽略），已保存", en: "Role \"{name}\": provider takes effect only when a model is also set (ignored by the backend) — saved" },
      "panel.providerPlaceholder": { zh: "provider（留空=跟随主 agent）", en: "provider (empty = follow main agent)" },
      "panel.modelFallbackHint": { zh: "模型目录不可用（{err}），已回退手输。写入该角色委派块的 agentOptions；含冷恢复在内，子 agent 固定用该模型。provider 需与模型成对（如 deepseek-official）。", en: "Model catalog unavailable ({err}) — fell back to manual input. Written into the agentOptions of this role's delegation block; the child agent pins this model, cold restore included. provider must pair with a model (e.g. deepseek-official)." },
      "panel.unknownError": { zh: "未知错误", en: "unknown error" },
      "panel.modelSelectHint": { zh: "选项来自 DSH 已注册的模型路由；留空 = 跟随主 agent，主 agent 换模型时未固定的角色跟着变。", en: "Options come from the model routes registered in DSH; leave empty to follow the main agent — roles without a pinned model follow along when the main agent switches models." },
      "panel.bgModeLabel": { zh: "会话模式", en: "Session mode" },
      "panel.bgOneshot": { zh: "一次性（one-shot）", en: "One-shot" },
      "panel.bgContinuable": { zh: "可续（continuable）", en: "Continuable" },
      "panel.startModeLabel": { zh: "启动方式", en: "Start mode" },
      "panel.smFresh": { zh: "全新（fresh）", en: "Fresh" },
      "panel.smFork": { zh: "继承对话（fork）", en: "Inherit conversation (fork)" },
      "panel.forkStartHint": { zh: "继承对话的子代理以主 agent 已完成的对话轮次为初始内容启动（一次性快照，之后两边各自推进）；工具面仍以本角色配置为准。", en: "A forked child starts from the main agent's already-completed turns (a one-time snapshot; from then on both sides move on independently); the toolset still follows this role's own configuration." },
      "panel.roleAddTitle": { zh: "新建自定义 agent 角色", en: "New custom role" },
      "panel.roleAddToolNameLabel": { zh: "角色 toolName（主 agent 的委派调用名）", en: "Role toolName (the main agent's delegation call name)" },
      "panel.roleAddNamePlaceholder": { zh: "输入英文小写角色名，如 reviewer", en: "Enter a lowercase role name, e.g. reviewer" },
      "panel.dispNameLabel": { zh: "显示名（可选）", en: "Display name (optional)" },
      "panel.dispNamePlaceholder": { zh: "如 代码评审，留空 = 用 toolName", en: "e.g. Code review — leave empty to use the toolName" },
      "panel.roleAddHint": { zh: "角色名须为 2-32 位小写字母/数字/下划线/连字符，小写字母开头；内置名不可新建。显示名可选，不能换行，trim 后最多 60 字符，留空用 toolName 当标题。新角色工具面默认放开全部检测到的工具，可在卡片里再收窄。会话模式缺省一次性（one-shot），选「可续」后仍可在角色卡里改。启动方式缺省全新（fresh），选「继承对话」后仍可在角色卡里改。", en: "Role names are 2-32 chars of lowercase letters/digits/underscores/hyphens, starting with a letter; built-in names cannot be recreated. Display name is optional: no line breaks, at most 60 chars after trim; leave empty to use the toolName as the title. A new role's toolset opens up every detected tool by default — narrow it down in the role card later. Session mode defaults to one-shot and can still be changed in the role card after picking Continuable. Start mode defaults to fresh and can still be changed in the role card after picking Inherit conversation." },
      "panel.roleAddConfirm": { zh: "确认新建", en: "Create" },
      "panel.roleRenameTitle": { zh: "重命名自定义角色", en: "Rename custom role" },
      "panel.roleRenameLabel": { zh: "新 toolName（主 agent 的委派调用名）", en: "New toolName (the main agent's delegation call name)" },
      "panel.roleRenameHint": { zh: "2-32 位小写字母/数字/下划线/连字符，小写字母开头；不可改成内置名或已存在的名字。skills 里的引用自动迁移；改名后需重启 / 新会话生效。", en: "2-32 chars of lowercase letters/digits/underscores/hyphens, starting with a letter; cannot be a built-in or an existing name. References in skills are migrated automatically; takes effect after a restart / in new sessions." },
      "panel.roleRenameConfirm": { zh: "确认重命名", en: "Rename" },
      "panel.roleNameInvalid": { zh: "角色名须为 2-32 位小写字母/数字/下划线/连字符", en: "Role name must be 2-32 chars of lowercase letters/digits/underscores/hyphens" },
      "panel.roleNameBuiltin": { zh: "内置角色不可新建（\"{name}\"如已删除，请在下方「已删除的内置角色」区恢复）", en: "\"{name}\" is a built-in role and cannot be recreated (if deleted, restore it from the Removed built-in roles section below)" },
      "panel.roleExists": { zh: "角色 \"{name}\" 已存在", en: "Role \"{name}\" already exists" },
      "panel.dispNameNewline": { zh: "显示名不能包含换行（\\r / \\n）", en: "Display name cannot contain line breaks (\\r / \\n)" },
      "panel.dispNameTooLong": { zh: "显示名过长：trim 后最多 60 字符", en: "Display name is too long: at most 60 characters after trim" },
      "panel.roleAddedToast": { zh: "已新建角色 \"{name}\"，记得「保存并应用」", en: "Created role \"{name}\" — remember to Save & Apply" },
      "panel.roleRenameBuiltin": { zh: "不可改成内置角色名 \"{name}\"", en: "Cannot rename to the built-in role name \"{name}\"" },
      "panel.roleRenamedToast": { zh: "已重命名 \"{old}\" → \"{new}\"，记得「保存并应用」", en: "Renamed \"{old}\" → \"{new}\" — remember to Save & Apply" },
      "panel.delCustomRoleTitle": { zh: "删除自定义角色", en: "Delete custom role" },
      "panel.delCustomRoleBody": { zh: "删除自定义角色 \"{name}\"？", en: "Delete custom role \"{name}\"?" },
      "panel.delBuiltinRoleTitle": { zh: "删除内置角色", en: "Delete built-in role" },
      "panel.delBuiltinRoleBody": { zh: "删除内置角色 \"{name}\"？\n该角色的委派工具、工具面、persona 与主 agent 的委派指引将一并移除；\n可在下方「已删除的内置角色」区一键恢复。", en: "Delete built-in role \"{name}\"?\nIts delegation tool, toolset, persona and the main agent's delegation guidance are removed with it;\nyou can restore it anytime from the Removed built-in roles section below." },
      "panel.applyTitle": { zh: "保存并应用", en: "Save & Apply" },
      "panel.applyBodyWs": { zh: "确认应用当前配置？将为该工作区生成专属预设（orchestrator-<slug>）并保存到 dsh-paoding.config.yml 的 workspaces 段，全局 orchestrator 预设不受影响。", en: "Apply the current configuration? This generates a dedicated preset for this workspace (orchestrator-<slug>) and saves it to the workspaces section of dsh-paoding.config.yml — the global orchestrator preset is untouched." },
      "panel.applyBodyGlobal": { zh: "确认应用当前配置？将写入 preset 并覆盖 ~/.dsh/.agent-presets/orchestrator，且保存到 dsh-paoding.config.yml。", en: "Apply the current configuration? This writes the preset, overwriting ~/.dsh/.agent-presets/orchestrator, and saves it to dsh-paoding.config.yml." },
      "panel.applyConfirm": { zh: "确认应用", en: "Apply" },
      "panel.warnTail": { zh: "有 {n} 条检查提示，见下方。", en: "{n} check messages below." },
      "panel.appliedWs": { zh: "已生成预设 {id}：{summary}新建会话时在预设选择器选它。", en: "Generated preset {id}: {summary} Pick it in the preset selector when starting a new session." },
      "panel.appliedGlobal": { zh: "已安装：{summary}", en: "Installed: {summary}" },
      "panel.staleReapply": { zh: " ⚠️ patch 较新，重新应用后生效。", en: " ⚠️ The patch is newer — apply again to take effect." },
      "panel.staleRestart": { zh: " ⚠️ patch 较新，重启后生效。", en: " ⚠️ The patch is newer — restart to take effect." },
      "panel.effectiveRestart": { zh: " 重启 DSH 或新建会话后生效。", en: " Takes effect after restarting DSH or in a new session." },
      "panel.rescanned": { zh: "已重新检测：{n} 个 MCP / 插件工具 · {m} 个技能", en: "Rescan complete: {n} MCP/plugin tools · {m} skills" },
      "panel.tplAppliedToast": { zh: "已切换到「{label}」，保存并应用后生效", en: "Switched to \"{label}\" — takes effect after Save & Apply" },

      // role.*：角色卡通用词 + 82 片段委派行标题缺省映射（值 = 字典 key）
      "role.mainAgent": { zh: "主 agent", en: "Main agent" },
      "role.badgeFixed": { zh: "固定", en: "Fixed" },
      "role.badgeCustom": { zh: "自定义", en: "Custom" },
      "role.badgeBuiltin": { zh: "内置", en: "Built-in" },
      "role.toolCount": { zh: "{n} 个工具", en: "{n} tools" },
      "role.renameTitle": { zh: "重命名角色 \"{name}\"（toolName = 委派调用名）", en: "Rename role \"{name}\" (toolName = delegation call name)" },
      "role.delCustomTitle": { zh: "删除角色 \"{name}\"", en: "Delete role \"{name}\"" },
      "role.delBuiltinTitle": { zh: "删除内置角色 \"{name}\"（可在下方恢复）", en: "Delete built-in role \"{name}\" (restorable below)" },
      "role.restoreTitle": { zh: "恢复内置角色 \"{name}\"（工具面重建为内置默认 allow）", en: "Restore built-in role \"{name}\" (toolset rebuilt from the built-in default allow)" },
      "role.restorePill": { zh: "恢复 {name}", en: "Restore {name}" },
      "role.title.search_external": { zh: "外部检索", en: "External research" },
      "role.title.design": { zh: "设计", en: "Design" },
      "role.title.implement": { zh: "实现", en: "Implement" },
      "role.title.search_internal_deep": { zh: "深搜", en: "Deep search" },

      // warn.*：70 片段体检告警卡。heading 是卡片标题；title.<code> 是按服务端
      // code 给的行级本地化标题（进悬浮提示）。取舍：服务端 message 原文作正文
      // 展示，本轮不译（服务端仅中文）——只把「这是什么类别的检查」本地化。
      "warn.heading.apply": { zh: "应用检查提示", en: "Apply checks" },
      "warn.heading.preview": { zh: "预览检查提示", en: "Preview checks" },
      "warn.itemTitle": { zh: "检查项：{code}", en: "Check: {code}" },
      "warn.title.unmounted_tool": { zh: "已配置但未挂载的工具", en: "Configured but unmounted tool" },
      "warn.title.zero_tool_role": { zh: "零工具角色", en: "Role with no tools" },
      "warn.title.unknown_model": { zh: "未知的专用模型", en: "Unknown dedicated model" },
      "warn.title.preset_drift": { zh: "预设与配置漂移", en: "Preset drift" },
      "warn.title.generation": { zh: "生成期告警", en: "Generation warning" },
      "warn.title.generation_error": { zh: "生成预演失败", en: "Generation dry-run failed" },

      // nav.*：80 侧栏入口 + 86 页头壳（庖丁为品牌名，英文文档沿用 Paoding Config 译名）
      "nav.entryTitle": { zh: "庖丁配置", en: "Paoding Config" },
      "nav.openToWs": { zh: "打开庖丁配置并切到该工作区", en: "Open Paoding Config for this workspace" },
      "nav.closeAria": { zh: "关闭庖丁配置", en: "Close Paoding Config" },
      "nav.closeTip": { zh: "关闭（Esc）", en: "Close (Esc)" },

      // menu.*：86 页头「更多」菜单 / 导入导出 / 升级流程（服务端 r.message 原文
      // 优先展示，本地化串只作缺省兜底——同 warn 的取舍）。
      "menu.subtitle": { zh: "为主 agent 与子 agent 编排工具、技能与角色，预览并应用生成的 agent.cordis.yml。", en: "Orchestrate tools, skills and roles for the main agent and its sub-agents; preview and apply the generated agent.cordis.yml." },
      "menu.moreBtn": { zh: "更多", en: "More" },
      "menu.moreBtnTip": { zh: "配置文件导出 / 导入", en: "Export / import the config file" },
      "menu.menuLabel": { zh: "配置文件操作", en: "Config file actions" },
      "menu.exportItem": { zh: "导出配置", en: "Export config" },
      "menu.exporting": { zh: "导出中…", en: "Exporting…" },
      "menu.exported": { zh: "已导出配置文件 {name}", en: "Exported config file {name}" },
      "menu.exportFail": { zh: "导出失败：{msg}", en: "Export failed: {msg}" },
      "menu.importItem": { zh: "导入配置", en: "Import config" },
      "menu.importing": { zh: "导入中…", en: "Importing…" },
      "menu.importTitle": { zh: "导入配置", en: "Import config" },
      "menu.importBody": { zh: "将用文件「{name}」整体覆盖当前配置文件：\n角色、工具、技能分配与 workspaces（工作区）段全部以文件内容为准，现有配置被替换，此操作不可撤销。", en: "The file \"{name}\" will overwrite the whole config file:\nroles, tools, skill assignment and the workspaces section are all replaced with the file's content. The existing configuration is replaced — this cannot be undone." },
      "menu.importConfirm": { zh: "覆盖导入", en: "Overwrite & import" },
      "menu.imported": { zh: "配置已导入并覆盖原文件，视图已按新配置刷新", en: "Config imported and the original file overwritten — the view has been refreshed" },
      "menu.importFail": { zh: "导入失败：{msg}", en: "Import failed: {msg}" },
      "menu.readFail": { zh: "文件读取失败", en: "Failed to read file" },
      "menu.readFailPrefix": { zh: "读取文件失败：{msg}", en: "Failed to read the file: {msg}" },
      "menu.wsNotRegistered": { zh: "宿主工作区「{title}」还没在庖丁注册，已打开全局默认", en: "Host workspace \"{title}\" is not registered in Paoding yet — opened the global default" },
      "menu.listFail": { zh: "工作区列表拉取失败，已打开全局默认", en: "Failed to fetch the workspace list — opened the global default" },
      "menu.upgradeTitle": { zh: "升级 dsh-paoding", en: "Upgrade dsh-paoding" },
      "menu.upgradeConfirm": { zh: "升级", en: "Upgrade" },
      "menu.upgradeDevBody": { zh: "当前为开发 link 直连形态：无法就地升级，请手动执行 dsh plugin add dsh-paoding@latest 切换到 registry 版本。仍要继续尝试吗？", en: "This is a dev link checkout: it cannot be upgraded in place. Run dsh plugin add dsh-paoding@latest manually to switch to the registry version. Continue anyway?" },
      "menu.upgradeBody": { zh: "确定升级到 {v}？升级将通过插件通道原地换版本，完成后需重启 DSH 生效。", en: "Upgrade to {v}? The upgrade swaps the version in place through the plugin channel; restart DSH afterwards to apply it." },
      "menu.upToDate": { zh: "已是最新版本", en: "Already up to date" },
      "menu.upgraded": { zh: "✅ 已升级到 {v}，重启 DSH 后新版本生效（preset 会自动按新版重生成）", en: "✅ Upgraded to {v} — restart DSH to apply the new version (the preset regenerates itself against it)" },
      "menu.errTail": { zh: "：{tail}", en: ": {tail}" },
      "menu.langTip": { zh: "切换界面语言", en: "Switch UI language" },
    };
