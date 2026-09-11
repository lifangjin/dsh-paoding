/**
 * paoding-config-ui — DSH Web client bundle (手写，零构建)
 *
 * 加载机制（借鉴 dsh-better-sidebar，DSH 0.1.1-rc.1 实测通过）：
 *  - dsh-client-modules 节点半扫描本包 package.json 的 dsh.client 声明 +
 *    exports["./client"]，把本文件编入 window.__DSH_BOOT__ 并以
 *    /plugins/paoding-config-ui/client.js 服务（图行 id = 包名）。
 *  - 浏览器内核为 manifest 中每个插件创建 loader 条目并激活，故本文件
 *    必然被拉取执行；__ModuleLoader__.load 的 id 必须等于包名（图行 id）。
 *  - factory 内 require() 只解析平台 seed 模块（react / cordis /
 *    ui-slots / ui-primitives 与已物化模块）；本 bundle 依赖 react 与
 *    @deepseek-ai/dsh-client-ui-primitives。
 *  - 挂载点：设置页 settings.section 槽位（list slot，id: "paoding"），
 *    ctx.slots.inject() 等待设置壳声明后 register；id/order/label 驱动导航，
 *    与 ui-settings-general 的 general 分区同款模式（参见该包 client.js）。
 *  - UI：按 DSH 设置壳原生观感重绘（dsh-better-sidebar 的 SideCardSection
 *    配方）——分组容器卡 + 设计令牌（--dsw-alias-*，运行时注入，浅/深色
 *    主题经 body[data-ds-dark-theme] 自动跟随）。样式正文独立在 lib/base.css，
 *    由 Node 半经 GET /api/paoding/client.css 下发，本文件只在首次物化时
 *    幂等注入 <link data-plugin-css="paoding-config-ui/base">（热重载不重复；
 *    bundle 内不含 CSS 正文，改样式无需重编 bundle）；组件用 ui-primitives
 *    （Button / Pill / 图标）+ 原生 checkbox / textarea（原生语义与焦点）。
 *    数据走同源 /api/paoding/*（Node 半注册，带浏览器信任围栏）。
 */
