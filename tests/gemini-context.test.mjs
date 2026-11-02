import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../assets/runtime/gemini-context.js',import.meta.url),'utf8');
const calls=[];
class Socket {
  constructor(url){this.url=url;}
  send(data){calls.push(data);}
}
const location=new URL('https://127.0.0.1:55555/');
const originalFetch=async(input,options)=>{const request=new Request(input,options);calls.push(request.headers.get('content-type').includes('+json')?new Uint8Array(await request.arrayBuffer()):await request.json());return new Response('{}');};
const window={fetch:originalFetch};
const context=vm.createContext({window,WebSocket:Socket,Request,Response,URL,location,TextEncoder,TextDecoder});
vm.runInContext(source,context);
const endpoint=location.origin+'/exa.language_server_pb.LanguageServerService/SendUserCascadeMessage';
const payload=(model)=>({cascadeId:'test',items:[{text:'private text'}],cascadeConfig:{plannerConfig:{planModel:model,toolConfig:{forceDisableToolCalling:true}},checkpointConfig:{tokenThreshold:50000}}});
for(const model of [1417,1418,1419,'MODEL_PLACEHOLDER_M418']){
 const original=payload(model);
 await window.fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(original)});
 const actual=calls.pop();
 assert.equal(actual.cascadeConfig.checkpointConfig.maxTokenLimit,1048576);
 delete actual.cascadeConfig.checkpointConfig.maxTokenLimit;
 assert.deepEqual(actual,original);
}
const unrelated=payload(1401);
await window.fetch(new Request(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(unrelated)}));
assert.deepEqual(calls.pop(),unrelated);
const explicit=payload(1418);explicit.cascadeConfig.checkpointConfig.contextWindow='Custom';
await window.fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(explicit)});
assert.deepEqual(calls.pop(),explicit);
const socket=new Socket('wss://127.0.0.1:55555/connect-websocket');
socket.send(JSON.stringify({type:'start',procedure:new URL(endpoint).pathname,payload:payload(1418)}));
assert.equal(JSON.parse(calls.pop()).payload.cascadeConfig.checkpointConfig.maxTokenLimit,1048576);
const external=new Socket('wss://example.com/connect-websocket');
const externalFrame=JSON.stringify({type:'start',procedure:new URL(endpoint).pathname,payload:payload(1418)});
external.send(externalFrame);assert.equal(calls.pop(),externalFrame);
const encoded=new TextEncoder().encode(JSON.stringify(payload(1418)));
const framed=new Uint8Array(5+encoded.length);new DataView(framed.buffer).setUint32(1,encoded.length);framed.set(encoded,5);
await window.fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/connect+json'},body:framed});
const rewritten=calls.pop();assert.equal(new DataView(rewritten.buffer).getUint32(1),rewritten.length-5);
assert.equal(JSON.parse(new TextDecoder().decode(rewritten.subarray(5))).cascadeConfig.checkpointConfig.maxTokenLimit,1048576);
await window.fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/grpc-web+json'},body:framed});
assert.equal(JSON.parse(new TextDecoder().decode(calls.pop().subarray(5))).cascadeConfig.checkpointConfig.maxTokenLimit,1048576);
const wrapper=window.fetch;vm.runInContext(source,context);assert.equal(window.fetch,wrapper);
assert.equal(JSON.stringify(window.__agGeminiContext).includes('private text'),false);
window.__agGeminiContext.uninstall();assert.equal(window.fetch,originalFetch);
console.log('PASS: Gemini variants, HTTP/Request/WebSocket, unrelated model, external origin, explicit choice, idempotence, rollback, prompt privacy');
