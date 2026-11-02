// Agent 初次汉化或升级巡检时通过 CDP Runtime.evaluate 执行的「全量未挂载界面词条扫描器」
(async () => {
  const scripts = [...document.querySelectorAll('script[src]')].map(s => s.src);
  const mainScript = scripts.find(s => /\/assets\/index-.*\.js/.test(s)) || scripts.find(s => /\/main\.js(?:\?|$)/.test(s)) || scripts.find(Boolean);
  const code = await fetch(mainScript).then(r => r.text());

  // 1. 扫描全部系统设置子页面的 label 与 description 配置表（兼容 Vite/esbuild 单双引号）
  const settingsItems = [...code.matchAll(/label:\s*(["'])((?:(?!\1)[^\\]|\\.)*)\1\s*,\s*description:\s*(["'])((?:(?!\3)[^\\]|\\.)*)\3/g)]
    .map(m => ({ label: m[2], description: m[4] }));

  // 2. 扫描全部 JSX 静态 UI 文本节点（含未挂载的 Radix 菜单、弹窗标题、告警横幅）
  const jsxTexts = [...new Set(
    [...code.matchAll(/children:\s*(["'])([A-Z][^"{}\n\\]{1,180})\1/g)].map(m => m[2].trim())
  )];

  // 3. 扫描全部图标按钮的 aria-label 与 title 悬停提示
  const ariaLabels = [...new Set(
    [...code.matchAll(/(?:aria-label|title)["']?\s*:\s*(["'])([A-Z][^"'\n]{1,80})\1/g)].map(m => m[2].trim())
  )];

  // 若已注入 window.__ag_i18n_dict，可直接过滤出尚未收录的新增英文词条
  const dict = window.__ag_i18n_dict || {};
  return {
    untranslatedSettings: settingsItems.filter(x => !dict[x.label] || !dict[x.description]),
    untranslatedJsxSample: jsxTexts.filter(t => !dict[t]).slice(0, 200),
    untranslatedAria: ariaLabels.filter(a => !dict[a])
  };
})();
