import test from "node:test"
import assert from "node:assert/strict"
import { build } from "esbuild"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { mkdir } from "node:fs/promises"
import { resolve } from "node:path"
import { randomUUID } from "node:crypto"
import { readerFixtures } from "./fixtures/audit-client/reader-fixtures.mjs"
import { reconcileWalletIntent, walletIntentKey } from "../client/src/lib/wallet-purchase"
import { pruneBookQueryCache } from "../client/src/lib/book-cache"

async function runFixture(name: string, fixtures: Record<string,string>, controls = false) {
  const output=resolve(".tloque_cache/audit-client/"+name+"-"+randomUUID()+".mjs")
  await mkdir(resolve(".tloque_cache/audit-client"),{recursive:true})
  await build({entryPoints:[resolve("tests/fixtures/audit-client/"+name+".mjs")],outfile:output,
    bundle:true,jsx:"automatic",platform:"node",format:"esm",packages:"external",logLevel:"silent",
    plugins:[{name:"isolated-transport-storage-and-controls",setup(builder){
      builder.onResolve({filter:/.*/},args=>args.path === "react" ? {path:args.path,external:true} : Object.hasOwn(fixtures,args.path)||(controls&&args.path.startsWith("@/components/"))
        ? {path:args.path,namespace:"fixture"}:undefined)
      builder.onLoad({filter:/.*/,namespace:"fixture"},args=>({loader:"js",contents:fixtures[args.path]||"export default ()=>null;"}))
    }}]})
  await promisify(execFile)(process.execPath,[output],{timeout:20_000})
}

test("ordinary book queries persist metadata; only explicit authorized downloads work offline",async()=>{
  await runFixture("offline",{
    "@/lib/account-store":`export const createAccountStore=name=>{const stores=globalThis.auditStores??=new Map();if(!stores.has(name))stores.set(name,new Map());const map=stores.get(name);return {getItem:async k=>map.get(k)||null,setItem:async(k,v)=>{map.set(k,v);return v},removeItem:async k=>map.delete(k)}}`,
    "@/lib/account-context":`export class AccountChangedError extends Error{};export const accountFetch=(...args)=>globalThis.auditFetch(...args);export const accountContext={requireId:()=>"7",assertCurrent(){}};export const accountStorage={getItem:()=>null,setItem(){}};`,
  })
})

test("reader navigation never displays another book or transfers its maximum progress",async()=>{
  await runFixture("reader",readerFixtures,true)
})

test("terminal recharge clears only its own intent; pending, unknown and newer intents survive",()=>{
  const key=walletIntentKey("version-1","gota"),values=new Map([[key,"first-key"]])
  const storage={getItem:(key:string)=>values.get(key)??null,removeItem:(key:string)=>values.delete(key)}
  const order={id:1,status:"pending",units:10,packId:"gota",commerceVersion:"version-1",purchaseKey:"first-key"}
  assert.equal(reconcileWalletIntent(storage,order),false)
  assert.equal(values.get(key),"first-key")
  assert.equal(reconcileWalletIntent(storage,{...order,status:"paid",purchaseKey:"older-key"}),false)
  assert.equal(reconcileWalletIntent(storage,{...order,status:"paid"}),true)
  values.set(key,"second-key")
  assert.equal(reconcileWalletIntent(storage,{...order,status:"paid"}),false)
  assert.equal(values.get(key),"second-key")
  assert.equal(reconcileWalletIntent(storage,{...order,status:"expired",purchaseKey:"second-key"}),true)
})

test("cache upgrade removes unopened manuscripts while preserving metadata and other records",async()=>{
  const entries:any={book_1:{id:1,title:"Uno",content:"Texto",chapters:[{content:"Texto"}]},books_list:[{id:2,title:"Dos",content:"Otro"}],unrelated:{content:"Keep"}}
  await pruneBookQueryCache({entries:async()=>entries,setItem:async(key,value)=>{entries[key]=value}})
  assert.equal(entries.book_1.title,"Uno");assert.equal(entries.book_1.content,undefined)
  assert.equal(entries.book_1.chapters,undefined);assert.equal(entries.books_list[0].content,undefined)
  assert.equal(entries.unrelated.content,"Keep")
})
