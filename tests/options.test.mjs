import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import {normalizeConfig,buildStyles,buildInjection,pollSequentially} from '../scripts/options.mjs';

const readAsset = name => fs.readFileSync(new URL('../assets/runtime/'+name,import.meta.url),'utf8');

test('old configs gain A typography and independent enabled translation/fixes',()=>{
  const config=normalizeConfig({preset:'high-contrast',metrics:true,gemini1m:false});
  assert.equal(config.fontScheme,'A');assert.equal(config.localize,true);assert.equal(config.fixes,true);
  assert.throws(()=>normalizeConfig({fontScheme:'D'}),/Invalid/);
  assert.throws(()=>normalizeConfig({styleOnly:true,gemini1m:true}),/conflicts/);
});

test('B and C implement distinct body/code/input font chains while A retains original',()=>{
  const original=buildStyles(normalizeConfig({}),readAsset);
  const sarasa=buildStyles(normalizeConfig({fontScheme:'B'}),readAsset);
  const native=buildStyles(normalizeConfig({fontScheme:'C'}),readAsset);
  assert.match(original,/Anthropic Serif/);
  assert.match(sarasa,/--vscode-chat-font-family:'Sarasa UI Slab SC'/);
  assert.match(sarasa,/\[role="textbox"\].*font-family:'Sarasa Mono Slab SC'/);
  assert.match(native,/--vscode-chat-font-family:'Anthropic Serif'.*'PingFang SC'.*'Microsoft YaHei'/);
  assert.match(native,/\[role="textbox"\].*font-family:var\(--font-sans\)/);
  assert.match(original,/html\[data-ag-preset="high-contrast"\] body\.theme-light \.bg-border/);
});

test('default-light suppresses theme and fonts while retaining optional metrics',()=>{
  const styles=buildStyles(normalizeConfig({preset:'default-light'}),readAsset);
  assert.doesNotMatch(styles,/@font-face|--background:|--font-sans:/);
  assert.match(styles,/#ag-live-metrics-pill/);
  assert.equal(buildStyles(normalizeConfig({preset:'default-light',metrics:false}),readAsset),'');
});

test('style-only injection is idempotent and has no storage/observer/listener/service machinery',()=>{
  const config=normalizeConfig({styleOnly:true,fontScheme:'B'});
  const {injection}=buildInjection(config,readAsset);
  assert.doesNotMatch(injection,/Storage|localStorage|MutationObserver|ResizeObserver|addEventListener|setInterval|__agGeminiContext|I18N_DICT/);
  const nodes=new Map();const attributes=new Map();let appends=0;
  const root={getAttribute:name=>attributes.get(name)??null,setAttribute:(name,value)=>attributes.set(name,value),removeAttribute:name=>attributes.delete(name),appendChild:style=>{appends++;nodes.set(style.id,style);}};
  const context=vm.createContext({window:{},document:{documentElement:root,head:root,getElementById:id=>nodes.get(id),createElement:()=>({textContent:''})}});
  vm.runInContext(injection,context);vm.runInContext(injection,context);
  assert.equal(appends,1);assert.equal(attributes.get('data-ag-preset'),'high-contrast');
  assert.match(nodes.get('ag-custom-fonts').textContent,/Sarasa UI Slab SC/);
});

test('disabled translation and fixes do not enter the fresh-page injection',()=>{
  const {injection}=buildInjection(normalizeConfig({localize:false,fixes:false,metrics:false}),readAsset);
  assert.doesNotMatch(injection,/const I18N_DICT|function translateTextNode|__ag_settings_guard_installed|__ag_zoom_guard_installed/);
  new vm.Script(injection);
  for (const preset of ['high-contrast','claude-desktop-purewhite','vintage-deep','default-light']) new vm.Script(buildInjection(normalizeConfig({preset}),readAsset).injection);
});

test('metrics refresh at 1200ms independently of 2500ms healing without overlap',async()=>{
  let now=0;let active=0;let maximumActive=0;const calls=[];
  const work=name=>async()=>{active++;maximumActive=Math.max(maximumActive,active);calls.push([name,now]);await Promise.resolve();active--;};
  await pollSequentially({heal:work('heal'),metrics:work('metrics'),stopped:()=>now>=5000,now:()=>now,sleep:async delay=>{now+=delay;}});
  assert.deepEqual(calls.filter(([name])=>name==='metrics').map(([,time])=>time),[0,1200,2400,3600,4800]);
  assert.deepEqual(calls.filter(([name])=>name==='heal').map(([,time])=>time),[0,2500]);
  assert.equal(maximumActive,1);
});

test('poll loop stops without scheduling another wait when shutdown occurs in work',async()=>{
  let stopped=false;let metricsCalls=0;let sleeps=0;
  await pollSequentially({heal:async()=>{stopped=true;},metrics:async()=>{metricsCalls++;},stopped:()=>stopped,sleep:async()=>{sleeps++;}});
  assert.equal(metricsCalls,0);assert.equal(sleeps,0);
});
