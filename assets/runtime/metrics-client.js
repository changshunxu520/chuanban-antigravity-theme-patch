const MIDDLE_MIN_WIDTH_PX = 150;

function extractCascadeId() {
  try {
    const m = window.location.pathname.match(/\/c\/([0-9a-f-]{36})/i);
    if (m) return m[1];
    const q = new URLSearchParams(window.location.search).get("cascadeId");
    if (q && /^[0-9a-f-]{36}$/i.test(q)) return q;
  } catch (e) {}
  return "";
}

function ensureMetricsTooltip() {
  let tt = document.getElementById("ag-live-metrics-tooltip");
  if (!tt && document.body) {
    tt = document.createElement("div");
    tt.id = "ag-live-metrics-tooltip";
    document.body.appendChild(tt);
  } else if (tt && tt.parentElement !== document.body && document.body) {
    document.body.appendChild(tt);
  }
  return tt;
}

function findFooterRow(box) {
  if (!box) return null;
  const rows = box.querySelectorAll("div.flex.w-full.items-center.justify-between");
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].querySelector('[data-testid="model-selector-trigger"], [data-testid="send-button"]')) {
      return rows[i];
    }
  }
  return rows[rows.length - 1] || null;
}

function measureNaturalLeftWidth(leftGroup) {
  let w = 0;
  for (let i = 0; i < leftGroup.children.length; i++) {
    const ch = leftGroup.children[i];
    if (ch.id === "ag-live-metrics-pill") continue;
    const cw = Math.max(ch.offsetWidth || 0, ch.scrollWidth || 0);
    if (cw > 0) w += cw;
  }
  return w;
}

function ensureMetricsPill() {
  const box = document.getElementById("antigravity.agentSidePanelInputBox");
  if (!box) return null;
  const bottomRow = findFooterRow(box);
  if (!bottomRow || !bottomRow.children[0]) return null;
  const leftGroup = bottomRow.children[0];
  const rightGroup = bottomRow.children[1] || null;

  let pill = document.getElementById("ag-live-metrics-pill");
  if (pill && pill.getAttribute("data-v") !== "3") {
    pill.remove();
    pill = null;
  }
  if (!pill) {
    pill = document.createElement("div");
    pill.id = "ag-live-metrics-pill";
    pill.setAttribute("data-v", "3");
    pill.innerHTML = '<span id="ag-live-metrics-text"></span>';
    pill.addEventListener("mouseenter", () => {
      const tt = ensureMetricsTooltip();
      if (!tt || !tt.innerHTML) return;
      const r = pill.getBoundingClientRect();
      const ttWidth = Math.min(440, Math.max(370, tt.offsetWidth || 400));
      const left = Math.max(12, Math.min(r.left, window.innerWidth - ttWidth - 16));
      const bottomPx = Math.min(window.innerHeight - r.top + 8, window.innerHeight - (tt.offsetHeight || 220) - 12);
      tt.style.left = left + "px";
      tt.style.bottom = Math.max(8, bottomPx) + "px";
      tt.setAttribute("data-visible", "1");
    });
    pill.addEventListener("mouseleave", () => {
      const tt = document.getElementById("ag-live-metrics-tooltip");
      if (tt) tt.removeAttribute("data-visible");
    });
  }

  const rowW = bottomRow.clientWidth || 0;
  const leftW = measureNaturalLeftWidth(leftGroup);
  const rightW = rightGroup ? (rightGroup.offsetWidth || 0) : 0;
  const availMiddleW = rowW - leftW - rightW - 14;
  const useBottomRow = rowW > 0 && availMiddleW < MIDDLE_MIN_WIDTH_PX;
  const rowMode = useBottomRow ? "bottom" : "middle";

  bottomRow.setAttribute("data-ag-row-mode", rowMode);
  pill.setAttribute("data-ag-row-mode", rowMode);

  if (useBottomRow) {
    // 物理挂载至 bottomRow 正下方 (surface-composer-card flex-col 的下一行)
    const cardParent = bottomRow.parentElement;
    if (cardParent && (pill.parentElement !== cardParent || pill.previousElementSibling !== bottomRow)) {
      bottomRow.after(pill);
    }
  } else {
    // 物理挂载至 leftGroup 末尾，严格处于「左：模型名」与「右：模式/发送按钮」正中间
    if (pill.parentElement !== leftGroup) {
      leftGroup.appendChild(pill);
    }
  }

  if (typeof ResizeObserver !== "undefined" && window.__ag_metrics_ro_target !== bottomRow) {
    if (window.__ag_metrics_ro) { try { window.__ag_metrics_ro.disconnect(); } catch (e) {} }
    window.__ag_metrics_ro_target = bottomRow;
    window.__ag_metrics_ro = new ResizeObserver(() => ensureMetricsPill());
    window.__ag_metrics_ro.observe(bottomRow);
    if (box !== bottomRow) window.__ag_metrics_ro.observe(box);
  }
  return pill;
}

if (!window.__ag_metrics_win_resize) {
  window.__ag_metrics_win_resize = true;
  window.addEventListener("resize", () => ensureMetricsPill());
}

window.__ag_render_metrics = function(payload) {
  try {
    window.__ag_last_metrics = payload;
    const currentId = extractCascadeId();
    const pill = ensureMetricsPill();
    const ttEl = ensureMetricsTooltip();
    if (!pill) return;
    if (!currentId || !payload || !payload.hasData || payload.cascadeId !== currentId) {
      pill.style.display = "none";
      if (ttEl) ttEl.removeAttribute("data-visible");
      return;
    }
    const textEl = pill.querySelector("#ag-live-metrics-text");
    if (textEl && textEl.innerHTML !== payload.inlineHtml) textEl.innerHTML = payload.inlineHtml;
    if (ttEl && ttEl.innerHTML !== payload.tooltipHtml) ttEl.innerHTML = payload.tooltipHtml;
    pill.style.display = "inline-flex";
  } catch (e) {}
};

function checkRouteAndMountMetrics() {
  try {
    const cid = extractCascadeId();
    if (cid !== window.__ag_watched_cascade_id) {
      window.__ag_watched_cascade_id = cid;
      const pill = document.getElementById("ag-live-metrics-pill");
      if (pill && (!window.__ag_last_metrics || window.__ag_last_metrics.cascadeId !== cid)) {
        pill.style.display = "none";
      }
      if (cid && typeof window.__agRequestMetrics === "function") {
        window.__agRequestMetrics(cid); // 触发 CDP Binding 毫秒级拉取
      }
    } else if (cid && window.__ag_last_metrics && window.__ag_last_metrics.cascadeId === cid) {
      ensureMetricsPill();
    }
  } catch (e) {}
}
if (!window.__ag_metrics_route_watcher) {
  window.__ag_metrics_route_watcher = setInterval(checkRouteAndMountMetrics, 400);
}
checkRouteAndMountMetrics();
