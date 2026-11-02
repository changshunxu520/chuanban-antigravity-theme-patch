import fs from 'node:fs';
import crypto from 'node:crypto';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';

const readAsset=name=>fs.readFileSync(new URL('../assets/runtime/'+name,import.meta.url),'utf8');

test('the complete v4 dictionary is retained, rather than a selected subset',()=>{
 const source=readAsset('dictionary.js');
 assert.equal(crypto.createHash('sha256').update(source.trim()).digest('hex'),'2c27f90d111568de8838c77f55c761c65352550fab1c3ef562ec87719b86a9f5');
 const dictionary=vm.runInNewContext(source+';I18N_DICT');
 assert.equal(Object.keys(dictionary).length,341);
});

test('all thirteen upstream dynamic localization cases still execute',()=>{
 const document={body:null,documentElement:null};
 const window={};
 const globals={document,window,MutationObserver:class{disconnect(){} observe(){}}};
 const translate=vm.runInNewContext(readAsset('dictionary.js')+'\n'+readAsset('localization.js')+';translateTextNode',globals);
 const cases=[
  ['3 files changed','3 个文件变更'],['See all (4)','查看全部 (4)'],['Show 2 breakdowns','展开明细 (2 项)'],
  ['2 tools','2 个工具'],['3 demoted','3 项已降级'],['4 excluded','4 项已排除'],['5 tools excluded','5 个工具已排除'],
  ['2 active conversations','2 个进行中的会话'],['Permanently delete Sample including 2 active conversations.','永久删除 Sample 及 2 个进行中的会话。'],
  ['Worked for 2m','已工作 2m'],['Thought for 4s','已思考 4s'],
  ['You have used most of your weekly limit, it will fully refresh in 2 hours.','您已消耗大部分每周额度，将在 2 小时 后完全重置。'],
  ['You have not used any of your daily limit.','您尚未消耗任何每日额度。']
 ];
 for(const [input,expected] of cases){const node={nodeValue:input,parentElement:{closest:()=>null}};translate(node);assert.equal(node.nodeValue,expected,input);}
});

test('the v4 responsive capsule and floating two-section tooltip code is retained',()=>{
 assert.equal(crypto.createHash('sha256').update(readAsset('metrics-client.js').trim()).digest('hex'),'9acfd87b35fd1113418af838b97a16033aa8959c75ccf013702c39b9cb435f81');
 const css=readAsset('metrics.css');
 assert.match(css,/translateY\(4px\)/);assert.match(css,/0\.12s ease/);
 assert.match(css,/0 8px 24px rgba\(0, 0, 0, 0\.16\), 0 2px 6px/);
 assert.match(css,/position: fixed/);
});

test('all v4 palette and ink values are preserved',()=>{
 const css=readAsset('theme.css');
 for(const value of ['#FCFCFB','#F7F5F0','#F9F7F2','#0A0A0A','#FBFBF9','#EDECE9','#F3F2EF','#F0F0EE','#FBF9F5','#2C2B29','#D97757','#F1E8DC','#E6DCCE','#E0D4C3','font-weight: 450','font-weight: 520','font-weight: 500','-0.012em','0.2px','0.15px','line-height: 1.62'])assert.ok(css.includes(value),value);
});

test('composer border ink does not become the new-chat environment-row fill',()=>{
 const css=readAsset('theme.css');
 const rule=css.match(/html\[data-ag-preset="high-contrast"\] \[id="antigravity\.agentSidePanelInputBox"\] \{([^}]+)\}/);
 assert.ok(rule,'composer shell rule exists');
 assert.match(rule[1],/background-color: var\(--card\)/);
 assert.match(rule[1],/box-shadow: inset 0 0 0 1px var\(--card-border\)/);
 assert.doesNotMatch(rule[1],/background-color: var\(--card-border\)/);
});
