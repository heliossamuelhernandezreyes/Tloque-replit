import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {useBook} from '../../../client/src/hooks/use-books.ts';
import {saveOfflineContent,OfflinePermissionError} from '../../../client/src/lib/offline.ts';

let online=true,authorized=false,result;
const requests=[];
const source={id:777,title:'Edición en línea',revision:1,content:'TEXTO_ONLINE',chapters:[{title:'Uno',content:'TEXTO_ONLINE'}]};
globalThis.auditFetch=async path=>{
  requests.push(path);
  if (!online) throw new Error('Offline fixture');
  if (path.endsWith('/offline')) return authorized
    ? Response.json({...source,content:'EDICION_AUTORIZADA',chapters:[{content:'EDICION_AUTORIZADA'}]})
    : Response.json({message:'Permiso offline requerido'},{status:428});
  return Response.json(source);
};
function Harness(){result=useBook(777);return null;}
async function readFresh(){
  const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
  let view;
  await act(async()=>{view=TestRenderer.create(React.createElement(QueryClientProvider,{client},React.createElement(Harness)));await new Promise(resolve=>setTimeout(resolve,60));});
  const value=result;
  await act(async()=>view.unmount());client.clear();
  return value;
}
assert.equal((await readFresh()).data.content,'TEXTO_ONLINE');
const store=globalThis.auditStores.get('books');
assert.equal(store.get('book_777').content,undefined);
assert.equal(store.get('book_777').chapters,undefined);
assert.equal(requests.some(path=>path.endsWith('/offline')),false);
online=false;
const offline=await readFresh();assert.equal(offline.isError,true);assert.equal(offline.data,undefined);
store.set('book_777',source);
const legacy=await readFresh();assert.equal(legacy.isError,true);assert.equal(store.get('book_777').content,undefined);
online=true;
await assert.rejects(saveOfflineContent(777,source),OfflinePermissionError);
assert.equal(globalThis.auditStores.get('offline_content').size,0);
authorized=true;
await saveOfflineContent(777,source);
online=false;
const explicit=await readFresh();assert.equal(explicit.isError,false);assert.equal(explicit.data.content,'EDICION_AUTORIZADA');
assert.equal(explicit.data.hasOfflineContent,true);
