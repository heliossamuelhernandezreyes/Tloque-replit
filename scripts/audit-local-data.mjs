// Executes the actual sync module in Node with a disposable storage/network adapter.
// Reproduces account B opening a device still containing account A's local records.
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const output=resolve('.tloque_cache/product-audit');await mkdir(output,{recursive:true});
const bundle=await build({entryPoints:['client/src/lib/sync.ts'],bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'disposable-indexeddb',setup(b){b.onResolve({filter:/^localforage$/},()=>({path:'localforage',namespace:'audit'}));b.onLoad({filter:/.*/,namespace:'audit'},()=>({contents:'export default {createInstance(){const m=new Map();return{async getItem(k){return m.get(k)??null},async setItem(k,v){m.set(k,v);return v},async removeItem(k){m.delete(k)}}}}',loader:'js'}));}}]});
await writeFile(resolve(output,'sync-test.mjs'),bundle.outputFiles[0].text);
const values=new Map([
 ['novareads_streak',JSON.stringify({days:12,lastDate:'2026-09-16'})],
 ['reading_chapter_71','2'],['reading_maxchapter_71','4'],
 ['novareads_saved',JSON.stringify([{id:71,title:'Account A private reading choice'}])],
 ['tloque_library_ops_v1',JSON.stringify([{bookId:71,action:'save',createdAt:1}])],
 ['novareads_drafts',JSON.stringify([{id:'local-a-draft',title:'Account A unpublished draft',content:'Fixture confidential manuscript'}])],
]);
globalThis.localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k),key:i=>[...values.keys()][i]??null,get length(){return values.size}};
globalThis.window={dispatchEvent(){}};
const writes=[];
globalThis.fetch=async(path,options={})=>{
 if(options.method&&options.method!=='GET')writes.push({path,method:options.method,body:options.body?JSON.parse(options.body):null,recipient:'current authenticated account B'});
 const body=path==='/api/sync/state'?{streak:null,progress:[]}:path==='/api/tokens/unlocked'?{bookIds:[]}:path==='/api/sync/library'?{books:[]}:{};
 return new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});
};
const {pullAndMerge}=await import(pathToFileURL(resolve(output,'sync-test.mjs')).href);
await pullAndMerge();
const result={id:'cross_account_local_sync',verdict:writes.length?'FINDING':'PASS',expected:'No account A data uploaded to account B',actual:writes,localDraftRemains:localStorage.getItem('novareads_drafts')!==null,note:'Adapters isolate storage and network; sync logic is bundled from the audited source. Logout source leaves these keys intact.'};
assert.ok(writes.some(w=>w.path==='/api/sync/progress'),'Reproduction did not reach the relevant code');
await writeFile(resolve(output,'local-data-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
