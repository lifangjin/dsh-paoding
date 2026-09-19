    // ── 挂载：底部入口 + 会话中栏全页 overlay ──────────────────────────────
    //
    // 入口走宿主 slots 键控槽（sidebar.footer.action，见下方 mountFooterEntry
    // 与 exports.inject 的 slots 声明）；全页 overlay 为纯 DOM + React root：
    //   1) 底部入口：左下角动作条（与插件广场 cordis 徽章同槽位，设置行上方）；
    //      宽栏 42px 圆角行 / 窄栏 36px 圆钮，点击开关 overlay；
    //      由观察器自动放回。
    //   2) 全页 overlay：容器 div（data-dsh-paoding-view）append 到会话中栏，
    //      createRoot 渲染整页配置页；打开态在 <html> 上设
    //      data-dsh-paoding-active，CSS 据此隐藏会话内容、显示本页。与
    //      mnemon / taskboard / ssh 互斥（dsh-panel-activate 事件 + active
    //      属性双通道），点侧栏会话行等上下文自动关闭。

    // react-dom/client：宿主 ModuleLoader seed 提供（mnemon 线上 bundle 同款
    // 用法）。异常宿主下取不到时 overlay 不挂，侧栏入口仍可用（保底不炸）。
    var ReactDOMClient = null;
    try { ReactDOMClient = require("react-dom/client"); } catch (err) { ReactDOMClient = null; }

    // 框架无关的小状态器（照 mnemon 的 MnemonWorkspaceController）：侧栏入口
    // 与全页 overlay 共享同一份 { open } 快照，subscribe 驱动两侧同步。
    // 「带目标工作区打开」的待办路径：宿主工作区菜单的「庖丁配置」入口点击时
    // 写入（controller.open(path)），ConfigPanel 在 state + 工作区列表都就绪后
    // 消费并切到该 tab。放模块级而非 prop 钻透——controller 与 ConfigPanel 分属
    // DOM 注入层与 React 层，中间隔着懒挂载的 createRoot，props 传不进去。
    var pendingOpenWs = null;

    function setPendingOpenWs(wsPath) {
      pendingOpenWs = typeof wsPath === "string" && wsPath.trim() !== ""
        ? wsPath.trim().replace(/[\/\\]+$/, "")
        : null;
    }

    function createWorkspaceController() {
      var snapshot = { open: false };
      var listeners = [];
      function notify() {
        listeners.slice().forEach(function (listener) { listener(); });
      }
      function setOpen(open, reassert) {
        if (snapshot.open === open && !reassert) return;
        snapshot = { open: open };
        notify();
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
        // open 带 reassert：重复打开（如属性观察兜底触发）时也把 active 属性
        // 与互斥广播重新刷一遍，而不是因「已是 true」短路。可选 wsPath = 打开
        // 后要切到的工作区路径（宿主菜单「庖丁配置」入口用，见 pendingOpenWs）。
        open: function (wsPath) { setPendingOpenWs(wsPath); setOpen(true, true); },
        close: function () { setOpen(false); },
        toggle: function () { setOpen(!snapshot.open); },
      };
    }

    // ── 侧栏底部入口（sidebar.footer.action 键控槽）────────────────────────
    // 入口挂在左下角底部动作条：注册 sidebar.footer.action
    // 列表槽（与插件广场 cordis 徽章同一槽位，渲染在设置行上方的动作条里）。
    // 观感复刻 cordis 徽章 / 设置触发钮：宽栏 = 42px 圆角行（图标 + 文案），
    // 窄栏（56px rail）= 36px 圆形图标钮。点击开 / 关全页 overlay（mountPanel
    // 一套不动：互斥广播、工作区菜单深链、Esc 层级照旧）。
    function makeFooterEntry(controller) {
      return function FooterEntry(props) {
        var wide = !!(props && props.wide);
        var _st = useState(controller.getSnapshot().open), open = _st[0], setOpenState = _st[1];
        useEffect(function () {
          return controller.subscribe(function () { setOpenState(controller.getSnapshot().open); });
        }, []);
        return h("button", {
          type: "button",
          className: "pd-footerBtn" + (wide ? "" : " pd-footerRail"),
          "data-active": open ? "true" : undefined,
          "aria-label": "庖丁配置",
          "aria-haspopup": "dialog",
          "aria-expanded": open ? "true" : "false",
          title: wide ? undefined : "庖丁配置",
          onClick: function () { controller.toggle(); },
        },
          h(P.IconSkillOutline16, { size: wide ? 16 : 18 }),
          wide ? h("span", { className: "pd-footerLabel" }, "庖丁配置") : null);
      };
    }

    function mountFooterEntry(ctx, controller) {
      if (typeof document === "undefined") return function () {};
      if (!ctx || !ctx.slots || typeof ctx.slots.inject !== "function" || typeof ctx.slots.register !== "function") {
        return function () {}; // 槽口不可用（老宿主）：静默不挂，面板仅失去底部入口
      }
      var Entry = makeFooterEntry(controller);
      var dispose = ctx.slots.inject("sidebar.footer.action", function () {
        return ctx.slots.register({ name: "sidebar.footer.action", id: "paoding-config", order: 10, label: "庖丁配置" }, Entry);
      });
      return typeof dispose === "function" ? dispose : function () {};
    }


