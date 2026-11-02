window.__ag_i18n_dict = I18N_DICT;

function isExcluded(node) {
  if (!node || !node.parentElement) return true;
  return !!node.parentElement.closest(
    'script, style, noscript, .monaco-editor, .xterm, [class*="language-"], [class*="file-title"], [class*="file-path"], [data-path], .select-text, code, pre, kbd, samp, textarea, input, [contenteditable="true"], .prose, .markdown, [class*="chat-message"], [class*="group/file-title"], #ag-live-metrics-pill, #ag-live-metrics-tooltip'
  );
}

function translateTextNode(node) {
  if (isExcluded(node)) return;
  const raw = node.nodeValue;
  if (!raw) return;
  const trimmed = raw.trim();
  if (!trimmed) return;

  // 1. 静态词典精确匹配
  if (I18N_DICT[trimmed]) {
    const replacement = I18N_DICT[trimmed];
    // 不变词条（例如模型名）不写回，避免 MutationObserver 自触发。
    if (replacement === trimmed) return;
    if (/[\u4e00-\u9fa5]/.test(replacement) && /^\s*[a-zA-Z]+\s*$/.test(raw)) {
      node.nodeValue = replacement;
    } else {
      node.nodeValue = raw.replace(trimmed, replacement);
    }
    return;
  }

  // 2. 动态正则匹配（覆盖数量统计、耗时、Token 明细与配额重置倒计时，共 13 条）
  if (/^(\d+)\s+files?\s+changed$/i.test(trimmed)) {
    node.nodeValue = raw.replace(/^(\d+)\s+files?\s+changed$/i, '$1 个文件变更'); return;
  }
  if (/^See all\s*\((\d+)\)$/i.test(trimmed)) {
    node.nodeValue = raw.replace(/^See all\s*\((\d+)\)$/i, '查看全部 ($1)'); return;
  }
  if (/^Show\s+(\d+)\s+breakdowns?$/i.test(trimmed)) {
    node.nodeValue = raw.replace(/^Show\s+(\d+)\s+breakdowns?$/i, '展开明细 ($1 项)'); return;
  }
  if (/^(\d+)\s+tools?$/i.test(trimmed)) {
    node.nodeValue = raw.replace(/^(\d+)\s+tools?$/i, '$1 个工具'); return;
  }
  if (/^(\d+)\s+demoted$/i.test(trimmed)) {
    node.nodeValue = raw.replace(/^(\d+)\s+demoted$/i, '$1 项已降级'); return;
  }
  if (/^(\d+)\s+excluded$/i.test(trimmed)) {
    node.nodeValue = raw.replace(/^(\d+)\s+excluded$/i, '$1 项已排除'); return;
  }
  if (/^(\d+)\s+tools?\s+excluded$/i.test(trimmed)) {
    node.nodeValue = raw.replace(/^(\d+)\s+tools?\s+excluded$/i, '$1 个工具已排除'); return;
  }
  if (/^(\d+)\s+active\s+conversations$/i.test(trimmed)) {
    node.nodeValue = raw.replace(/^(\d+)\s+active\s+conversations$/i, '$1 个进行中的会话'); return;
  }
  if (/^Permanently delete\s+(.*)\s+including\s+(\d+)\s+active\s+conversations\.?$/i.test(trimmed)) {
    node.nodeValue = raw.replace(/^Permanently delete\s+(.*)\s+including\s+(\d+)\s+active\s+conversations\.?$/i, '永久删除 $1 及 $2 个进行中的会话。'); return;
  }
  if (/^Worked for\s+(\d+[smhd])$/i.test(trimmed)) {
    node.nodeValue = raw.replace(/^Worked for\s+(\d+[smhd])$/i, '已工作 $1'); return;
  }
  if (/^Thought for\s+(\d+[smhd])$/i.test(trimmed)) {
    node.nodeValue = raw.replace(/^Thought for\s+(\d+[smhd])$/i, '已思考 $1'); return;
  }
  if (/^You have used (some|all|most) of your (weekly|5-hour|five-hour|daily) limit,?\s*it will fully refresh in (.*)\.?$/i.test(trimmed)) {
    const match = trimmed.match(/^You have used (some|all|most) of your (weekly|5-hour|five-hour|daily) limit,?\s*it will fully refresh in (.*)\.?$/i);
    const degreeMap = { some: '部分', all: '全部', most: '大部分' };
    const typeMap = { weekly: '每周', '5-hour': '5 小时', 'five-hour': '5 小时', daily: '每日' };
    const timeStr = match[3].replace(/\.$/, '')
      .replace(/(\d+)\s*days?/gi, '$1 天').replace(/(\d+)\s*hours?/gi, '$1 小时')
      .replace(/(\d+)\s*minutes?/gi, '$1 分钟').replace(/(\d+)\s*seconds?/gi, '$1 秒')
      .replace(/,\s*/g, ' ').trim();
    node.nodeValue = '您已消耗' + (degreeMap[match[1].toLowerCase()] || match[1]) + (typeMap[match[2].toLowerCase()] || match[2]) + '额度，将在 ' + timeStr + ' 后完全重置。';
    return;
  }
  if (/^You have not used any of your (weekly|5-hour|five-hour|daily) limit\.?$/i.test(trimmed)) {
    const match = trimmed.match(/^You have not used any of your (weekly|5-hour|five-hour|daily) limit\.?$/i);
    const typeMap = { weekly: '每周', '5-hour': '5 小时', 'five-hour': '5 小时', daily: '每日' };
    node.nodeValue = '您尚未消耗任何' + (typeMap[match[1].toLowerCase()] || match[1]) + '额度。';
  }
}

function scanAndTranslate(root = document.body) {
  if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) translateTextNode(walker.currentNode);
  // 同步汉化按钮悬停提示与无障碍标签（如 "+" 按钮的 Add Context）
  const labeledEls = root.querySelectorAll ? root.querySelectorAll('[title], [aria-label]') : [];
  for (let i = 0; i < labeledEls.length; i++) {
    const el = labeledEls[i];
    if (isExcluded({ parentElement: el })) continue;
    const t = el.getAttribute('title');
    if (t && I18N_DICT[t.trim()] && I18N_DICT[t.trim()] !== t) el.setAttribute('title', I18N_DICT[t.trim()]);
    const a = el.getAttribute('aria-label');
    if (a && I18N_DICT[a.trim()] && I18N_DICT[a.trim()] !== a) el.setAttribute('aria-label', I18N_DICT[a.trim()]);
  }
}

scanAndTranslate();
if (window.__ag_i18n_observer) {
  try { window.__ag_i18n_observer.disconnect(); } catch (e) {}
}
let i18nPending = false;
window.__ag_i18n_observer = new MutationObserver(() => {
  if (i18nPending) return;
  i18nPending = true;
  requestAnimationFrame(() => {
    i18nPending = false;
    scanAndTranslate(document.body);
  });
});
if (document.body || document.documentElement) {
  window.__ag_i18n_observer.observe(document.body || document.documentElement, {
    childList: true, subtree: true, characterData: true
  });
}
