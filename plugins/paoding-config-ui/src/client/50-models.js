    // ── 角色专用模型下拉（目录来自 GET /api/paoding/models，Node 半经
    //    ctx.llm 服务（listProviders / listModels）取已注册的模型路由）──────

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

