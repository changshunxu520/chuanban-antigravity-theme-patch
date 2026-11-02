import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';
const asset=name=>fs.readFileSync(new URL('../assets/runtime/'+name,import.meta.url),'utf8');

test('preset hot switching, legacy migration, native-style selection and dark isolation',()=>{
 class Storage {
  constructor(){this.values=new Map([['theme-preset-light','absoulutely-chuanban']]);}
  getItem(key){return this.values.get(key)??null;}
  setItem(key,value){this.values.set(key,String(value));}
 }
 const attributes=new Map(),classes=new Set(['theme-light']);let style;
 const root={appendChild:element=>{style=element;},setAttribute:(key,value)=>attributes.set(key,value),removeAttribute:key=>attributes.delete(key)};
 const document={documentElement:root,head:root,body:{classList:{contains:name=>classes.has(name)}},getElementById:()=>style,createElement:()=>({})};
 const window={getComputedStyle:()=>({getPropertyValue:()=> '#FCFCFB'})};
 const localStorage=new Storage();
 vm.runInNewContext(asset('preset.js'),{document,window,localStorage,Storage,CSS_CONTENT:'test css',setTimeout:callback=>callback(),MutationObserver:class{constructor(callback){this.callback=callback;}observe(){}disconnect(){}}});
 assert.equal(Storage.prototype.getItem.call(localStorage,'theme-preset-light'),'Default Light');
 for(const name of ['high-contrast','claude-desktop-purewhite','vintage-deep']){
  localStorage.setItem('theme-color-flavor',name);assert.equal(attributes.get('data-ag-preset'),name);
 }
 localStorage.setItem('theme-color-flavor','default-light');assert.equal(attributes.has('data-ag-preset'),false);
 localStorage.setItem('theme-color-flavor','high-contrast');classes.delete('theme-light');window.__ag_theme_observer.callback();
 assert.equal(attributes.has('data-ag-preset'),false);
 classes.add('theme-light');window.__ag_theme_observer.callback();assert.equal(attributes.get('data-ag-preset'),'high-contrast');
});

test('settings repair keeps router state and zoom only intercepts a supported native bridge',()=>{
 const listeners={},state={__TSR_key:'sample',__TSR_index:4};let replacement;let prevented=0;let zoomed=0;
 const window={location:{href:'https://127.0.0.1/?settingsOpen=true&settingsScreen=General',search:'?settingsOpen=true&settingsScreen=General'},history:{state,replaceState:(saved,title,url)=>{replacement={saved,url};}},addEventListener:(name,callback)=>listeners[name]=callback};
 const document={addEventListener:(name,callback)=>listeners[name]=callback,querySelector:()=>null};
 vm.runInNewContext(asset('guards.js'),{window,document,URL});
 listeners.click({target:{closest:()=>({})}});assert.equal(replacement.saved,state);assert.equal(new URL(replacement.url).search,'');
 const event={metaKey:true,ctrlKey:false,altKey:false,shiftKey:false,key:'-',preventDefault:()=>prevented++,stopPropagation:()=>{}};
 listeners.keydown(event);assert.equal(prevented,0);
 window.electronNative={zoomOut:()=>zoomed++,zoomIn:()=>{},zoomReset:()=>{}};
 listeners.keydown(event);assert.equal(zoomed,1);assert.equal(prevented,1);
});
