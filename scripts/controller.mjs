import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';

const directory = path.dirname(fileURLToPath(import.meta.url));
const assets = path.join(directory, 'assets');
const portFile = path.join(os.homedir(), 'Library/Application Support/Antigravity/DevToolsActivePort');
const config = JSON.parse(fs.readFileSync(path.join(directory, 'config.json'), 'utf8'));
if (!['high-contrast', 'claude-desktop-purewhite', 'vintage-deep'].includes(config.preset) || typeof config.metrics !== 'boolean' || typeof config.gemini1m !== 'boolean') throw new Error('Invalid patch config.json');
const sessions = new Map();
const themeKeys = ['theme-preset-light', 'theme-color-flavor'];
let sequence = 0;
let stopping = false;
let wakeUp;

/** Load only packaged UTF-8 assets; all paths are relative to this installation. */
function readAsset(filename) {return fs.readFileSync(path.join(assets, filename), 'utf8');}

const themeModules = ['preset.js', 'dictionary.js', 'localization.js', 'guards.js'];
if (config.metrics) themeModules.push('metrics-client.js');
const css = readAsset('theme.css') + (config.metrics ? '\n' + readAsset('metrics.css') : '');
const modules = themeModules.map(readAsset).join('\n');
const contextHook = config.gemini1m ? readAsset('gemini-context.js') : 'window.__agGeminiContext?.uninstall?.();';
const revision = crypto.createHash('sha256').update(JSON.stringify(config) + css + modules + contextHook).digest('hex').slice(0, 16);
const injection = `(() => {
  ${contextHook}
  const run = () => {
    if (window.__ag_portable_revision === ${JSON.stringify(revision)} && document.getElementById('ag-custom-fonts')) return;
    Storage.prototype.setItem.call(localStorage,'theme-color-flavor',${JSON.stringify(config.preset)});
    if (!${config.metrics}) {
      clearInterval(window.__ag_metrics_route_watcher); window.__ag_metrics_route_watcher = null;
      window.__ag_metrics_ro?.disconnect();
      document.getElementById('ag-live-metrics-pill')?.remove();
      document.getElementById('ag-live-metrics-tooltip')?.remove();
    }
    const CSS_CONTENT = ${JSON.stringify(css)};
    ${modules}
    window.__ag_portable_revision = ${JSON.stringify(revision)};
  };
  if (document.body) run(); else document.addEventListener('DOMContentLoaded',run,{once:true});
})();`;

/** Accept only the current local application's page and its same-port CDP socket. */
async function findTargets() {
  const port = Number(fs.readFileSync(portFile, 'utf8').split('\n')[0]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid local debugging port');
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, {signal:AbortSignal.timeout(3000)});
  if (!response.ok) throw new Error(`CDP listing returned ${response.status}`);
  return (await response.json()).filter(target => {
    try {
      const page = new URL(target.url), socket = new URL(target.webSocketDebuggerUrl);
      return target.type === 'page' && /(?:^| - )Antigravity$/.test(target.title) && ['http:', 'https:'].includes(page.protocol) && page.hostname === '127.0.0.1' && socket.protocol === 'ws:' && socket.hostname === '127.0.0.1' && Number(socket.port) === port;
    } catch {return false;}
  });
}

/** Send bounded RPCs and report only protocol-level diagnostics, never prompt contents. */
function sendCDP(session, method, params = {}) {
  return new Promise((resolve, reject) => {
    if (session.ws.readyState !== WebSocket.OPEN) return reject(new Error('Client disconnected'));
    const requestId = ++sequence;
    const timer = setTimeout(() => {session.pendingRequests.delete(requestId); reject(new Error(`${method} timeout`));}, 4000);
    session.pendingRequests.set(requestId, {resolve, reject, timer});
    session.ws.send(JSON.stringify({id:requestId, method, params}));
  });
}

/** Evaluate packaged code while turning frontend exceptions into an explicit failed check. */
async function evaluate(session, expression) {
  const result = await sendCDP(session, 'Runtime.evaluate', {expression, returnByValue:true, awaitPromise:true});
  if (result.exceptionDetails) throw new Error('Frontend evaluation failed; inspect the client console.');
  return result.result?.value;
}

const metrics = config.metrics ? new vm.Script(readAsset('metrics-server.js') + '\n;({pushMetricsToSession,syncMetricsForSession})').runInNewContext({fs, os, path, DatabaseSync, sendCDP, activeSockets:sessions, console, Buffer}) : null;

/** Attach once to a target; validate metrics requests before using a database identifier. */
async function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const session = {ws:socket, pendingRequests:new Map(), targetId:target.id};
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const pending = session.pendingRequests.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer); session.pendingRequests.delete(message.id);
      if (message.error) pending.reject(new Error(`CDP ${message.error.code}`)); else pending.resolve(message.result);
    } else if (metrics && message.method === 'Runtime.bindingCalled' && message.params.name === '__agRequestMetrics') {
      const cascadeId = message.params.payload;
      if (/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(cascadeId)) void metrics.pushMetricsToSession(session, cascadeId, true);
    }
  });
  socket.addEventListener('close', () => {
    sessions.delete(target.id);
    for (const pending of session.pendingRequests.values()) {clearTimeout(pending.timer); pending.reject(new Error('Client disconnected'));}
    session.pendingRequests.clear();
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {socket.close(); reject(new Error('Client connection timeout'));}, 4000);
    socket.addEventListener('open', () => {clearTimeout(timeout); resolve();}, {once:true});
    socket.addEventListener('error', () => {clearTimeout(timeout); reject(new Error('Client connection failed'));}, {once:true});
  });
  return session;
}

