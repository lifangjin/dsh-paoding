    // ── 全页 overlay ────────────────────────────────────────────────────────

    var CONVERSATION_COLUMN_SELECTOR = '[data-pane="conversation"], [class*="centerCol"], .dshDesktopConversationSurface';
    var ACTIVE_ATTR = "data-dsh-paoding-active";
    var MNEMON_ACTIVE_ATTR = "data-dsh-mnemon-active";
    var TASKBOARD_ACTIVE_ATTR = "data-dsh-taskboard-active";
    var SSH_ACTIVE_ATTR = "data-dsh-ssh-active";
    var ACTIVATE_EVENT = "dsh-panel-activate";
    // 点侧栏上下文（会话行 / 项目行 / 搜索结果 / 新会话 / 各插件入口）时自动
    // 关闭本页——用户已离开配置语境。
    var SIDEBAR_CONTEXT_SELECTOR = "[data-dsh-taskboard-entry], [data-dsh-ssh-entry], [data-dsh-mnemon-entry], [data-dsh-paoding-entry], [class*=\"sessionRow\"], [class*=\"projectRow\"], [class*=\"searchResultRow\"], [class*=\"searchResultWorkspace\"], [class*=\"newSession\"]";

    // 整页骨架：页头（标题 + 副标题 + 右上关闭）+ 内容区（ConfigPanel 整页
    // 内容，.pd-page 自身即滚动容器，悬浮操作坞的 sticky 语义在其中成立）。
    // Esc 关闭挂 document keydown（冒泡阶段）：「添加工作区」弹窗、「新建 /
    // 重命名角色」弹窗与「更多」菜单开着时，ConfigPanel 的捕获级监听先截停
    // Esc（只收菜单 / 建议下拉 / 弹窗，不关页）；确认弹窗开着时由 ConfirmLayer
    // 的捕获级监听截停（只关确认框）；事件都到不了这里。其余位置 Esc 一律关页。
    // 一键升级（页头更新卡「升级」按钮，统一入口）：
    // POST /api/paoding/upgrade，服务端 spawn `dsh plugin --profile <profile>
    // update dsh-paoding` 原地换版本，分钟级操作。确认弹窗（原原生 confirm
    // 改通用确认弹窗，confirmCtrl 单例见 70 片段）文案按挂载形态分流：
    // dev link 直连形态（layout 由服务端 version 路由按包根 .git 判定）无法
    // 就地升级，把手动切换命令说在前头；installed（registry 版）原地换版本，
    // 从简。反馈（成功 note / 失败 err，含子进程输出尾部）都收在卡内，不与
    // 面板的 toast 反馈混流。升级非破坏性操作，danger 不置位；弹窗本体由
    // PageShell 末尾的 ConfirmLayer 渲染（页头与面板发起的确认共用一层）。
    function runUpgradeFlow(verInfo, setVerInfo, setUpgBusy, setUpgNote, setUpgErr) {
      if (!verInfo || !verInfo.latest) return;
      var isDev = verInfo.layout === "dev";
      var msg = isDev
        ? "当前为开发 link 直连形态：无法就地升级，请手动执行 dsh plugin add dsh-paoding@latest 切换到 registry 版本。仍要继续尝试吗？"
        : "确定升级到 " + versionTagOf(verInfo.latest) + "？升级将通过 dsh plugin update 原地换版本，完成后需重启 DSH 生效。";
      confirmCtrl.ask({
        title: "升级 dsh-paoding",
        body: msg,
        danger: false,
        confirmText: "升级",
        onConfirm: function () {
          setUpgBusy(true);
          setUpgNote("");
          setUpgErr("");
          paodingApi("upgrade", {}).then(function (r) {
            if (r && r.upToDate) { setUpgNote("已是最新版本"); return; }
            var done = versionTagOf((r && r.version) || verInfo.latest);
            setUpgNote((r && r.message) || ("✅ 已升级到 " + done + "，重启 DSH 后新版本生效（preset 会自动按新版重生成）"));
            // 重拉版本信息：服务端有 1 小时缓存且本进程挂的还是旧代码，重启前
            // 更新卡可能仍在（重启后自然消失），以此处的生效提示为准。
            paodingApi("version").then(function (d) {
              if (d && typeof d.current === "string" && d.current) setVerInfo(d);
            }).catch(function () { /* 静默：升级已完成，重拉失败不打扰 */ });
          }).catch(function (err) {
            // 失败要醒目：截服务端透传的子进程输出尾部 ~300 字符并入 err，方便
            // 定位 pnpm 缓存权限（EPERM）之类环境问题，不用翻服务端日志。
            var tail = typeof err.output === "string" && err.output ? "：" + err.output.slice(-300) : "";
            setUpgErr(err.message + tail);
          }).finally(function () {
            setUpgBusy(false);
          });
        },
      });
    }

    // 确认弹窗层：订阅 70 片段的 confirmCtrl 单例（照 makeFooterEntry 的
    // useState + subscribe 写法），渲染 confirmModalOf。挂在 PageShell 根数组
    // 末尾——fixed 全屏遮罩覆盖整页，面板（删除角色 / 保存并应用）与页头
    // （升级）发起的确认都罩得住。
    // Esc 分层：自带 document 捕获级 keydown 监听。ConfigPanel 的捕获级监听
    // 先注册（ConfigPanel 是 PageShell 的子组件，子 effect 先于本组件 effect
    // 运行），但它只在自己弹窗 / 菜单开着时才 stopPropagation——确认框开着
    // 时该监听放行，本监听（注册在后）截停并只关确认框；stopPropagation 之后
    // PageShell 冒泡层的关页监听收不到事件，确认框开着时 Esc 不会顺带关页。
    // req 为空时不截停，Esc 照常落到关页监听。确认路径见 confirmModalOf：
    // 先 close（req 清空、弹窗卸载）再执行 onConfirm，异步期间重复 Enter /
    // 双击不会再触发。
    function ConfirmLayer() {
      var _cq = useState(confirmCtrl.getSnapshot()), confirmSnap = _cq[0], setConfirmSnap = _cq[1];
      useEffect(function () {
        return confirmCtrl.subscribe(function () { setConfirmSnap(confirmCtrl.getSnapshot()); });
      }, []);
      useEffect(function () {
        var onKey = function (e) {
          if (!e || e.key !== "Escape") return;
          if (!confirmCtrl.getSnapshot().req) return; // 无确认框不截停：放行给关页监听
          e.stopPropagation();
          confirmCtrl.close();
        };
        document.addEventListener("keydown", onKey, true);
        return function () { document.removeEventListener("keydown", onKey, true); };
      }, []);
      return confirmModalOf(confirmSnap.req, confirmCtrl.close);
    }

    function PageShell(props) {
      var onClose = props.onClose;
      // 版本信息挂页头（拉取逻辑仍在 ConfigPanel 的 loadVersion，经 setVerInfo 回写）
      var _v = useState(null), verInfo = _v[0], setVerInfo = _v[1];
      // 升级动作随更新卡留在页头：独立 busy/note/err，不复用 ConfigPanel 的
      // 面板级互斥——页头与面板各自成区，写盘目标不同（升级换插件载荷、面板
      // 写预设与配置），升级期间面板照常预览编辑互不干扰。
      var _ub = useState(false), upgBusy = _ub[0], setUpgBusy = _ub[1];
      var _un = useState(""), upgNote = _un[0], setUpgNote = _un[1];
      var _ue = useState(""), upgErr = _ue[0], setUpgErr = _ue[1];
      // 版本检测重试进行中（页头失败行的「重试」按钮禁用态）：与升级三态分开，
      // 检测失败重试不该锁升级（升级预检在服务端另做一次，不依赖这份 verInfo）。
      var _vb = useState(false), verRetryBusy = _vb[0], setVerRetryBusy = _vb[1];

      // 一键升级逻辑在共享的 runUpgradeFlow（页头更新卡统一走这一份）。
      function doUpgrade() {
        runUpgradeFlow(verInfo, setVerInfo, setUpgBusy, setUpgNote, setUpgErr);
      }

      // 检测失败重试：直接再拉一次 /api/paoding/version（服务端失败结果不进
      // 缓存，重试即真实检测；成功则 error 随新响应自然清空）。仍失败维持
      // 原提示——失败行常驻，重试按钮永远可用。
      function doRetryVersion() {
        setVerRetryBusy(true);
        paodingApi("version").then(function (d) {
          if (d && typeof d.current === "string" && d.current) setVerInfo(d);
        }).catch(function () { /* 仍不通：维持失败行，不额外打扰 */ }).finally(function () {
          setVerRetryBusy(false);
        });
      }
      useEffect(function () {
        var onKey = function (e) {
          if (e && e.key === "Escape" && typeof onClose === "function") onClose();
        };
        document.addEventListener("keydown", onKey);
        return function () { document.removeEventListener("keydown", onKey); };
      }, []);
      return h("div", { className: "pd-shell" },
        h("header", { className: "pd-pageHeader" },
          h("div", { className: "pd-pageTitles" },
            // 标题行：标题 + 版本号 + （有新版时的）更新卡并排；窄屏放不下时
            // 换行收纳，副标题独占下一行
            h("div", { className: "pd-titleRow" },
              h("h1", { className: "pd-pageTitle" }, "庖丁配置",
                verInfo && typeof verInfo.current === "string" && verInfo.current
                  ? h("span", { className: "pd-versionTag" }, versionTagOf(verInfo.current))
                  : null),
              versionRowOf(verInfo, { busy: upgBusy, onUpgrade: doUpgrade, note: upgNote, error: upgErr, onRetry: doRetryVersion, retryBusy: verRetryBusy })),
            h("p", { className: "pd-pageSubtitle" },
              "为主 agent 与子 agent 编排工具、技能与角色，预览并应用生成的 agent.cordis.yml。")),
          h("button", {
            type: "button",
            className: "pd-closeBtn",
            "aria-label": "关闭庖丁配置",
            title: "关闭（Esc）",
            onClick: function () { if (typeof onClose === "function") onClose(); },
          }, h("span", { className: "pd-closeGlyph", "aria-hidden": "true" }, "×"))),
        h(ConfigPanel, { setVerInfo: setVerInfo }),
        // 反馈 toast 宿主：订阅模块级 toast 控制器，悬浮于操作坞上方
        h(ToastHost),
        // 通用确认弹窗层：订阅 confirmCtrl（发起方见各 confirmCtrl.ask 调用点），
        // 放根数组末尾——fixed 遮罩不占布局流，页头 / 面板发起的确认都盖得住；
        // 无确认时渲染 null，仅保留 Esc 监听。
        h(ConfirmLayer));
    }

    // 全页 overlay 挂载：容器 div append 到会话中栏，createRoot 渲染 PageShell。
    // 懒挂载——首次打开才建容器 / 发起面板首屏请求；此后容器常驻（CSS 按
    // active 属性显隐），被 React 挤掉时由观察器重挂。
    function mountPanel(controller) {
      if (typeof document === "undefined" || typeof window === "undefined" || !ReactDOMClient) {
        return function () {};
      }
      var root;
      var container;
      var ensure = function () {
        if (!controller.getSnapshot().open) return; // 懒挂载：只在打开态维护容器
        if (container && container.isConnected) return;
        if (container) {
          if (root) root.unmount();
          root = undefined;
          container = undefined;
        }
        var column = document.querySelector(CONVERSATION_COLUMN_SELECTOR);
        if (!column) return;
        container = document.createElement("div");
        // dataset 驼峰转数据属性：dshPaodingView → data-dsh-paoding-view
        container.dataset.dshPaodingView = "";
        container.className = "pd-panelView";
        column.appendChild(container);
        root = ReactDOMClient.createRoot(container);
        root.render(h(PageShell, {
          onClose: function () { controller.close(); },
        }));
      };
      // 会话中栏晚于插件挂载 / 容器被挤掉时重挂
      var waitObserver = new MutationObserver(ensure);
      waitObserver.observe(document.body, { childList: true, subtree: true });

      var suppressCompatibilityClose = false;
      var applyActive = function () {
        if (!controller.getSnapshot().open) {
          document.documentElement.removeAttribute(ACTIVE_ATTR);
          return;
        }
        // 互斥：先广播请走 taskboard / ssh（兼容旧面板的事件协议），清掉三家
        // 的 active 属性（它们的属性观察者会自行关闭），再点亮自己、以
        // detail:"paoding" 对外宣告。
        suppressCompatibilityClose = true;
        try {
          document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: "ssh" }));
          document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: "taskboard" }));
        } finally {
          suppressCompatibilityClose = false;
        }
        document.documentElement.removeAttribute(MNEMON_ACTIVE_ATTR);
        document.documentElement.removeAttribute(TASKBOARD_ACTIVE_ATTR);
        document.documentElement.removeAttribute(SSH_ACTIVE_ATTR);
        document.documentElement.setAttribute(ACTIVE_ATTR, "");
        ensure();
        document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: "paoding" }));
      };
      // 其它全页面板激活（taskboard / ssh / mnemon）→ 关闭自己
      var onOtherPanelActivate = function (event) {
        if (suppressCompatibilityClose || !controller.getSnapshot().open) return;
        var detail = event && event.detail;
        if (detail === "taskboard" || detail === "ssh" || detail === "mnemon") controller.close();
      };
      var onSidebarContextClick = function (event) {
        if (!controller.getSnapshot().open) return;
        var target = event.target;
        if (target && typeof target.closest === "function" && target.closest(SIDEBAR_CONTEXT_SELECTOR)) {
          controller.close();
        }
      };
      // 属性兜底：发现自己 active 丢了、或别的面板 active 了 → 关闭
      var activeObserver = new MutationObserver(function () {
        if (!controller.getSnapshot().open) return;
        var html = document.documentElement;
        if (!html.hasAttribute(ACTIVE_ATTR) || html.hasAttribute(MNEMON_ACTIVE_ATTR) ||
          html.hasAttribute(TASKBOARD_ACTIVE_ATTR) || html.hasAttribute(SSH_ACTIVE_ATTR)) {
          controller.close();
        }
      });
      activeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: [ACTIVE_ATTR, MNEMON_ACTIVE_ATTR, TASKBOARD_ACTIVE_ATTR, SSH_ACTIVE_ATTR],
      });

      document.addEventListener("click", onSidebarContextClick, true);
      document.addEventListener(ACTIVATE_EVENT, onOtherPanelActivate);
      var unsubscribe = controller.subscribe(applyActive);
      applyActive();
      return function () {
        document.removeEventListener("click", onSidebarContextClick, true);
        document.removeEventListener(ACTIVATE_EVENT, onOtherPanelActivate);
        activeObserver.disconnect();
        waitObserver.disconnect();
        unsubscribe();
        document.documentElement.removeAttribute(ACTIVE_ATTR);
        if (root) root.unmount();
        root = undefined;
        if (container) container.remove();
        container = undefined;
      };
    }

