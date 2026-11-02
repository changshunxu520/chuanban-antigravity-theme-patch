import crypto from 'node:crypto';

export const PRESETS = new Set(['high-contrast', 'claude-desktop-purewhite', 'vintage-deep', 'default-light']);
const FONT_SCHEMES = new Set(['A', 'B', 'C']);
export const HEAL_INTERVAL_MS = 2500;
export const METRICS_INTERVAL_MS = 1200;

/** Fill backwards-compatible defaults and reject conflicting behavior before installation. */
export function normalizeConfig(input = {}) {
  const config = {preset:'high-contrast', fontScheme:'A', metrics:true, gemini1m:false, localize:true, fixes:true, styleOnly:false, ...input};
  if (!PRESETS.has(config.preset) || !FONT_SCHEMES.has(config.fontScheme)) throw new Error('Invalid preset or font scheme.');
  for (const key of ['metrics','gemini1m','localize','fixes','styleOnly']) if (typeof config[key] !== 'boolean') throw new Error(`Invalid boolean: ${key}`);
  if (config.styleOnly && config.gemini1m) throw new Error('--style-only conflicts with --gemini-1m.');
  if (config.styleOnly) Object.assign(config,{metrics:false,localize:false,fixes:false});
  return config;
}

/** Preserve source typography A, adding explicit B/C fallback chains only when selected. */
function typographyCss(scheme) {
  if (scheme === 'A') return '';
  const fonts = scheme === 'B' ? {
    ui:"'Sarasa UI SC', '更纱黑体 UI SC', system-ui, sans-serif",
    prose:"'Sarasa UI Slab SC', '更纱黑体 UI Slab SC', 'Sarasa UI SC', sans-serif",
    code:"'Sarasa Mono Slab SC', '等距更纱黑体 Slab SC', ui-monospace, monospace"
  } : {
    ui:"'Anthropic Sans', 'Styrene B', system-ui, -apple-system, 'PingFang SC', sans-serif",
    prose:"'Anthropic Serif', 'Tiempos Text', Georgia, 'PingFang SC', 'Microsoft YaHei', serif",
    code:"'Anthropic Mono', ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace"
  };
  return `\n:root { --font-sans:${fonts.ui} !important; --font-mono:${fonts.code} !important; --vscode-font-family:${fonts.ui} !important; --vscode-editor-font-family:${fonts.code} !important; --vscode-chat-font-family:${fonts.prose} !important; }\ndiv[contenteditable="true"], textarea, input[type="text"], input[type="search"], [role="textbox"], .ProseMirror { font-family:${scheme === 'C' ? 'var(--font-sans)' : fonts.code} !important; }\n`;
}

/** Scope preset decorations to light mode even when style-only has no theme observer. */
export function buildStyles(config, readAsset) {
  let css = '';
  if (config.preset !== 'default-light') {
    css = readAsset('theme.css').replace(/html(\[data-ag-preset="[^"]+"\]) (?!body(?:[\s.{:#]))/g, 'html$1 body.theme-light ');
    css += typographyCss(config.fontScheme);
  }
  return css + (config.metrics ? '\n' + readAsset('metrics.css') : '');
}

/** Build a reusable injection; style-only deliberately has no storage, listeners, or timers. */
export function buildInjection(config, readAsset) {
  const css = buildStyles(config,readAsset);
  const modules = [];
  if (!config.styleOnly && config.preset !== 'default-light') modules.push(readAsset('preset.js'));
  if (config.localize) modules.push(readAsset('dictionary.js'),readAsset('localization.js'));
  if (config.fixes) modules.push(readAsset('guards.js'));
  if (config.metrics) modules.push(readAsset('metrics-client.js'));
  const contextHook = config.styleOnly ? '' : config.gemini1m ? readAsset('gemini-context.js') : 'window.__agGeminiContext?.uninstall?.();';
  const moduleCode = modules.join('\n');
  const revision = crypto.createHash('sha256').update(JSON.stringify(config)+css+moduleCode+contextHook).digest('hex').slice(0,16);
  if (config.styleOnly) return {revision,css,injection:`(() => {
    if (!document.documentElement) throw new Error('Open the application page before applying styles.');
    let style=document.getElementById('ag-custom-fonts');
    if (!window.__ag_style_only_backup) window.__ag_style_only_backup={preset:document.documentElement.getAttribute('data-ag-preset'),styleExisted:!!style,styleText:style?.textContent||''};
    if (!style) {style=document.createElement('style');style.id='ag-custom-fonts';(document.head||document.documentElement).appendChild(style);}
    if (style.textContent!==${JSON.stringify(css)}) style.textContent=${JSON.stringify(css)};
    ${config.preset === 'default-light' ? "document.documentElement.removeAttribute('data-ag-preset');" : `document.documentElement.setAttribute('data-ag-preset',${JSON.stringify(config.preset)});`}
    window.__ag_portable_revision=${JSON.stringify(revision)};
  })()`};
  const injection = `(() => {
    ${contextHook}
    const run = () => {
      if (window.__ag_portable_revision===${JSON.stringify(revision)} && document.getElementById('ag-custom-fonts')) return;
      window.__ag_theme_observer?.disconnect();
      Storage.prototype.setItem.call(localStorage,'theme-color-flavor',${JSON.stringify(config.preset)});
      if (!${config.localize}) window.__ag_i18n_observer?.disconnect();
      if (!${config.metrics}) {
        clearInterval(window.__ag_metrics_route_watcher);window.__ag_metrics_route_watcher=null;
        window.__ag_metrics_ro?.disconnect();
        document.getElementById('ag-live-metrics-pill')?.remove();document.getElementById('ag-live-metrics-tooltip')?.remove();
      }
      const CSS_CONTENT=${JSON.stringify(css)};
      let baseStyle=document.getElementById('ag-custom-fonts');
      if (!baseStyle) {baseStyle=document.createElement('style');baseStyle.id='ag-custom-fonts';(document.head||document.documentElement).appendChild(baseStyle);}
      if (baseStyle.textContent!==CSS_CONTENT) baseStyle.textContent=CSS_CONTENT;
      ${config.preset === 'default-light' ? "document.documentElement.removeAttribute('data-ag-preset');" : ''}
      ${moduleCode}
      window.__ag_portable_revision=${JSON.stringify(revision)};
    };
    if (document.body) run();else document.addEventListener('DOMContentLoaded',run,{once:true});
  })()`;
  return {revision,css,injection};
}

/** Run two independent cadences in one serialized loop, so slow work never overlaps. */
export async function pollSequentially({heal,metrics,stopped,sleep,now=Date.now}) {
  let nextHeal = 0, nextMetrics = 0;
  while (!stopped()) {
    if (now() >= nextHeal) {await heal();nextHeal=now()+HEAL_INTERVAL_MS;}
    if (stopped()) break;
    if (metrics && now() >= nextMetrics) {await metrics();nextMetrics=now()+METRICS_INTERVAL_MS;}
    if (stopped()) break;
    await sleep(Math.max(0,Math.min(nextHeal,metrics?nextMetrics:Infinity)-now()));
  }
}
