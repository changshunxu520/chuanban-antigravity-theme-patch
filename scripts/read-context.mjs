import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';

const conversationId=process.argv[2];
if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(conversationId||'')) {
  console.error('Usage: node scripts/read-context.mjs <conversation-uuid>');
  process.exit(2);
}
const modulePath=fileURLToPath(new URL('../assets/runtime/metrics-server.js',import.meta.url));
// Keep database access in the shared read-only decoder; expose no prompt or credential data.
const readMetrics=new vm.Script(fs.readFileSync(modulePath,'utf8')+';readConversationMetrics').runInNewContext({fs,os,path,DatabaseSync});
const result=readMetrics(conversationId);
if(!result?.hasData){console.log(JSON.stringify({hasData:false,reason:'No readable generation metrics'}));process.exitCode=1;}
else console.log(JSON.stringify({hasData:true,modelId:result.modelId,generationIndex:result.generationIndex,contextTokens:result.contextTokens,maxContextTokens:result.maxContextTokens,estimatedContextTokens:result.estimatedContextTokens,contextLimitSource:result.contextLimitSource},null,2));
