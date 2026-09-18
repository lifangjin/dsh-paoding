    // ── 宿主工作区「...」菜单注入桥 ──────────────────────────────────────────
    // 宿主侧栏工作区行的「...」菜单只有「重命名 / 删除工作区」两项，onSelect
    // 硬编码只认这两个 id，没有插件扩展点。这里从 DOM 层补一个「庖丁配置」项：
    //   1. 捕获级监听 document 点击，按触发钮 aria-label（工作区“<名>”的操作）
    //      记下最近一次操作的宿主工作区名；
    //   2. MutationObserver 盯菜单 portal（每次打开都是新建 DOM）：认出「重命名
    //      + 删除工作区」两行 = 工作区菜单，克隆重命名行改文案为「庖丁配置」——
    //      克隆而非自绘，类名跟宿主构建走，观感天然一致，hash 类名升级也不怕；
    //   3. 点击：先合成 Escape 关掉宿主菜单，再按记下的名字到 /api/paoding/
    //      workspaces 反查路径（title 精确 → basename 兜底），controller.open
    //      (path) 打开本页，ConfigPanel 就绪后自动切到该工作区 tab。
    // 反查失败（列表拉不到 / 名字对不上）仍打开页面，落在全局默认并给 warn。
    // 宿主 i18n 的 aria-label 模板是「工作区“{name}”的操作」（zh）/「Workspace
    // “{name}” actions」类变体（en），这里宽松匹配：引号样式 + 尾缀都容错。
    function wsTitleFromAriaLabel(label) {
      if (typeof label !== "string" || label === "") return null;
      var m = label.match(/^(?:工作区|Workspace)\s*[“"']([^”"']{1,120})[”"']/);
      return m ? m[1] : null;
    }

    function mountWorkspaceMenuBridge(controller) {
      if (typeof document === "undefined" || typeof MutationObserver === "undefined") {
        return function () {};
      }
      var lastWsTitle = null;

      function onClickCapture(e) {
        var btn = e.target && e.target.closest ? e.target.closest("button[aria-label]") : null;
        if (!btn) return;
        var title = wsTitleFromAriaLabel(btn.getAttribute("aria-label"));
        if (title !== null) lastWsTitle = title;
      }

      // 在菜单 portal 里找「工作区菜单」：所有文本叶子按已知文案对筛，命中后
      // 爬回菜单行（列表容器的直接子级），并要求同容器存在「删除」行作证。
      function findHostWsMenu(rootNode) {
        var scopes = [rootNode, document.body];
        for (var si = 0; si < scopes.length; si++) {
          var scope = scopes[si];
          if (!scope || !scope.querySelectorAll) continue;
          var leafs = scope.querySelectorAll("button, [role='menuitem'], li, div, span");
          for (var i = 0; i < leafs.length; i++) {
            var leaf = leafs[i];
            if (leaf.childElementCount !== 0) continue;
            var txt = (leaf.textContent || "").trim();
            var isRename = txt === "重命名" || txt === "Rename";
            if (!isRename) continue;
            var row = leaf;
            while (row.parentElement && row.parentElement.childElementCount < 2) row = row.parentElement;
            var list = row.parentElement;
            if (!list) continue;
            var hasDelete = false;
            for (var c = 0; c < list.children.length; c++) {
              var t = (list.children[c].textContent || "");
              if (t.indexOf("删除工作区") !== -1 || t.indexOf("Delete workspace") !== -1) { hasDelete = true; break; }
            }
            if (!hasDelete) continue; // 缺「删除工作区」佐证：非工作区菜单（其他重命名入口），继续扫下一候选
            // 已注入过（自家行在菜单里）就不再动
            if (list.querySelector("[data-paoding-ws-menu]")) return null;
            return row;
          }
        }
        return null;
      }

      // 克隆宿主菜单行：换文案、清 id / aria 引用（防重复），打自家标记。
      function buildPaodingRow(modelRow, onPick) {
        var mine = modelRow.cloneNode(true);
        mine.removeAttribute("id");
        var inner = mine.querySelectorAll ? mine.querySelectorAll("[id]") : [];
        for (var i = 0; i < inner.length; i++) inner[i].removeAttribute("id");
        mine.setAttribute("data-paoding-ws-menu", "1");
        mine.setAttribute("aria-label", "庖丁配置");
        mine.setAttribute("title", "打开庖丁配置并切到该工作区");
        var walker = document.createTreeWalker(mine, NodeFilter.SHOW_TEXT, null);
        var node;
        while ((node = walker.nextNode())) {
          var t = node.nodeValue;
          if (t.indexOf("重命名") !== -1 || t.toLowerCase().indexOf("rename") !== -1) {
            node.nodeValue = t.replace(/重命名|Rename/gi, "庖丁配置");
          }
        }
        mine.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          onPick();
        });
        return mine;
      }

      // 合成 Escape 关宿主菜单（portal 挂 body，宿主 Menu 自行监听关闭）。
      function closeHostMenu() {
        try { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); } catch (err) { /* 老内核无构造器：跳过 */ }
      }

      function pickAndOpen() {
        var title = lastWsTitle;
        closeHostMenu();
        // 等 Escape 落地再开本页（宿主菜单关闭与 overlay 激活互不抢事件）
        setTimeout(function () {
          if (!title) { controller.open(); return; }
          paodingApi("workspaces").then(function (d) {
            var items = (d && Array.isArray(d.items)) ? d.items : [];
            var hit = null;
            for (var i = 0; i < items.length; i++) {
              var it = items[i];
              if (!it || typeof it.path !== "string" || it.path === "") continue;
              if (typeof it.title === "string" && it.title === title) { hit = it.path; break; }
            }
            if (!hit) {
              // 标题对不上：按 basename 兜底（宿主缺省标题常取目录名）
              var norm = title.replace(/[\/\\]+$/, "");
              var base = norm.split("/").pop();
              for (var j = 0; j < items.length; j++) {
                var p = items[j] && items[j].path;
                if (typeof p !== "string" || p === "") continue;
                var pb = p.replace(/[\/\\]+$/, "").split("/").pop();
                if (pb === base) { hit = p; break; }
              }
            }
            if (hit) controller.open(hit);
            else {
              controller.open();
              toast.warn("宿主工作区「" + title + "」还没在庖丁注册，已打开全局默认");
            }
          }).catch(function () {
            controller.open();
            toast.warn("工作区列表拉取失败，已打开全局默认");
          });
        }, 80);
      }

      // 闸门：mutation 记录里新增的元素含「重命名 / Rename」才进全量扫描——
      // 聊天流 DOM 变更频繁，菜单 portal 是 body 直挂的小 subtree，先粗筛再细认。
      function recordsLookLikeMenu(records) {
        for (var i = 0; i < records.length; i++) {
          var added = records[i] && records[i].addedNodes;
          if (!added) continue;
          for (var j = 0; j < added.length; j++) {
            var n = added[j];
            if (!n || n.nodeType !== 1) continue;
            var txt = n.textContent || "";
            if (txt.indexOf("重命名") !== -1 || txt.toLowerCase().indexOf("rename") !== -1) return true;
          }
        }
        return false;
      }

      var mo = new MutationObserver(function (records) {
        if (!recordsLookLikeMenu(records)) return;
        var model = findHostWsMenu(document.body);
        if (!model || !model.parentElement) return;
        model.parentElement.appendChild(buildPaodingRow(model, pickAndOpen));
      });
      mo.observe(document.body, { childList: true, subtree: true });
      document.addEventListener("click", onClickCapture, true);
      return function () {
        mo.disconnect();
        document.removeEventListener("click", onClickCapture, true);
      };
    }