window.__ModuleLoader__.load({
  id: "paoding-config-ui",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var React = require("react");
    var h = React.createElement;
    var useState = React.useState, useEffect = React.useEffect, useCallback = React.useCallback;
    var P = require("@deepseek-ai/dsh-client-ui-primitives");

    // ── 样式注入（幂等）─────────────────────────────────────────────────
    //
    // 样式正文在 lib/base.css，由 Node 半经 GET /api/paoding/client.css 下发
    //（同源请求，落在 /api/paoding 前缀路由的浏览器信任围栏内）；此处只在
    // 首次物化时注入一个 <link>。幂等：同名 data 属性的 link 已存在即跳过；
    // API 不可达时面板降级为无样式（不阻塞功能）。

    function mountCss() {
      if (document.querySelector('link[data-plugin-css="paoding-config-ui/base"]')) return;
      var link = document.createElement("link");
      link.setAttribute("rel", "stylesheet");
      link.setAttribute("data-plugin", "paoding-config-ui");
      link.setAttribute("data-plugin-css", "paoding-config-ui/base");
      link.setAttribute("href", "/api/paoding/client.css");
      if (document.head) {
        document.head.appendChild(link);
      } else if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", mountCss);
      } else {
        document.documentElement.appendChild(link);
      }
    }
    if (typeof document !== "undefined") mountCss();

    // ── 渲染小助手（零构建，无 JSX）──────────────────────────────────────

    // 图标兜底：任一图标缺失时降级为 null，绝不崩溃面板。
    function ic(Icon, size) {
      return Icon ? h(Icon, { size: size }) : null;
    }

    function statusRow(cls, iconNode, text) {
      return h("div", { className: cls, role: cls === "omd-statusError" ? "alert" : undefined },
        iconNode ? h("span", { className: "omd-statusIcon" }, iconNode) : null,
        h("span", { className: "omd-statusText" }, text));
    }

    function toolItem(tool, tag, checked, disabled, onChange, key) {
      return h("label", { key: key, className: "omd-toolItem", title: tool },
        h("input", {
          type: "checkbox",
          className: "omd-check",
          checked: !!checked,
          disabled: !!disabled,
          readOnly: !!disabled,
          onChange: onChange,
        }),
        h("span", { className: "omd-toolName" }, tool),
        tag ? h("span", { className: tag === "host" ? "omd-toolTag omd-toolTagHost" : "omd-toolTag" }, tag) : null);
    }

    var DEFAULT_ROLES = ["search_external", "design", "implement"];
    // 内置角色默认 persona 首行「身份主语」（仅用于 UI 占位与提示文案；实际生效值
    // 由后端 SRC 模板 persona 首行决定）。「显示名」= 替换该主语（其余不动）。
    var ROLE_DEFAULT_SUBJECT = {
      search_external: "external-research",
      design: "design",
      implement: "implementation",
    };

    // 角色可选 string 字段透传归一（name / model / provider 三处共用，供
    // buildAssignments 使用）：string 且非 '' 才保留，null / 缺省 / '' 一律
    // null（= 未配置）。字段拼写与后端契约一致。
    function roleStringRef(baseRoles, n, key) {
      var r = (baseRoles || {})[n];
      return r && typeof r[key] === "string" && r[key] !== "" ? r[key] : null;
    }

    // 内置角色显示名透传归一（= roleStringRef 之于 name）：null = 默认身份。
    function roleNameOf(baseRoles, n) {
      return roleStringRef(baseRoles, n, "name");
    }

    var INTRO = "可视化编排 dsh-paoding（庖丁解牛）预设：为主 agent 与子 agent 分配 Host 工具与技能，预览并应用生成的 agent.cordis.yml（修改后先预览，确认无误再应用）。";

    function hostTool(name) {
      // host 工具 = MCP 暴露的工具（mcp__<server>__<tool>）。memory_search
      // 旧归类已删：magic-memory 停用、mnemon 现在注册 mnemon_*（本函数只做
      // 展示分组，不影响识别/分配）。
      return name.indexOf("mcp__") === 0;
    }

    // 插件 chips：识别保持通用（pluginReports + 未覆盖的 runtimePlugins 全量并入），
    // 这里只做【纯展示】分组，绝不反向过滤识别结果：
    //   agent     → 主行（工具型/agent 插件：dsh-mnemon、@hyzyn/dsh-codegraph，以及
    //               文件白名单命中的工具插件）
    //   other     → 次要行（市场/纯界面插件：dshmarket、dsh-better-sidebar）
    //   internal  → 不展示（预设内部行，如 ./restrict.mjs）
    //   self      → 不展示（本插件自己）
    // 未知名默认归 agent；新装插件一律能识别并在主/次行出现，不会漏。
    function pluginKindOf(p) {
      var label = ((p && (p.label || p.moduleName)) || "");
      if (label.charAt(0) === "/" || label.indexOf("./") === 0) return "internal";
      if (label === "paoding-config-ui") return "self";
      if (label === "dshmarket" || label === "dsh-better-sidebar") return "other";
      return "agent";
    }

    function pluginChipsOf(d) {
      var primary = [];
      var secondary = [];
      var seen = {};
      function push(p) {
        var label = p && (p.label || p.moduleName);
        if (!label || seen[label]) return;
        seen[label] = true;
        var kind = pluginKindOf(p);
        if (kind === "agent") primary.push(p);
        else if (kind === "other") secondary.push(p);
        // internal / self：不展示
      }
      ((d && d.pluginReports) || []).forEach(push);
      ((d && d.runtimePlugins) || []).forEach(function (e) {
        var label = e && e.moduleName;
        if (!label || seen[label]) return;
        // UI 双保险：只展示启用且运行中的条目（与服务端过滤口径一致）
        if (e.enabled === false) return;
        if (e.fiberPhase != null && e.fiberPhase !== "active") return;
        if (label.indexOf("@deepseek-ai/") === 0) return;
        if (label.indexOf("dsh-client") !== -1) return;
        if (label.indexOf("cordis") !== -1) return;
        push({ label: label, tools: [], runtime: true, moduleName: label });
      });
      return { primary: primary, secondary: secondary };
    }

    // 运行时来源的插件条目没有工具归属信息，不显示计数（避免误读为 “0 工具”）；
    // 其工具实际已并入 inventory / MCP chips，可在角色卡片里勾选。
    function chipTextOf(p) {
      if (p && p.runtime) return "插件 " + p.label + "（运行时）";
      return "插件 " + (p && p.label) + " · " + ((p && p.tools) || []).length + " 工具";
    }

    // 运行时识别不可用时的回退提示（小字）；字段缺失或正常时不渲染任何内容。
    function runtimeNoteOf(d) {
      if (!d || d.runtimeOk !== false || !d.runtimeError) return null;
      var err = String(d.runtimeError);
      if (err.length > 200) err = err.slice(0, 200) + "…";
      return h("div", { className: "omd-hint" },
        "运行时识别不可用，已回退文件扫描（" + err + "）");
    }

    // ── 角色专用模型下拉（目录来自 GET /api/paoding/models，Node 半经
    //    ctx.apiProxy.llm.models({}) 取 DSH 已注册的模型路由）────────────────

    // 选项 value 编码：JSON.stringify([provider, model])。provider 路由与模型
    // id 都可能含任意字符（/ : . 等），裸拼接有歧义；JSON 数组编码可逆且无
    // 冲突，null（= 未配一侧）也能原样往返。
    function encodeModelOption(provider, model) {
      return JSON.stringify([provider, model]);
    }

    // 逆解码：非 JSON / 形状不对（含空串 = 「跟随主 agent」项）一律 null。
    function decodeModelOption(value) {
      try {
        var arr = JSON.parse(value);
        if (Array.isArray(arr) && arr.length === 2
          && (arr[0] === null || typeof arr[0] === "string")
          && (arr[1] === null || typeof arr[1] === "string")) {
          return { provider: arr[0], model: arr[1] };
        }
      } catch (err) { /* 空串或非编码值：按未识别处理 */ }
      return null;
    }

    // 目录 → 扁平选项表：group.id = provider 路由、model.id = 模型 id，显示名
    // 缺省回退 id；重复的 (provider, model) 对去重（value 兼作 React key）。
    function modelOptionsOf(groups) {
      var out = [];
      var seen = {};
      (groups || []).forEach(function (g) {
        if (!g || !Array.isArray(g.models)) return;
        var provider = typeof g.id === "string" ? g.id : "";
        g.models.forEach(function (m) {
          if (!m || typeof m.id !== "string" || m.id === "") return;
          var value = encodeModelOption(provider, m.id);
          if (seen[value]) return;
          seen[value] = true;
          out.push({
            value: value,
            provider: provider,
            providerName: g.name || provider,
            model: m.id,
            modelName: m.name || m.id,
          });
        });
      });
      return out;
    }

    // 选中值求解 + round-trip 保护：当前 (provider, model) 命中目录 → 返回该
    // 选项 value；未命中且至少一侧非空（手编配置、目录未刷新等）→ 追加一个
    // 「当前配置」选项并保持选中，绝不让已有配置值在下拉里凭空消失；两者皆
    // 空 → ""（「跟随主 agent 当前模型」）。extra 为需追加的 <option> 描述
    // （无需追加时 null），value/label 由调用方喂给 h("option", …)。
    function roleModelSelectionOf(options, provider, model) {
      if (!provider && !model) return { value: "", extra: null };
      for (var i = 0; i < options.length; i++) {
        if (options[i].model === model && options[i].provider === provider) {
          return { value: options[i].value, extra: null };
        }
      }
      var rtValue = encodeModelOption(provider || null, model || null);
      // 文案照实：模型缺失（只配 provider，后端会忽略）时按约定不带空格接全角括号
      var label = model
        ? "当前配置：" + (provider || "（跟随主 agent 路由）") + " · " + model
        : "当前配置：" + (provider || "（跟随主 agent 路由）") + " ·（无模型，后端忽略）";
      return {
        value: rtValue,
        extra: { value: rtValue, label: label },
      };
    }

    // ── 主面板 ─────────────────────────────────────────────────────────────

    function ConfigPanel(props) {
      var _s = useState(null), data = _s[0], setData = _s[1];
      var _e = useState(null), error = _e[0], setError = _e[1];
      var _a = useState(null), assign = _a[0], setAssign = _a[1];
      var _b = useState(false), busy = _b[0], setBusy = _b[1];
      var _op = useState(null), busyOp = _op[0], setBusyOp = _op[1];
      var _p = useState(null), preview = _p[0], setPreview = _p[1];
      var _n = useState(""), note = _n[0], setNote = _n[1];
      var _o = useState({}), openMap = _o[0], setOpenMap = _o[1];
      var _m = useState({}), personaMap = _m[0], setPersonaMap = _m[1];
      var _x = useState(false), extraOpen = _x[0], setExtraOpen = _x[1];
      var _r = useState(0), extraRev = _r[0], setExtraRev = _r[1];
      var _nr = useState(0), nameRev = _nr[0], setNameRev = _nr[1]; // 主 agent 名称 input 重挂（key 技巧）
      var _rn = useState({}), roleNameRev = _rn[0], setRoleNameRev = _rn[1]; // 内置角色显示名 input 重挂（每角色独立 key 计数）
      var _rm = useState({}), roleModelRev = _rm[0], setRoleModelRev = _rm[1]; // 角色专用模型/provider input 重挂（仅降级手输模式用；每角色独立 key 计数）
      var _mg = useState(null), modelGroups = _mg[0], setModelGroups = _mg[1]; // 模型目录 groups（/api/paoding/models）
      var _mgok = useState(false), modelGroupsOk = _mgok[0], setModelGroupsOk = _mgok[1]; // 目录可用 = 下拉模式；false = 降级双 input
      var _mgerr = useState(""), modelGroupsErr = _mgerr[0], setModelGroupsErr = _mgerr[1]; // 目录拉取失败原因（降级 hint 一句话展示）

      var api = useCallback(function (path, body) {
        var opts = body === undefined ? {} : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        };
        return fetch("/api/paoding/" + path, opts).then(function (r) {
          return r.json().then(function (d) {
            if (!r.ok) throw new Error(d.error || ("HTTP " + r.status));
            return d;
          });
        });
      }, []);

      var buildAssignments = useCallback(function (d) {
        var base = d.existing || d.suggested || { roles: {}, roles_remove: [], main_agent_name: null, main_agent_extra: [], main_agent_remove: [], main_agent_skills: [], main_agent_skills_inline: [], skills: {} };
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
            tools: base.roles[name].tools || [],
          };
        });
        return {
          roles: roles,
          roles_remove: removed,
          // 语义：null / '' / 缺省一律归一为 null（'' 等于没配 = 默认显示名）
          main_agent_name: base.main_agent_name == null || base.main_agent_name === "" ? null : base.main_agent_name,
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
        setError(null);
        api("state").then(function (d) {
          setData(d);
          setAssign(buildAssignments(d));
          setNote("");
        }).catch(function (err) { setError(err.message); });
      }, [api, buildAssignments]);

      useEffect(load, [load]);

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

      function addRole() {
        var name = window.prompt('新角色 toolName（英文小写，如 "reviewer"）：');
        if (!name) return;
        name = name.trim();
        if (!/^[a-z][a-z0-9_-]{1,31}$/.test(name)) { setNote("角色名须为 2-32 位小写字母/数字/下划线/连字符"); return; }
        // 内置名不可经「新建」再造：正常存在时由下方 prev.roles 命中提示；已删除
        // （不在 roles、在 roles_remove）时在此拦截并引导走恢复区，避免同一内置名
        // 同时出现在卡片流与「已删除的内置角色」恢复区。
        if (DEFAULT_ROLES.indexOf(name) !== -1) { setNote('内置角色不可新建（"' + name + '"如已删除，请在下方「已删除的内置角色」区恢复）'); return; }
        setAssign(function (prev) {
          if (prev.roles[name]) { setNote('角色 "' + name + '" 已存在'); return prev; }
          var next = JSON.parse(JSON.stringify(prev));
          // 新角色全字段出厂形状：与 buildAssignments / restoreBuiltinRole 条目一致
          //（model/provider 置 null = 跟随主 agent 当前模型）。
          next.roles[name] = { persona: null, name: null, model: null, provider: null, tools: (data && data.inventory) || [] };
          return next;
        });
      }

      function removeRole(name) {
        if (!window.confirm('删除自定义角色 "' + name + '"？')) return;
        setAssign(function (prev) {
          var next = JSON.parse(JSON.stringify(prev));
          delete next.roles[name];
          Object.keys(next.skills).forEach(function (s) {
            next.skills[s] = next.skills[s].filter(function (r) { return r !== name; });
          });
          return next;
        });
      }

      // 内置角色删除：roles 删 key + skills 引用剔除 + roles_remove 记名（去重）。
      // 后端语义：roles_remove 里的内置名 = 已删除（卡片消失、生成不再委派），
      // 可经 restoreBuiltinRole 恢复；自定义角色删除语义不变（只删 roles key，不进 roles_remove）。
      function removeBuiltinRole(name) {
        if (!window.confirm('删除内置角色 "' + name + '"？该角色的委派工具、工具面、persona 与主 agent 的委派指引将一并移除；可在下方「已删除的内置角色」区一键恢复。')) return;
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
      }

      // 内置角色恢复：roles_remove 除名 + 重建角色。工具面取内置默认 allow
      // （data.blocks[name]），不沿用删前自定义配置——恢复即出厂默认，简化处理。
      // 显示名同样置 null（出厂默认），重建条目与 buildAssignments 形状一致。
      // 专用模型 / provider 同理置 null：恢复 = 回到「跟随主 agent 当前模型」，
      // 不保留删前的模型固定配置。
      function restoreBuiltinRole(name) {
        setAssign(function (prev) {
          var next = JSON.parse(JSON.stringify(prev));
          next.roles_remove = (next.roles_remove || []).filter(function (r) { return r !== name; });
          var defTools = (data && data.blocks && data.blocks[name]) || [];
          next.roles[name] = { persona: null, name: null, model: null, provider: null, tools: defTools.slice() };
          return next;
        });
      }

      function doPreview() {
        if (!assign) return;
        setBusy(true);
        setBusyOp("preview");
        setPreview(null);
        api("preview", { assignments: assign }).then(function (r) {
          setPreview(r);
          setNote("");
        }).catch(function (err) { setError(err.message); }).finally(function () {
          setBusy(false);
          setBusyOp(null);
        });
      }

      function doApply() {
        if (!assign) return;
        if (!window.confirm("确认应用当前配置？将写入 preset 并覆盖 ~/.dsh/.agent-presets/orchestrator，且保存到 dsh-paoding.config.yml。")) return;
        setBusy(true);
        setBusyOp("apply");
        api("apply", { assignments: assign }).then(function (r) {
          var notes = (r.roleResults || []).map(function (x) {
            return x.role + ": " + x.intent.length + " → " + x.kept.length;
          });
          setNote("✅ 已安装：" + notes.join("；") + "。" + (r.staleNote ? " ⚠️ patch 较新，重启后生效。" : " 重启 DSH 或新建会话后生效。"));
        }).catch(function (err) { setError(err.message); }).finally(function () {
          setBusy(false);
          setBusyOp(null);
        });
      }

      function doRescan() {
        setBusy(true);
        setBusyOp("rescan");
        api("rescan", {}).then(function (d) {
          setData(d);
          setAssign(buildAssignments(d));
          setNote("↻ 已重新检测");
        }).catch(function (err) { setError(err.message); }).finally(function () {
          setBusy(false);
          setBusyOp(null);
        });
      }

      function toggleRole(name) {
        setOpenMap(function (prev) {
          var next = Object.assign({}, prev);
          next[name] = !(name in prev ? prev[name] : name === "__main__" || name === "search_external");
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

      // ── 渲染 ───────────────────────────────────────────────────────────────

      function statusBarOf() {
        if (error) return statusRow("omd-statusError", ic(P.IconWarningOutline16, 16), error);
        if (note.indexOf("✅") === 0) return statusRow("omd-statusOk", null, note);
        if (note) return statusRow("omd-statusWarn", null, note);
        if (data) return statusRow("omd-status", ic(P.IconDataOutline16, 14),
          "检测到 " + (data.inventory || []).length + " 个 host 工具 · " +
          (data.skills || []).length + " 个技能 · config: " + (data.configFile || "默认"));
        return null;
      }

      if (!data || !assign) {
        return h("div", { className: "omd-section" },
          h("p", { className: "omd-intro" }, INTRO),
          h("div", { className: "omd-group" },
            h("div", { className: "omd-groupHeading" }, h("span", null, "状态与操作")),
            statusBarOf(),
            h("div", { className: "omd-loading" },
              h("span", { className: "omd-spin" }, ic(P.IconLoadingOutline16, 16)),
              h("span", null, error ? "加载失败" : "加载检测状态…"))));
      }

      function roleCandidateTools(name) {
        var base = (data.blocks && data.blocks[name]) || [];
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
              className: "omd-textarea",
              defaultValue: assign.roles[name].persona || "",
              placeholder: "输入该角色的 persona 说明…",
              spellCheck: false,
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
              key: "omd-extra-" + extraRev,
              className: "omd-textarea omd-extraArea",
              defaultValue: val,
              placeholder: "留空并保存 = 不追加任何内容（默认 codegraph 规则将被移除）…",
              spellCheck: false,
              onBlur: function (e) { setMainPersonaExtra(e.target.value); },
            }),
            h("div", { className: "omd-extraActions" },
              h("button", {
                type: "button",
                className: "omd-extraRestore",
                onClick: restoreMainPersonaExtra,
              }, "恢复默认"),
              h("span", { className: "omd-extraHint" },
                "保存并应用时按此追加到主 agent persona 末尾（顺序：SRC 本体 → 技能行 → 此处）。改动需重启 GUI / 新会话生效。")),
            h("div", { className: "omd-hint" }, "清空保存 = 移除默认 codegraph 规则（配置键 main_agent_persona_extra 记为 ''）。"))
          : null);
      }

      // 主 agent「名称」行：preset 显示名 + persona 身份行 label。默认文案
      // 「编排模式 (Orchestrator)」为后端默认常量，UI 侧硬编码做占位（后端
      // state 无该默认字段就不引，与 mainPersonaExtraDefault 处理思路一致）。
      // 写回校验与后端一致：trim 后 1-60 字符、不含 \r \n；真空字段 = 默认；
      // 非空纯空白视为非法（防误触把已有名称静默清回默认）。
      function mainNameBlock() {
        var DEFAULT_NAME = "编排模式 (Orchestrator)";
        function commitName(raw) {
          var s = String(raw == null ? "" : raw);
          if (/[\r\n]/.test(s)) {
            setNote("主 agent 名称不能包含换行（\\r / \\n），未保存");
            setNameRev(nameRev + 1); // 重挂 input，回到上次生效值
            return;
          }
          var v = s.trim();
          if (s !== "" && v === "") {
            setNote("主 agent 名称不能为纯空白（清空字段或点「恢复默认」可回到默认名称），未保存");
            setNameRev(nameRev + 1);
            return;
          }
          if (v.length > 60) {
            setNote("主 agent 名称过长：trim 后最多 60 字符，未保存");
            setNameRev(nameRev + 1);
            return;
          }
          setAssign(function (prev) {
            var next = JSON.parse(JSON.stringify(prev));
            next.main_agent_name = v === "" ? null : v;
            return next;
          });
          if (v === "") setNameRev(nameRev + 1); // 清空 = 默认：重挂显示占位
        }
        function restoreMainName() {
          setAssign(function (prev) {
            var next = JSON.parse(JSON.stringify(prev));
            next.main_agent_name = null; // null = 默认显示名
            return next;
          });
          setNameRev(nameRev + 1);
        }
        return h("div", { className: "omd-mainName" },
          h("div", { className: "omd-glabel" }, "主 agent 名称（preset 显示名 + persona 身份行）"),
          h("div", { className: "omd-nameRow" },
            h("input", {
              key: "omd-name-" + nameRev,
              type: "text",
              className: "omd-nameInput",
              defaultValue: assign.main_agent_name || "",
              placeholder: DEFAULT_NAME,
              spellCheck: false,
              onBlur: function (e) { commitName(e.target.value); },
            }),
            h("button", { type: "button", className: "omd-extraRestore", onClick: restoreMainName }, "恢复默认")),
          h("div", { className: "omd-hint" },
            "保存并应用后 persona 首行与预设显示名一并替换；留空 = 默认「编排模式 (Orchestrator)」。改动需重启 GUI / 新会话生效。"));
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

      // 内置角色「显示名」行：仅替换该角色默认 persona 首行身份句的主语
      // （toolName / 调用名 / 工具面 / restrict 全不变）；已自定义该角色
      // persona 时此项后端忽略（此处仅提示）。校验与主 agent 名同源约束：
      // trim 后 1-60 字符、不含 \r \n；空 / 纯空白 = 默认（写入 null）。
      // 自定义角色卡不加此输入（其 persona 首行由用户自写），不入此函数。
      function builtinNameBlock(name) {
        var subject = (ROLE_DEFAULT_SUBJECT[name] || name);
        function commitRoleName(raw) {
          var s = String(raw == null ? "" : raw);
          if (/[\r\n]/.test(s)) {
            setNote('内置角色 "' + name + '" 显示名不能包含换行（\\r / \\n），未保存');
            bumpRoleNameRev(name); // 重挂 input，回到上次生效值
            return;
          }
          var v = s.trim();
          if (v.length > 60) {
            setNote('内置角色 "' + name + '" 显示名过长：trim 后最多 60 字符，未保存');
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
          h("div", { className: "omd-glabel" }, "角色显示名（默认 persona 身份句主语；不动工具名/调用名）"),
          h("div", { className: "omd-nameRow" },
            h("input", {
              key: "omd-roleName-" + name + "-" + ((roleNameRev && roleNameRev[name]) || 0),
              type: "text",
              className: "omd-nameInput",
              defaultValue: (assign.roles[name] && assign.roles[name].name) || "",
              placeholder: subject,
              spellCheck: false,
              onBlur: function (e) { commitRoleName(e.target.value); },
            })),
          h("div", { className: "omd-hint" },
            '留空 = 默认身份（如 "You are the ' + subject + ' agent."）；已为该角色自定义 persona 时此项不生效。'));
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
              setNote('角色 "' + name + '" ' + labelOf(key) + "不能包含换行（\\r / \\n），未保存");
              bumpRoleModelRev(name); // 重挂 input，回到上次生效值
              return;
            }
            var v = s.trim();
            if (v.length > 120) {
              setNote('角色 "' + name + '" ' + labelOf(key) + "过长：trim 后最多 120 字符，未保存");
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
              setNote('角色 "' + name + '"：provider 仅在同时配置模型时生效（后端将忽略），已保存');
            }
            if (v === "") bumpRoleModelRev(name); // 清空 = 跟随主 agent：重挂显示占位
          }
          return h("div", { className: "omd-mainName" },
            h("div", { className: "omd-glabel" }, "专用模型（可选；留空 = 跟随主 agent 当前模型）"),
            h("div", { className: "omd-nameRow" },
              h("input", {
                key: "omd-roleModel-" + name + "-" + rev,
                type: "text",
                className: "omd-nameInput",
                defaultValue: role.model || "",
                placeholder: "deepseek-v4-pro",
                spellCheck: false,
                onBlur: function (e) { commitRoleModel("model", e.target.value); },
              }),
              h("input", {
                key: "omd-roleProvider-" + name + "-" + rev,
                type: "text",
                className: "omd-nameInput",
                defaultValue: role.provider || "",
                placeholder: "provider（留空=跟随主 agent）",
                spellCheck: false,
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
              value: sel.value,
              onChange: function (e) { commitRoleModelOption(e.target.value); },
            }, children)),
          h("div", { className: "omd-hint" },
            "选项来自 DSH 已注册的模型路由；留空 = 跟随主 agent，主 agent 换模型时未固定的角色跟着变。"));
      }

      function roleCard(name) {
        var isMain = name === "__main__";
        var display = isMain ? "主 agent" : name;
        var isCustom = !isMain && DEFAULT_ROLES.indexOf(name) === -1;
        var open = name in openMap ? openMap[name] : (isMain || name === "search_external");

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
              return toolItem(t, "base", (a.main_agent_remove || []).indexOf(t) === -1, false,
                function (e) { setMainRemove(t, e.target.checked); }, t);
            })));
          body.push(h("div", { className: "omd-glabel" }, "Host 工具（可加入主 agent）"));
          body.push(h("div", { className: "omd-toolGrid" },
            (data.inventory || []).length
              ? (data.inventory || []).map(function (t) {
                  return toolItem(t, "host", a.main_agent_extra.indexOf(t) !== -1, false,
                    function (e) { setMainExtra(t, e.target.checked); }, t);
                })
              : h("div", { className: "omd-empty" }, "未检测到 host 工具")));
          body.push(h("div", { className: "omd-glabel" }, "技能分配（read 按需：勾选 = persona 写入技能行，主 agent 用 read 加载正文）"));
          body.push((data.skills || []).length
            ? h("div", null,
                h("div", { className: "omd-toolGrid" }, (data.skills || []).map(function (s) {
                  return toolItem(s, "read按需", a.main_agent_skills.indexOf(s) !== -1, false,
                    function (e) { setMainSkill(s, e.target.checked); }, s + "s");
                })),
                h("div", { className: "omd-glabel" }, "内联全文（硬生效，每轮固定 persona 开销，适合 caveman 等风格技能）"),
                h("div", { className: "omd-toolGrid" }, (data.skills || []).map(function (s) {
                  return toolItem(s, "内联全文", a.main_agent_skills_inline.indexOf(s) !== -1, false,
                    function (e) { setMainSkillInline(s, e.target.checked); }, s + "i");
                })))
            : h("div", { className: "omd-empty" }, "未检测到技能目录"));
          body.push(mainPersonaExtraBlock());
        } else {
          // 模型行位置：内置角色卡在「显示名」之后、工具面区之前；自定义角色卡
          // 在 body 顶部（其无默认显示名可换，不加 builtinNameBlock）。两个场景
          // 通用同一 roleModelBlock——下拉模式成对写 provider + model（不存在
          // 「只配 provider」）；目录不可用降级双 input 时才可能出现该状态（后端
          // warn 并忽略）。留空 = 跟随主 agent 当前模型。
          if (!isCustom) body.push(builtinNameBlock(name));
          body.push(roleModelBlock(name));
          var baseTools = roleCandidateTools(name).filter(function (t) { return !hostTool(t); });
          var hostTools = roleCandidateTools(name).filter(function (t) { return hostTool(t); });
          var checked = a.roles[name].tools;
          body.push(h("div", { className: "omd-glabel" }, "基础工具"));
          body.push(h("div", { className: "omd-toolGrid" },
            baseTools.length
              ? baseTools.map(function (t) {
                  return toolItem(t, "base", checked.indexOf(t) !== -1, false,
                    function (e) { setRoleTools(name, t, e.target.checked); }, t);
                })
              : h("div", { className: "omd-empty" }, "无")));
          body.push(h("div", { className: "omd-glabel" }, "Host 工具"));
          body.push(h("div", { className: "omd-toolGrid" },
            hostTools.length
              ? hostTools.map(function (t) {
                  return toolItem(t, "host", checked.indexOf(t) !== -1, false,
                    function (e) { setRoleTools(name, t, e.target.checked); }, t);
                })
              : h("div", { className: "omd-empty" }, "未检测到 host 工具")));
          body.push(personaBlock(name));
        }

        return h("div", { className: "omd-roleCard", key: name },
          head,
          open ? h("div", { className: "omd-roleBody" }, body) : null);
      }

      function skillsBlock() {
        var rows = (data.skills || []).map(function (s) {
          var roleNames = Object.keys(assign.roles);
          var picked = assign.skills[s] || [];
          return h("div", { className: "omd-skillRow", key: s },
            h("span", { className: "omd-skillName", title: s }, s),
            h("div", { className: "omd-skillRoles" }, roleNames.map(function (r) {
              return h("label", { className: "omd-skillRole", key: r },
                h("input", {
                  type: "checkbox",
                  className: "omd-check",
                  checked: picked.indexOf(r) !== -1,
                  onChange: function (e) { setSkill(s, r, e.target.checked); },
                }),
                h("span", null, r));
            })));
        });
        return rows.length ? rows : h("div", { className: "omd-empty" }, "未检测到技能目录");
      }

      var customRoles = Object.keys(assign.roles).filter(function (n) { return DEFAULT_ROLES.indexOf(n) === -1; });

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

      var pluginChips = data ? pluginChipsOf(data) : { primary: [], secondary: [] };

      return h("div", { className: "omd-section" },
        h("p", { className: "omd-intro" }, INTRO),

        // 状态与操作
        h("div", { className: "omd-group" },
          h("div", { className: "omd-groupHeading" },
            h("span", { className: "omd-groupIcon" }, ic(P.IconSettingsOutline16, 14)),
            h("span", null, "状态与操作")),
          statusBarOf(),
          runtimeNoteOf(data),
          h("div", { className: "omd-actions" }, applyBtn, previewBtn, rescanBtn),
          h("div", { className: "omd-chips" },
            h(P.Pill, null, "profile " + (data.effectiveProfile || "web")),
            (data.mcpReports || []).map(function (m) {
              return h(P.Pill, { key: m.serverName },
                "MCP " + m.serverName + " · " + m.count + " 工具",
                m.error ? h("span", { className: "omd-chipErrText" }, "（" + m.error + "）") : null);
            }),
            pluginChips.primary.map(function (p) {
              return h(P.Pill, { key: p.label }, chipTextOf(p));
            }),
            pluginChips.secondary.length
              ? h("span", { className: "omd-chipSecondary" },
                "其他运行时插件：" + pluginChips.secondary.map(function (p) { return p.label; }).join(" · "))
              : null)),

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
          h("button", { type: "button", className: "omd-addRole", onClick: addRole },
            h("span", { className: "omd-addRoleIcon" }, ic(P.IconPlusOutline16, 16)),
            h("span", null, "新建自定义 agent 角色"))),

        // 技能分配
        h("div", { className: "omd-group" },
          h("div", { className: "omd-groupHeading" },
            h("span", { className: "omd-groupIcon" }, ic(P.IconSkillOutline16, 14)),
            h("span", null, "技能分配（软约束：写入对应 agent 的 persona 引导）"),
            h("span", { className: "omd-count" }, (data.skills || []).length)),
          skillsBlock()),

        // 预览生成（预览成功后才出现）
        preview ? h("div", { className: "omd-group" },
          h("div", { className: "omd-groupHeading" },
            h("span", { className: "omd-groupIcon" }, ic(P.IconDataOutline16, 14)),
            h("span", null, "预览生成")),
          h("div", { className: "omd-previewSummary" },
            "✅ 生成成功（未写盘）" + (preview.roleResults || []).map(function (r) {
              return " · " + r.role + ": " + r.intent.length + " → " + r.kept.length;
            }).join("")),
          h("pre", { className: "omd-pre" }, preview.text)) : null);
    }

    // ── cordis client 插件：注册到设置页 settings.section 槽位 ──────────────
    //
    // register 是 "slots" service（SlotRegistry）的方法，不是 slots 包的静态导出；
    // 必须经 fiber inject 依赖 slots，并在 apply(ctx) 里通过 ctx.slots.inject()
    // 等待 settings.section 被声明后再注册（与 ui-settings-general 同款模式）。

    var inject = ["slots"];

    function apply(ctx) {
      ctx.slots.inject("settings.section", function () {
        return ctx.slots.register({
          name: "settings.section",
          id: "paoding",
          order: 50,
          label: function () { return "庖丁配置"; },
        }, ConfigPanel);
      });
    }

    exports.inject = inject;
    exports.apply = apply;

    return module.exports;
  },
});
