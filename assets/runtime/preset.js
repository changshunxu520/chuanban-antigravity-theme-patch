// 1. 注入全局自定义样式标签 (#ag-custom-fonts)
let style = document.getElementById("ag-custom-fonts");
if (!style) {
  style = document.createElement("style");
  style.id = "ag-custom-fonts";
  (document.head || document.documentElement).appendChild(style);
}
if (style.textContent !== CSS_CONTENT) {
  style.textContent = CSS_CONTENT;
}

// 2. 三大预设状态联动与防崩溃保护
const PRESETS = {
  HIGH_CONTRAST: "high-contrast",
  CLAUDE_PUREWHITE: "claude-desktop-purewhite",
  VINTAGE_DEEP: "vintage-deep",
  LEGACY_WARM_WHITE: "chuanban-warm-white",
  LEGACY_OFFICIAL: "claude-desktop-official",
  LEGACY_CHUANBAN: "absoulutely-chuanban"
};
const ALL_CUSTOM_PRESETS = new Set(Object.values(PRESETS));

function syncPresetAttribute() {
  try {
    // 穿透包装层，迁移底层物理存储中的历史非法值
    const stored = Storage.prototype.getItem.call(localStorage, "theme-preset-light");
    if (ALL_CUSTOM_PRESETS.has(stored)) {
      try { Storage.prototype.setItem.call(localStorage, "theme-preset-light", "Default Light"); } catch (e) {}
    }

    // 深色模式保留官方配色，避免浅色文字覆盖导致不可读。
    if (!document.body.classList.contains("theme-light")) {
      document.documentElement.removeAttribute("data-ag-preset");
      return;
    }
    const flavor = Storage.prototype.getItem.call(localStorage, "theme-color-flavor") || PRESETS.HIGH_CONTRAST;
    // An explicit native-style selection must not be mistaken for the legacy warm preset.
    if (flavor === 'default-light' || flavor === 'off') {
      document.documentElement.removeAttribute('data-ag-preset');
      return;
    }
    const currentBg = (window.getComputedStyle(document.documentElement).getPropertyValue("--background") || "").trim().toUpperCase();
    const isWarmBg = (currentBg === "#FBF9F5" || currentBg === "#FCFCFB");

    if (flavor === PRESETS.HIGH_CONTRAST || flavor === PRESETS.LEGACY_WARM_WHITE || flavor === "高对比版") {
      document.documentElement.setAttribute("data-ag-preset", PRESETS.HIGH_CONTRAST);
    } else if (flavor === PRESETS.CLAUDE_PUREWHITE || flavor === PRESETS.LEGACY_OFFICIAL || flavor === "ClaudeDesktop 净白") {
      document.documentElement.setAttribute("data-ag-preset", PRESETS.CLAUDE_PUREWHITE);
    } else if (flavor === PRESETS.VINTAGE_DEEP || flavor === PRESETS.LEGACY_CHUANBAN || flavor === "复古深色" || isWarmBg) {
      document.documentElement.setAttribute("data-ag-preset", PRESETS.VINTAGE_DEEP);
    } else {
      document.documentElement.removeAttribute("data-ag-preset");
    }
  } catch (e) {}
}

// 3. 拦截 localStorage 防止非官方预设名污染导致系统设置弹窗白屏崩溃
if (!window.__ag_preset_hooked) {
  window.__ag_preset_hooked = true;
  try {
    const originalGet = localStorage.getItem.bind(localStorage);
    localStorage.getItem = function(k) {
      const val = originalGet(k);
      if (k === "theme-preset-light" && ALL_CUSTOM_PRESETS.has(val)) {
        return "Default Light";
      }
      return val;
    };

    const originalSet = localStorage.setItem.bind(localStorage);
    localStorage.setItem = function(k, v) {
      if (k === "theme-preset-light" && ALL_CUSTOM_PRESETS.has(v)) {
        v = "Default Light";
      }
      originalSet(k, v);
      if (k === "theme-preset-light" || k === "theme-mode" || k === "theme-color-flavor") {
        setTimeout(syncPresetAttribute, 50);
      }
    };
  } catch (e) {}
}

syncPresetAttribute();
// ⚠️ 注意：必须与步骤 5 checkAndHeal 的探针版本完全一致，否则会触发每 2.5s 无限重注入！
window.__ag_patch_version = "20261101-metrics-v4";
// React 更改主题类名后同步覆盖范围。
window.__ag_theme_observer?.disconnect();
window.__ag_theme_observer = new MutationObserver(syncPresetAttribute);
window.__ag_theme_observer.observe(document.body,{attributes:true,attributeFilter:["class"]});
