// Audit regression suite. Uses only disposable local PostgreSQL, synthetic identities and
// placeholder audio; no live provider, production account or external payment.
import assert from 'node:assert/strict';
import pg from 'pg';
import {spawn} from 'node:child_process';
import {createHmac,randomBytes,randomUUID,createHash} from 'node:crypto';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {resolve} from 'node:path';
import {LEGAL_FIXTURE_ENV,legalFixtureAcceptance} from './fixtures/legal-config.mjs';
const root=resolve(import.meta.dirname,'..');
const url=new URL(process.env.DATABASE_URL);
assert.ok(['localhost','127.0.0.1'].includes(url.hostname)); assert.equal(url.pathname,'/tloque_audit'); assert.equal(process.env.CI,'true');
const client=new pg.Client({connectionString:url.href});await client.connect();
const secret=randomBytes(32).toString('hex'), users={}, cookies={}, observations=[];
const audioDir=await mkdtemp(resolve(tmpdir(),'tloque-audit-audio-'));
await mkdir(root+'/.tloque_cache/audit-regressions',{recursive:true});
await writeFile(audioDir+'/placeholder.mp3','AUDIT_AUDIO_PLACEHOLDER');
await client.query('create table if not exists user_sessions(sid varchar primary key,sess json not null,expire timestamp(6) not null)');
for(const role of ['author','reader','author2','subscriber','admin']) {
  const name=['author','author2'].includes(role)?'Autor Homonimo':'Audit '+role;
  const {rows:[user]}=await client.query('insert into users(google_id,email,name,subscription_plan,subscription_status) values($1,$2,$3,$4,$5) returning *',['audit-'+role,role+'@audit.example.test',name,role==='subscriber'?'audio':'reader',role==='subscriber'?'active':'inactive']);
  users[role]=user;
  const sid=randomBytes(24).toString('hex'),sig=createHmac('sha256',secret).update(sid).digest('base64').replace(/=+$/,'');
  cookies[role]='tloque.sid='+encodeURIComponent('s:'+sid+'.'+sig);
  await client.query("insert into user_sessions values($1,$2,now()+interval '30 days')",[sid,JSON.stringify({cookie:{originalMaxAge:2592000000,expires:new Date(Date.now()+2592000000).toISOString(),secure:true,httpOnly:true,path:'/',sameSite:'lax'},passport:{user:user.id}})]);
}
const server=spawn(process.execPath,['dist/index.cjs'],{cwd:root,env:{...LEGAL_FIXTURE_ENV,PATH:process.env.PATH,PAYMENTS_BETA_MODE:'true',SERVE_STATIC:'true',NODE_ENV:'development',PORT:'5392',DATABASE_URL:url.href,APP_URL:'https://audit.example.test',ADMIN_EMAIL:users.admin.email,SESSION_SECRET:secret,CLAIM_KEY_SECRET:randomBytes(32).toString('hex'),GOOGLE_CLIENT_ID:'audit',GOOGLE_CLIENT_SECRET:'audit-fixture',AUDIOBOOK_STORAGE_DIR:audioDir},stdio:['ignore','pipe','pipe']});
let serverLog='';server.stdout.on('data',b=>serverLog+=b);server.stderr.on('data',b=>serverLog+=b);
async function request(path,{role='reader',method='GET',body,headers={}}={}) {
  const response=await fetch('http://127.0.0.1:5392'+path,{method,headers:{Origin:'https://audit.example.test','X-Tloque-Client':'accounts-v1',...(role?{Cookie:cookies[role],'X-Tloque-Account':String(users[role].id)}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000),redirect:'manual'});
  const text=await response.text();let data;try{data=JSON.parse(text)}catch{data=text}return {status:response.status,data};
}
async function probe(id,fn){await client.query('delete from api_rate_limits');try{const result=await fn();observations.push({id,passed:true,...result});console.log('PASS '+id+' '+JSON.stringify(result))}catch(error){observations.push({id,passed:false,error:error.stack});console.error('FAIL '+id,error.stack)}}
let acceptance;
async function book(title,role='author',choices){
  const content='Version uno: '+title;
  const result=await request('/api/books',{role,method:'POST',body:{title,author:users[role].name,authorId:users[role].id,type:'book',status:'published',content,chapters:[{title:'Uno',content}],legalAcceptance:{...acceptance,...(choices?{choices}: {})}}});
  assert.equal(result.status,201,JSON.stringify(result.data));return result.data;
}
try {
  let healthy=false;for(let i=0;i<150;i++){try{healthy=(await request('/healthz',{role:null})).status===200}catch{}if(healthy)break;await delay(100)}assert.ok(healthy,serverLog);
  acceptance=legalFixtureAcceptance((await request('/api/legal/documents')).data);
  await client.query('insert into wallet_ledger(user_id,currency,delta,reason,cash_backing_cents,funding) values($1,\'tinta\',100,\'audit-fixture\',20000,$2)',[users.reader.id,JSON.stringify({legacyUnits:0,legacyCents:0,paidUnits:100,paidCents:20000})]);
  async function approve(work) {
    const offer=await request('/api/commercial/agreements/'+work.id,{role:'author'});
    assert.equal(offer.status,200,JSON.stringify(offer));
    const agreement=await request('/api/commercial/agreements/'+work.id+'/accept',{role:'author',method:'POST',body:{accepted:true,termsHash:offer.data.hash}});
    assert.equal(agreement.status,201,JSON.stringify(agreement));
    await client.query(`insert into commercial_approvals(book_id,acceptance_id,work_hash,actor_id,action,agreement_ref,evidence_ref,commercial_agreement_id)
      select book_id,id,work_hash,$1,'approve','fixture-agreement','fixture-evidence',$3 from legal_acceptances where book_id=$2 order by id desc limit 1`,[users.admin.id,work.id,agreement.data.id]);
  }
  async function createCard(work) {
    const result=await request('/api/books/'+work.id+'/cards',{role:'author',method:'POST',body:{name:'Tarjeta de prueba',unlock:'tinta',priceTinta:5,fx:{layers:{back:'https://example.test/art.png'}}}});
    assert.equal(result.status,201,JSON.stringify(result));return result.data;
  }
  await probe('F01-card-commerce-consent',async()=>{
    const work=await book('Permiso solo de coleccionables','author',{...acceptance.choices,monetization:false,permanentDigital:false,offline:false});
    const card=await createCard(work);
    const before=(await client.query('select count(*)::int as n from wallet_ledger')).rows[0].n;
    assert.equal((await request('/api/cards/'+card.id+'/quote')).status,428);
    assert.equal((await request('/api/cards/'+card.id+'/buy',{method:'POST'})).status,428);
    assert.equal((await client.query('select count(*)::int as n from wallet_ledger')).rows[0].n,before);
    assert.equal((await client.query('select count(*)::int as n from user_cards where card_id=$1',[card.id])).rows[0].n,0);
    return {noDebit:true,noUnauthorizedDelivery:true};
  });
  await probe('F02-audio-rights-hold',async()=>{
    const work=await book('Obra retirada por derechos');
    const {rows:[cache]}=await client.query("insert into audiobook_cache(cache_key,book_id,chapter_index,speech_profile_revision,content_hash,model_id,storage_key,mime_type,character_count,status) values($1,$2,0,1,$3,'fixture','placeholder.mp3','audio/mpeg',10,'ready') returning id",[createHash('sha256').update(randomUUID()).digest('hex'),work.id,createHash('sha256').update(work.content).digest('hex')]);
    assert.equal((await request('/api/audiobooks/'+cache.id+'/stream',{role:'subscriber'})).status,200);
    const notice=await request('/api/rights/notices',{method:'POST',body:{bookId:work.id,name:'Titular de prueba',email:'rights@fixture.test',work:'Descripción de una obra de prueba',location:'/book/'+work.id,rightsBasis:'Evidencia sintética para la auditoría de retiro',goodFaith:true}});assert.equal(notice.status,201);
    const {rows:[copyright]}=await client.query('select id from copyright_cases where public_id=$1',[notice.data.folio]);
    const held=await request('/api/admin/rights/cases/'+copyright.id,{role:'admin',method:'PATCH',body:{expectedStatus:'received',action:'removed',note:'Retirada sintética para validar el control de acceso'}});assert.equal(held.status,200,JSON.stringify(held));
    const text=await request('/api/books/'+work.id),availability=await request('/api/books/'+work.id+'/audiobook/0',{role:'subscriber'}),audio=await request('/api/audiobooks/'+cache.id+'/stream',{role:'subscriber'});
    assert.equal(text.status,404);assert.equal(availability.status,404);assert.equal(audio.status,403);
    assert.equal((await request('/api/audiobooks/'+cache.id+'/stream',{role:'author'})).status,403);
    return {bookStatus:text.status,audioAvailabilityStatus:availability.status,directAudioStatus:audio.status,placeholderBytes:audio.data.length};
  });
  await probe('F06-stale-narrative',async()=>{
    const work=await book('Música que queda obsoleta');
    const route='/api/books/'+work.id+'/narrative/0';
    const saved=await request(route,{role:'author',method:'PUT',body:{expectedRevision:0,project:{version:1,directionStyle:'subtle',defaultScoreId:null,regions:[]}}});assert.equal(saved.status,200,JSON.stringify(saved.data));
    assert.equal((await request(route+'/compile',{role:'author',method:'POST'})).status,200);
    assert.equal((await request(route+'/publish',{role:'author',method:'POST'})).status,200);
    const updated=await request('/api/books/'+work.id,{role:'author',method:'PUT',body:{expectedRevision:work.revision,content:'Otra escena\n\nSegundo párrafo\n\nTercero',chapters:[{title:'Nuevo',content:'Otra escena\n\nSegundo párrafo\n\nTercero'}],legalAcceptance:acceptance}});assert.equal(updated.status,200,JSON.stringify(updated.data));
    const author=await request(route,{role:'author'}),reader=await request('/api/books/'+work.id+'/experience/0');
    assert.equal(author.data.stale,true);assert.equal(author.data.paragraphCount,3);assert.equal(reader.data.profile,null);assert.equal(reader.data.musicBrain,null);assert.deepEqual(reader.data.audioLayers,[]);
    return {editorReportsStale:author.data.stale,currentParagraphs:author.data.paragraphCount,deliveredProfile:reader.data.profile,profileStillApproved:reader.status};
  });
  await probe('F07-completed-progress-sync',async()=>{
    const work=await book('Lectura terminada');
    const written=await request('/api/sync/progress',{method:'PUT',body:{bookId:String(work.id),chapter:0,maxChapter:0,completed:true}});assert.equal(written.status,200);
    const {rows:[stored]}=await client.query('select completed from reading_progress where user_id=$1 and book_id=$2',[users.reader.id,String(work.id)]);assert.equal(stored.completed,true);
    const state=await request('/api/sync/state'),entry=state.data.progress.find(item=>item.bookId===String(work.id));assert.ok(entry);assert.equal(entry.completed,true);
    return {storedCompleted:stored.completed,returnedFields:Object.keys(entry),completionReturned:true};
  });
  await probe('F08-author-name-collision',async()=>{
    const second=await book('Libro de otro homónimo','author2');
    const profile=await request('/api/authors/'+encodeURIComponent(users.author.name));
    assert.equal(profile.status,409);assert.equal(profile.data.candidates.length,2);
    const first=await request('/api/authors/id/'+users.author.id),other=await request('/api/authors/id/'+users.author2.id);
    assert.equal(first.status,200);assert.ok(first.data.books.length);
    assert.ok(first.data.books.every(work=>work.authorId===users.author.id));
    assert.ok(other.data.books.every(work=>work.authorId===users.author2.id));
    assert.ok(other.data.books.some(work=>work.id===second.id));
    const name=encodeURIComponent(users.author.name);
    const {rows:classics}=await client.query(
      "insert into books(title,author,status,is_classic,rights_hold) values ('Crónica antigua',$1,'published',true,false),('Otra crónica',$1,'published',true,false),('Crónica retenida',$1,'published',true,true),('Crónica privada',$1,'draft',true,false) returning id,title",
      [users.author.name],
    );
    const classicRoute='/api/authors/classic/'+name;
    const firstClassic=await request(classicRoute+'?limit=1',{role:null});
    assert.equal(firstClassic.status,200);
    assert.equal(firstClassic.data.isClassicProfile,true);
    assert.deepEqual(firstClassic.data.books.map(work=>work.id),[classics[1].id]);
    assert.equal(firstClassic.data.nextCursor,classics[1].id);
    const nextClassic=await request(classicRoute+'/books?limit=1&before='+firstClassic.data.nextCursor,{role:null});
    assert.equal(nextClassic.status,200);
    assert.deepEqual(nextClassic.data.books.map(work=>work.id),[classics[0].id]);
    assert.equal(nextClassic.data.nextCursor,null);
    const found=await request(classicRoute+'/books?q='+encodeURIComponent('crónica antigua'),{role:null});
    assert.deepEqual(found.data.books.map(work=>work.id),[classics[0].id]);
    const hidden=await request(classicRoute+'/books?q='+encodeURIComponent('crónica retenida'),{role:null});
    assert.deepEqual(hidden.data.books,[]);
    const collision=await request('/api/authors/'+name,{role:null});
    assert.equal(collision.status,409);
    assert.equal(collision.data.candidates.length,3);
    assert.ok(collision.data.candidates.some(candidate=>candidate.path.startsWith('/author/classic/') && candidate.exampleTitle===classics[1].title));
    assert.equal((await request('/api/authors/classic/perfil-inexistente',{role:null})).status,404);

    const specialName='Autora 50% / Firma';
    const specialPath=encodeURIComponent(specialName);
    const edit=await request('/api/admin/authors/'+specialPath,{role:'admin',method:'PATCH',body:{bio:'Perfil clásico curado.'}});
    assert.equal(edit.status,200);
    const special=await request('/api/authors/classic/'+specialPath,{role:null});
    assert.equal(special.status,200);
    assert.equal(special.data.name,specialName);
    assert.equal(special.data.bio,'Perfil clásico curado.');
    return {legacyConflict:true,profilesSeparated:true,classicPagination:true,hiddenTitlesExcluded:true,encodedNameEditable:true};
  });
  await probe('F05-paid-wallet-key-replay',async()=>{
    const packs=(await request('/api/wallet/packs')).data,pack=packs.packs[0],key=randomUUID();
    const fingerprint=createHash('sha256').update(JSON.stringify({packId:pack.id})).digest('hex');
    const {rows:[order]}=await client.query("insert into wallet_orders(user_id,currency,amount,amount_cents,status,provider,purchase_key,purchase_fingerprint,checkout_request,paid_at) values($1,'tinta',$2,$3,'paid','stripe',$4,$5,$6,now()) returning id",[users.reader.id,pack.tinta,pack.cents,key,fingerprint,JSON.stringify({walletTerms:{version:packs.commerceVersion,packId:pack.id}})]);
    await client.query("insert into wallet_ledger(user_id,currency,delta,reason,ref_type,ref_id,cash_backing_cents) values($1,'tinta',$2,'purchase','wallet_order',$3,$4)",[users.reader.id,pack.tinta,order.id,pack.cents]);
    const before=(await client.query('select count(*)::int as n from wallet_ledger where user_id=$1',[users.reader.id])).rows[0].n;
    const result=await request('/api/wallet/buy',{method:'POST',headers:{'Idempotency-Key':key},body:{packId:pack.id,acceptance:{accepted:true,documentHash:acceptance.documentHash,commerceVersion:packs.commerceVersion,packCents:pack.cents,packUnits:pack.tinta}}});
    const after=(await client.query('select count(*)::int as n from wallet_ledger where user_id=$1',[users.reader.id])).rows[0].n;
    assert.equal(result.status,201);assert.equal(result.data.mode,'paid');assert.equal(result.data.orderId,order.id);assert.equal(before,after);
    assert.equal(result.data.replayed,true);assert.equal(result.data.credited,0);
    const status=await request('/api/wallet/orders/'+order.id);assert.equal(status.status,200);assert.equal(status.data.status,'paid');
    assert.equal((await request('/api/wallet/orders/'+order.id,{role:'author2'})).status,404);
    assert.equal((await request('/api/wallet/orders/lookup',{headers:{'Idempotency-Key':key}})).data.id,order.id);
    const next=await request('/api/wallet/buy',{method:'POST',headers:{'Idempotency-Key':randomUUID()},body:{packId:pack.id,acceptance:{accepted:true,documentHash:acceptance.documentHash,commerceVersion:packs.commerceVersion,packCents:pack.cents,packUnits:pack.tinta}}});
    assert.equal(next.status,201,JSON.stringify(next));assert.notEqual(next.data.orderId,order.id);assert.equal(next.data.credited,pack.tinta);
    return {replayCreditsZero:true,ownershipChecked:true,newIntentionCreatesNewOrder:true};
  });
  await probe('F04-card-edition-frozen-and-consent-quote',async()=>{
    const work=await book('Edición conservada de carta');
    const card=await createCard(work);
    assert.equal((await request('/api/cards/'+card.id+'/quote')).status,428,'an agreement and its review are required');
    await approve(work);
    const quote=await request('/api/cards/'+card.id+'/quote');assert.equal(quote.status,200,JSON.stringify(quote));
    assert.equal((await request('/api/cards/'+card.id+'/buy',{method:'POST'})).status,428,'buyer acceptance is required');
    await client.query("update book_cards set name='Carta revisada' where id=$1",[card.id]);
    const stale=await request('/api/cards/'+card.id+'/buy',{method:'POST',body:{acceptance:{accepted:true,documentHash:acceptance.documentHash,quoteHash:quote.data.hash}}});
    assert.equal(stale.status,409);
    const fresh=await request('/api/cards/'+card.id+'/quote');
    const body={acceptance:{accepted:true,documentHash:acceptance.documentHash,quoteHash:fresh.data.hash}};
    const purchases=await Promise.all([request('/api/cards/'+card.id+'/buy',{method:'POST',body}),request('/api/cards/'+card.id+'/buy',{method:'POST',body})]);
    assert.ok(purchases.every(item=>item.status===201),JSON.stringify(purchases));
    const {rows:[acquired]}=await client.query('select * from user_cards where user_id=$1 and card_id=$2',[users.reader.id,card.id]);assert.ok(acquired.edition_id);
    const {rows:[order]}=await client.query("select * from token_orders where kind='card' and book_id=$1",[work.id]);
    assert.equal(order.purchase_terms.editionId,acquired.edition_id);assert.equal(order.purchase_terms.economics.authorShareBps,5000);
    assert.equal((await client.query('select count(*)::int as n from token_orders where book_id=$1',[work.id])).rows[0].n,1);
    await assert.rejects(client.query('update user_cards set edition_id=null where id=$1',[acquired.id]),/immutable/);
    const changed=await request('/api/books/'+work.id,{role:'author',method:'PUT',body:{expectedRevision:work.revision,content:'Texto posterior a la compra',chapters:[{title:'Nuevo',content:'Texto posterior a la compra'}],legalAcceptance:{...acceptance,choices:{...acceptance.choices,monetization:false,permanentDigital:false,offline:false}}}});
    assert.equal(changed.status,200,JSON.stringify(changed));
    assert.equal((await request('/api/books/'+work.id)).data.content,work.content);
    assert.equal((await request('/api/books/'+work.id+'/offline')).data.content,work.content);
    return {editionFrozen:true,buyerConsentChecked:true,staleQuoteRejected:true,concurrentDebits:1};
  });
  await probe('F09-card-studio-private-works',async()=>{
    const {rows:[draft]}=await client.query("insert into books(title,author,author_id,status) values('Borrador no visible',$1,$2,'draft') returning id",[users.author.name,users.author.id]);
    await client.query("insert into books(title,author,author_id,status,content) select 'Libro reciente '||n,$1,$2,'published','fixture' from generate_series(1,51) n",[users.author2.name,users.author2.id]);
    const publicList=await request('/api/books'),mine=await request('/api/books/mine',{role:'author'});
    assert.equal(publicList.data.length,50);assert.equal(publicList.data.some(work=>work.authorId===users.author.id),false);assert.ok(mine.data.some(work=>work.id===draft.id));
    return {studioSource:'/api/books/mine',catalogReturned:publicList.data.length,ownWorksInCatalog:0,ownWorksInMine:mine.data.length,draftInMine:true};
  });
  await probe('F10-account-rate-limit',async()=>{
    const r=await Promise.all(Array.from({length:300},(_,i)=>request('/api/legal/documents',{role:i%2?'reader':'author2'})));
    assert.equal(r.filter(item=>item.status===200).length,300);
    const next=await request('/api/legal/documents',{role:'subscriber'});assert.equal(next.status,200);
    await client.query('delete from api_rate_limits');
    const own=await Promise.all(Array.from({length:300},()=>request('/api/legal/documents')));assert.ok(own.every(item=>item.status===200));
    // PostgreSQL uses fixed minute buckets. A burst can straddle the boundary;
    // at most one additional bucket may be consumed during this short probe.
    let limited=false;
    for(let attempt=0;attempt<=300;attempt++){
      const response=await request('/api/legal/documents');
      if(response.status===429){limited=true;break}
      assert.equal(response.status,200);
    }
    assert.ok(limited,'the same account must reach its quota even when the minute rolls over');
    assert.equal((await request('/api/legal/documents',{role:'author2'})).status,200);
    return {successfulRequestsAcrossTwoAccounts:300,thirdAccountNextStatus:next.status};
  });
  await probe('F11-gutenberg-premium-projection',async()=>{
    const {rows:[work]}=await client.query("insert into books(title,author,status,is_classic,gutenberg_id,content,premium_cover_url,premium_back_url) values('Clásico de prueba','Autor clásico','published',true,999999,'Texto de prueba','https://example.test/premium-front.png','https://example.test/premium-back.png') returning id");
    const normal=await request('/api/books/'+work.id,{role:null}),preview=await request('/api/gutenberg/preview/999999',{role:null});
    assert.equal(normal.status,200);assert.equal(normal.data.premiumCoverUrl,'');assert.equal(normal.data.premiumBackUrl,'');
    assert.equal(preview.status,200);assert.equal(preview.data.premiumCoverUrl,'');assert.equal(preview.data.premiumBackUrl,'');
    return {normalPremiumUrl:normal.data.premiumCoverUrl,publicPreviewPremiumUrl:preview.data.premiumCoverUrl,previewStatus:preview.status};
  });
  await probe('F12-cloud-draft-stale-check-race',async()=>{
    const work=await book('Carrera de borrador');
    const blocker=new pg.Client({connectionString:url.href});await blocker.connect();await blocker.query('begin');await blocker.query('select pg_advisory_xact_lock(84673,$1)',[work.id]);
    try {
      const pending=request('/api/books/'+work.id+'/draft',{role:'author',method:'PUT',body:{baseRevision:work.revision,expectedDraftRevision:0,data:{title:'Borrador basado en revisión antigua'}}});
      let blocked=false;for(let i=0;i<80;i++){const {rows:[row]}=await client.query("select count(*)::int as n from pg_stat_activity where wait_event='advisory' and pid<>pg_backend_pid()");if(row.n){blocked=true;break}await delay(25)}assert.ok(blocked);
      // Simulate a revision arriving from an older deployment while the new
      // draft writer is waiting; validation must happen after acquiring its lock.
      await client.query('update books set revision=revision+1 where id=$1',[work.id]);
      await blocker.query('commit');const stale=await pending;assert.equal(stale.status,409,JSON.stringify(stale));
      const cloud=await request('/api/books/'+work.id+'/draft',{role:'author'});assert.equal(cloud.data.draft,null);
      const current=(await request('/api/books/'+work.id,{role:'author'})).data;
      const draft=await request('/api/books/'+work.id+'/draft',{role:'author',method:'PUT',body:{baseRevision:current.revision,expectedDraftRevision:0,data:{title:'No perder este borrador'}}});assert.equal(draft.status,200);
      const updated=await request('/api/books/'+work.id,{role:'author',method:'PUT',body:{expectedRevision:current.revision,title:work.title+' editada',legalAcceptance:acceptance}});assert.equal(updated.status,200,JSON.stringify(updated));
      assert.equal((await request('/api/books/'+work.id+'/draft',{role:'author'})).data.draft.data.title,'No perder este borrador');
      const conflict=await request('/api/books/'+work.id+'/draft',{role:'author',method:'DELETE',body:{expectedDraftRevision:0}});assert.equal(conflict.status,409);
      return {staleSaveRejected:true,unacknowledgedDraftRetained:true,staleDeleteRejected:true};
    } finally {await blocker.query('rollback').catch(()=>{});await blocker.end();}
  });
} finally {
  const postgres=(await client.query('select version()')).rows[0].version;
  await writeFile(root+'/.tloque_cache/audit-regressions/results.json',JSON.stringify({postgres,observations},null,2));
  await writeFile(root+'/.tloque_cache/audit-regressions/server.log',serverLog);
  server.kill('SIGTERM');await new Promise(resolve=>server.once('close',resolve));await client.end();await rm(audioDir,{recursive:true,force:true});
}
if(observations.some(result=>!result.passed))process.exitCode=1;
