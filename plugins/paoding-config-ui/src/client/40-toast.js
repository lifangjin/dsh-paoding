    // ── Toast 反馈控制器（模块级单例，PageShell 的 ToastHost 订阅渲染）──────
    // 三档：ok（成功，4s 自动消失）/ warn（校验提示，6s）/ err（错误，粘性——
    // 不自动消失，手动 × 关；错误文本可能很长（子进程输出尾部等），限高滚动。
    // 栈上限 4 条，超出丢最旧。id 自增；定时器只挂自动消失档。
    function createToastCtrl() {
      var seq = 0;
      var items = [];
      var listeners = [];
      function notify() { listeners.slice().forEach(function (fn) { fn(); }); }
      function dismiss(id) {
        items = items.filter(function (it) { return it.id !== id; });
        notify();
      }
      function push(kind, text) {
        var it = { id: ++seq, kind: kind, text: String(text || "") };
        items = items.concat([it]);
        if (items.length > 4) items = items.slice(items.length - 4);
        if (kind !== "err") {
          it.timer = setTimeout(function () { dismiss(it.id); }, kind === "warn" ? 6000 : 4000);
        }
        notify();
        return it.id;
      }
      return {
        ok: function (t) { return push("ok", t); },
        warn: function (t) { return push("warn", t); },
        err: function (t) { return push("err", t); },
        dismiss: dismiss,
        subscribe: function (fn) {
          listeners.push(fn);
          return function () { listeners = listeners.filter(function (f) { return f !== fn; }); };
        },
        snapshot: function () { return items.slice(); },
      };
    }
    var toast = createToastCtrl();

    // 页头版本更新卡：常态版本号常驻标题旁（pd-versionTag），检测到新版本时
    // 在标题右侧并排一张紧凑警示卡（🆙 新版本链接 + 升级按钮）。由 PageShell
    // 渲染并持有升级动作，面板正文不再重复版本信息；当前版本号就在旁边的
    // pd-versionTag 上，卡内不再赘述「（当前 vX）」。note / error 为升级
    // 反馈行（成功提示 / 失败原因，含子进程输出尾部），也收在卡内。
    function versionRowOf(v, opts) {
      if (!v || typeof v.current !== "string" || !v.current) return null;
      if (!(v.updateAvailable && v.latest)) return null;
      var busy = !!opts && !!opts.busy;
      var note = (opts && opts.note) || "";
      var error = (opts && opts.error) || "";
      return h("div", { className: "omd-versionRow omd-versionNew" },
        h("span", { className: "omd-versionIcon" }, "🆙"),
        h("span", { className: "omd-versionText" },
          "新版本 " + versionTagOf(v.latest) + " 可用 · ",
          // 只信 https://github.com/ 的 release 链接；其余取值一律不渲染 <a>。
          v.releaseUrl && /^https:\/\/github\.com\//.test(v.releaseUrl)
            ? h("a", {
                className: "omd-versionLink",
                href: v.releaseUrl,
                target: "_blank",
                rel: "noreferrer",
              }, "查看更新")
            : null),
        typeof (opts && opts.onUpgrade) === "function"
          ? h("button", {
              type: "button",
              className: "omd-upgradeBtn",
              disabled: busy,
              onClick: opts.onUpgrade,
            }, busy ? "升级中…" : "升级")
          : null,
        busy ? h("span", { className: "omd-upgradeHint" }, "下载安装中，最长约 2 分钟") : null,
        error
          ? h("span", { className: "omd-versionNote omd-versionNoteErr" }, error)
          : (note ? h("span", { className: "omd-versionNote" }, note) : null));
    }

    // 反馈弹窗宿主：fixed 悬浮在操作坞上方，水平居中；host 本身 pointer-events:
    // none，只有 toast 本体接事件（不挡下方按钮）。ok/warn 自动消失，err 带 ×
    // 手动关。aria-live 播报；err 单条 role=alert 更醒目。
    function ToastHost() {
      var _t = useState(function () { return toast.snapshot(); }), items = _t[0], setItems = _t[1];
      useEffect(function () {
        return toast.subscribe(function () { setItems(toast.snapshot()); });
      }, []);
      if (!items.length) return null;
      return h("div", { className: "pd-toastHost", "aria-live": "polite" },
        items.map(function (it) {
          return h("div", {
              key: it.id,
              className: "pd-toast pd-toast" + it.kind.charAt(0).toUpperCase() + it.kind.slice(1),
              role: it.kind === "err" ? "alert" : "status",
            },
            h("span", { className: "pd-toastIcon", "aria-hidden": "true" },
              it.kind === "err" ? "⛔" : it.kind === "warn" ? "⚠️" : "✅"),
            h("div", { className: "pd-toastText" }, it.text),
            h("button", {
              type: "button",
              className: "pd-toastClose",
              "aria-label": "关闭提示",
              onClick: function () { toast.dismiss(it.id); },
            }, h("span", { className: "pd-closeGlyph", "aria-hidden": "true" }, "×")));
        }));
    }

