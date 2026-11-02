import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {normalizeConfig,buildInjection,pollSequentially} from './options.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const assets = path.join(directory, 'assets');
const portFile = path.join(os.homedir(), 'Library/Application Support/Antigravity/DevToolsActivePort');
const config = normalizeConfig(JSON.parse(fs.readFileSync(path.join(directory, 'config.json'), 'utf8')));
const sessions = new Map();
const themeKeys = ['theme-preset-light', 'theme-color-flavor'];
let sequence = 0;
let stopping = false;
let wakeUp;

/** Load only packaged UTF-8 assets; all paths are relative to this installation. */
function readAsset(filename) {return fs.readFileSync(path.join(assets, filename), 'utf8');}

const {revision,injection} = buildInjection(config,readAsset);

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

/** Coalesce route bindings and periodic refreshes; the next poll observes skipped route changes. */
async function refreshSessionMetrics(session, cascadeId) {
  if (!metrics || session.metricsBusy || stopping) return;
  session.metricsBusy = true;
  try {
    if (cascadeId) await metrics.pushMetricsToSession(session,cascadeId,true);
    else await metrics.syncMetricsForSession(session);
  } finally {session.metricsBusy=false;}
}

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
      if (/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(cascadeId)) void refreshSessionMetrics(session,cascadeId);
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
  if (!config.styleOnly) await backupAppearance(session);
  if (metrics) {
    await sendCDP(session, 'Runtime.enable');
    await sendCDP(session, 'Runtime.addBinding', {name:'__agRequestMetrics'});
    session.bindingOwned = true;
  }
  if (persistent && !session.scriptId) session.scriptId = (await sendCDP(session, 'Page.addScriptToEvaluateOnNewDocument', {source:injection})).identifier;
  await evaluate(session, injection);
  if (metrics) await refreshSessionMetrics(session);
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
  const checkStyles = async () => {
    try {
      for (const target of await findTargets()) {
        if (stopping) break;
        let session = sessions.get(target.id);
        if (!session) {session = await connect(target); sessions.set(target.id, session); await inject(session, true);}
        const healthy = await evaluate(session, `Boolean(document.getElementById('ag-custom-fonts') && window.__ag_portable_revision === ${JSON.stringify(revision)} && ${config.gemini1m ? 'window.__agGeminiContext' : '!window.__agGeminiContext'})`);
        if (!healthy) await inject(session, true);
      }
      lastError = '';
    } catch (error) {
      if (lastError !== error.message) console.error(new Date().toISOString(), error.message);
      lastError = error.message;
    }
  };
  const refreshMetrics = metrics ? async () => {
    for (const session of sessions.values()) {
      if (stopping) break;
      await refreshSessionMetrics(session);
    }
  } : null;
  await pollSequentially({heal:checkStyles,metrics:refreshMetrics,stopped:()=>stopping,sleep:delay=>new Promise(resolve=>{
    const timer=setTimeout(()=>{wakeUp=null;resolve();},delay);
    wakeUp=()=>{clearTimeout(timer);wakeUp=null;resolve();};
  })});
  await Promise.allSettled([...sessions.values()].map(disconnect));
}

const action = process.argv[2] || 'inspect';
if (action === 'watch') {
  if (config.styleOnly) throw new Error('Style-only mode has no watcher. Use apply for a one-time injection.');
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
      if (config.styleOnly) {
        await evaluate(session, `(() => {const backup=window.__ag_style_only_backup;if(!backup)return;const style=document.getElementById('ag-custom-fonts');if(backup.styleExisted&&style)style.textContent=backup.styleText;else style?.remove();if(backup.preset==null)document.documentElement.removeAttribute('data-ag-preset');else document.documentElement.setAttribute('data-ag-preset',backup.preset);delete window.__ag_style_only_backup;delete window.__ag_portable_revision;})()`);
        console.log('One-time styles removed. No storage or native settings were changed.');
      } else {
      const backup = JSON.parse(fs.readFileSync(path.join(directory, 'appearance-backup.json'), 'utf8'));
      if (Object.keys(backup).some(key => !themeKeys.includes(key))) throw new Error('Unexpected key in appearance backup.');
      await evaluate(session, `window.__agGeminiContext?.uninstall?.(); for(const [key,value] of Object.entries(${JSON.stringify(backup)})){if(value===null)Storage.prototype.removeItem.call(localStorage,key);else Storage.prototype.setItem.call(localStorage,key,value);}`);
      console.log('Web appearance keys restored. Stop the service, then fully quit and reopen Antigravity. Native Appearance settings and fonts are unchanged.');
      }
    } else console.log(JSON.stringify(await evaluate(session, `({revision:window.__ag_portable_revision,preset:document.documentElement.dataset.agPreset,gemini1m:!!window.__agGeminiContext,contextWindowTokens:window.__agGeminiContext?.windowTokens,metricsMounted:!!document.getElementById('ag-live-metrics-pill'),actualContextBudget:window.__ag_last_metrics?.maxContextTokens})`), null, 2));
  } finally {await disconnect(session);}
}
