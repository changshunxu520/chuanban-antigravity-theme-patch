// 4.1 捕获阶段破除设置弹窗路由死锁并保留路由 State
if (!window.__ag_settings_guard_installed) {
  window.__ag_settings_guard_installed = true;
  document.addEventListener("click", (e) => {
    const btn = e.target && e.target.closest && e.target.closest('[data-testid="settings-button"]');
    if (!btn) return;

    const hasDialog = !!document.querySelector('[role="dialog"]');
    const urlHasSettings = window.location.search.includes("settingsOpen=true");

    if (!hasDialog && urlHasSettings) {
      const url = new URL(window.location.href);
      url.searchParams.delete("settingsOpen");
      url.searchParams.delete("settingsScreen");
      // 必须保留 window.history.state，避免抹去 TanStack Router 的 __TSR_key / __TSR_index
      window.history.replaceState(window.history.state, "", url.toString());
    }
  }, true);
}

// 4.2 恢复 Cmd + - / Cmd + = / Cmd + 0 界面缩放快捷键
if (!window.__ag_zoom_guard_installed) {
  window.__ag_zoom_guard_installed = true;
  window.addEventListener("keydown", (e) => {
    if (window.electronNative?.zoomOut && window.electronNative?.zoomIn && window.electronNative?.zoomReset && e.metaKey && !e.ctrlKey && !e.altKey) {
      if (!e.shiftKey && (e.key === "-" || e.code === "Minus" || e.code === "NumpadSubtract" || e.keyCode === 189)) {
        e.preventDefault(); e.stopPropagation(); window.electronNative?.zoomOut?.();
      } else if (e.key === "=" || e.key === "+" || e.code === "Equal" || e.code === "NumpadAdd" || e.keyCode === 187) {
        e.preventDefault(); e.stopPropagation(); window.electronNative?.zoomIn?.();
      } else if (!e.shiftKey && (e.key === "0" || e.code === "Digit0" || e.code === "Numpad0" || e.keyCode === 48)) {
        e.preventDefault(); e.stopPropagation(); window.electronNative?.zoomReset?.();
      }
    }
  }, true);
}