/** Back up only appearance keys before first runtime write; native settings are separate. */
async function backupAppearance(session) {
  const filename = path.join(directory, 'appearance-backup.json');
  if (fs.existsSync(filename)) return;
  const values = await evaluate(session, `Object.fromEntries(${JSON.stringify(themeKeys)}.map(key=>[key,localStorage.getItem(key)]))`);
  fs.writeFileSync(filename, JSON.stringify(values, null, 2) + '\n', {flag:'wx', mode:0o600});
}

/** Register one future-document script and apply the same revision to the current page. */
async function inject(session, persistent) {
  await backupAppearance(session);
  if (metrics) {
    await sendCDP(session, 'Runtime.enable');
    await sendCDP(session, 'Runtime.addBinding', {name:'__agRequestMetrics'});
    session.bindingOwned = true;
  }
  if (persistent && !session.scriptId) session.scriptId = (await sendCDP(session, 'Page.addScriptToEvaluateOnNewDocument', {source:injection})).identifier;
  await evaluate(session, injection);
  if (metrics) await metrics.syncMetricsForSession(session);
}

/** Remove persistent registrations before disconnecting so graceful restarts do not stack hooks. */
async function disconnect(session) {
  try {
    if (session.scriptId && session.ws.readyState === WebSocket.OPEN) await sendCDP(session, 'Page.removeScriptToEvaluateOnNewDocument', {identifier:session.scriptId});
    if (session.bindingOwned && session.ws.readyState === WebSocket.OPEN) await sendCDP(session, 'Runtime.removeBinding', {name:'__agRequestMetrics'});
  } catch { /* The window may have already closed. */ }
  session.ws.close();
}

/** Poll sequentially; a closed application remains closed until the user opens it. */
async function watch() {
  let lastError = '';
  while (!stopping) {
    try {
      for (const target of await findTargets()) {
        if (stopping) break;
        let session = sessions.get(target.id);
        if (!session) {session = await connect(target); sessions.set(target.id, session); await inject(session, true);}
        const healthy = await evaluate(session, `Boolean(document.getElementById('ag-custom-fonts') && window.__ag_portable_revision === ${JSON.stringify(revision)} && ${config.gemini1m ? 'window.__agGeminiContext' : '!window.__agGeminiContext'})`);
        if (!healthy) await inject(session, true);
        if (metrics) await metrics.syncMetricsForSession(session);
      }
      lastError = '';
    } catch (error) {
      if (lastError !== error.message) console.error(new Date().toISOString(), error.message);
      lastError = error.message;
    }
    if (!stopping) await new Promise(resolve => {const timer = setTimeout(resolve, 2500); wakeUp = () => {clearTimeout(timer); resolve();};});
  }
  await Promise.allSettled([...sessions.values()].map(disconnect));
}

const action = process.argv[2] || 'inspect';
if (action === 'watch') {
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {stopping = true; wakeUp?.();});
  await watch();
} else {
  if (!['inspect', 'apply', 'audit', 'restore'].includes(action)) throw new Error('Commands: watch, inspect, apply, audit, restore');
  const target = (await findTargets())[0];
  if (!target) throw new Error('No running Antigravity window.');
  const session = await connect(target);
  try {
    if (action === 'apply') {await inject(session, false); console.log('Applied current configuration.');}
    else if (action === 'audit') console.log(JSON.stringify(await evaluate(session, readAsset('audit.js')), null, 2));
    else if (action === 'restore') {
      const backup = JSON.parse(fs.readFileSync(path.join(directory, 'appearance-backup.json'), 'utf8'));
      if (Object.keys(backup).some(key => !themeKeys.includes(key))) throw new Error('Unexpected key in appearance backup.');
      await evaluate(session, `window.__agGeminiContext?.uninstall?.(); for(const [key,value] of Object.entries(${JSON.stringify(backup)})){if(value===null)Storage.prototype.removeItem.call(localStorage,key);else Storage.prototype.setItem.call(localStorage,key,value);}`);
      console.log('Web appearance keys restored. Stop the service, then fully quit and reopen Antigravity. Native Appearance settings and fonts are unchanged.');
    } else console.log(JSON.stringify(await evaluate(session, `({revision:window.__ag_portable_revision,preset:document.documentElement.dataset.agPreset,gemini1m:!!window.__agGeminiContext,contextWindowTokens:window.__agGeminiContext?.windowTokens,metricsMounted:!!document.getElementById('ag-live-metrics-pill'),actualContextBudget:window.__ag_last_metrics?.maxContextTokens})`), null, 2));
  } finally {await disconnect(session);}
}
