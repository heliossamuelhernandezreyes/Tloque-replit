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
import {compileSpeechProject} from '../shared/speech.ts';
import {LEGAL_FIXTURE_ENV,legalFixtureAcceptance} from './fixtures/legal-config.mjs';
const root=resolve(import.meta.dirname,'..');
const url=new URL(process.env.DATABASE_URL);
assert.ok(['localhost','127.0.0.1'].includes(url.hostname)); assert.equal(url.pathname,'/tloque_audit'); assert.equal(process.env.CI,'true');
const client=new pg.Client({connectionString:url.href});await client.connect();
const secret=randomBytes(32).toString('hex'), users={}, cookies={}, observations=[];
const audioDir=await mkdtemp(resolve(tmpdir(),'tloque-audit-audio-'));
await mkdir(root+'/.tloque_cache/audio-regressions',{recursive:true});
await writeFile(audioDir+'/placeholder.mp3','AUDIT_AUDIO_PLACEHOLDER');
await client.query('create table if not exists user_sessions(sid varchar primary key,sess json not null,expire timestamp(6) not null)');
for(const role of ['author','reader','author2','subscriber','admin']) {
  const name=['author','author2'].includes(role)?'Autor Homonimo':'Audit '+role;
  const {rows:[user]}=await client.query('insert into users(google_id,email,name,subscription_plan,subscription_status) values($1,$2,$3,$4,$5) returning *',['audio-regression-'+role,role+'@audio-regression.example.test',name,role==='subscriber'?'audio':'reader',role==='subscriber'?'active':'inactive']);
  users[role]=user;
  const sid=randomBytes(24).toString('hex'),sig=createHmac('sha256',secret).update(sid).digest('base64').replace(/=+$/,'');
  cookies[role]='tloque.sid='+encodeURIComponent('s:'+sid+'.'+sig);
  await client.query("insert into user_sessions values($1,$2,now()+interval '30 days')",[sid,JSON.stringify({cookie:{originalMaxAge:2592000000,expires:new Date(Date.now()+2592000000).toISOString(),secure:true,httpOnly:true,path:'/',sameSite:'lax'},passport:{user:user.id}})]);
}
const server=spawn(process.execPath,['dist/index.cjs'],{cwd:root,env:{...LEGAL_FIXTURE_ENV,PATH:process.env.PATH,PAYMENTS_BETA_MODE:'true',SERVE_STATIC:'true',NODE_ENV:'development',PORT:'5392',DATABASE_URL:url.href,APP_URL:'https://audit.example.test',ADMIN_EMAIL:users.admin.email,SESSION_SECRET:secret,CLAIM_KEY_SECRET:randomBytes(32).toString('hex'),GOOGLE_CLIENT_ID:'audit',GOOGLE_CLIENT_SECRET:'audit-fixture',AUDIOBOOK_STORAGE_DIR:audioDir,AUDIOBOOK_GENERATION_ENABLED:'true',AUDIOBOOK_WORKER_TOKEN:'synthetic-audio-audit-worker-token-fixture'},stdio:['ignore','pipe','pipe']});
let serverLog='';server.stdout.on('data',b=>serverLog+=b);server.stderr.on('data',b=>serverLog+=b);
async function request(path,{role='reader',method='GET',body,headers={}}={}) {
  const response=await fetch('http://127.0.0.1:5392'+path,{method,headers:{Origin:'https://audit.example.test','X-Tloque-Client':'accounts-v1',...(role?{Cookie:cookies[role],'X-Tloque-Account':String(users[role].id)}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000),redirect:'manual'});
  const text=await response.text();let data;try{data=JSON.parse(text)}catch{data=text}return {status:response.status,data};
}
async function probe(id,fn){await client.query('delete from api_rate_limits');try{const result=await fn();observations.push({id,passed:true,...result});console.log('PASS '+id+' '+JSON.stringify(result))}catch(error){observations.push({id,passed:false,error:error.stack});console.error('FAIL '+id,error.stack)}}
let acceptance;
async function book(title,role='author',choices){
  const content='Este es el primer capítulo sintético de la auditoría.';
  const result=await request('/api/books',{role,method:'POST',body:{title,author:users[role].name,authorId:users[role].id,type:'book',status:'published',content,chapters:[{title:'Uno',content},{title:'Dos',content:'Este segundo capítulo tiene un texto distinto para la narración.'}],legalAcceptance:{...acceptance,...(choices?{choices}: {})}}});
  assert.equal(result.status,201,JSON.stringify(result.data));return result.data;
}
try {
  let healthy=false;for(let i=0;i<150;i++){try{healthy=(await request('/healthz',{role:null})).status===200}catch{}if(healthy)break;await delay(100)}assert.ok(healthy,serverLog);
  acceptance=legalFixtureAcceptance((await request('/api/legal/documents')).data);
  await client.query("insert into wallet_ledger(user_id,currency,delta,reason) values($1,'papel',1000,'audit-fixture')",[users.subscriber.id]);
  const work=await book('Audiolibro sintético');
  const chapters=[{title:'Uno',content:'Este es el primer capítulo sintético de la auditoría.'},{title:'Dos',content:'Este segundo capítulo tiene un texto distinto para la narración.'}];
  const {rows:[voice]}=await client.query("insert into voice_profiles(label,provider_voice_id,license,status) values('Fixture','synthetic-never-called','synthetic fixture only','published') returning id");
  for(let index=0;index<chapters.length;index++){
    const content=chapters[index].content,hash=createHash('sha256').update(content).digest('hex');
    const profile=compileSpeechProject({version:1,bookId:work.id,chapterIndex:index,revision:1,contentHash:hash,narratorVoiceProfileId:voice.id,spans:[{id:'narration',paragraphIndex:0,startOffset:0,endOffset:content.length,kind:'narration',speakerId:'narrator'}]},content,hash,new Set([voice.id]));
    await client.query("insert into speech_profiles(book_id,chapter_index,revision,source_project_revision,content_hash,status,character_count,data) values($1,$2,1,1,$3,'approved',$4,$5)",[work.id,index,hash,profile.characterCount,JSON.stringify(profile)]);
  }
  const headers={Authorization:'Bearer synthetic-audio-audit-worker-token-fixture'};
  const generate=(index,key=randomUUID())=>request(`/api/books/${work.id}/audiobook/${index}/request`,{role:'subscriber',method:'POST',body:{requestKey:key}});
  const claim=()=>request('/api/internal/audiobook/jobs/claim',{role:null,method:'POST',headers});
  const balance=async()=>Number((await client.query("select coalesce(sum(delta),0) as n from wallet_ledger where user_id=$1 and currency='papel'",[users.subscriber.id])).rows[0].n);
  const hold=async value=>client.query('update books set rights_hold=$1 where id=$2',[value,work.id]);
  await probe('A08-intent-replay-and-conflict',async()=>{
    const key=randomUUID(),queued=await generate(0,key);assert.equal(queued.status,202,JSON.stringify(queued));
    const before=await balance(),same=await generate(0,key),other=await generate(1,key);
    assert.equal(same.status,202);assert.equal(same.data.jobId,queued.data.jobId);assert.equal(same.data.paperReserved,0);
    assert.equal(other.status,409,JSON.stringify(other));assert.equal(await balance(),before);
    return {equivalentReplay:same.status,otherChapterRejected:other.status,noAdditionalReservation:true};
  });
  await probe('A08-concurrent-identical-requests',async()=>{
    const key=randomUUID(),before=await balance();const responses=await Promise.all([generate(1,key),generate(1,key)]);
    responses.forEach(r=>assert.equal(r.status,202,JSON.stringify(r)));assert.equal(responses[0].data.jobId,responses[1].data.jobId);
    const {rows}=await client.query('select reserved_paper from audiobook_jobs where request_key=$1',[key]);assert.equal(rows.length,1);assert.equal(before-await balance(),rows[0].reserved_paper);
    return {oneJob:true,oneReservation:true};
  });
  await probe('A09-blocked-queued-jobs-never-reach-worker',async()=>{
    await hold(true);assert.equal((await request(`/api/books/${work.id}/audiobook/0`,{role:'subscriber'})).status,404);
    for(let i=0;i<2;i++){const claimed=await claim();assert.equal(claimed.status,409,JSON.stringify(claimed));assert.equal(claimed.data.profile,undefined);}
    assert.equal((await claim()).status,204);assert.equal(await balance(),1000);
    const {rows:[n]}=await client.query("select count(*)::int as n from wallet_ledger where user_id=$1 and reason='refund_ai'",[users.subscriber.id]);assert.equal(n.n,2);
    return {workerRejected:true,noSegments:true,fullReservationsReturned:true,repeatClaimNoExtraRefund:true};
  });
  await probe('A09-revocation-before-completion-refunds-once',async()=>{
    await hold(false);assert.equal((await generate(0)).status,202);
    const claimed=await claim();assert.equal(claimed.status,200,JSON.stringify(claimed));await hold(true);
    const job=claimed.data.job,body={claimToken:job.claimToken,storageKey:'synthetic/result.mp3',mimeType:'audio/mpeg',durationSeconds:1,actualCharacters:job.expectedCharacters};
    const complete=()=>request(`/api/internal/audiobook/jobs/${job.id}/complete`,{role:null,method:'POST',headers,body});
    assert.equal((await complete()).status,409);assert.equal(await balance(),1000);assert.equal((await complete()).status,409);assert.equal(await balance(),1000);
    const {rows:[n]}=await client.query('select count(*)::int as n from audiobook_cache where cache_key=$1',[job.cacheKey]);assert.equal(n.n,0);
    return {completionRejected:true,noCachePublished:true,reservationReturnedOnce:true};
  });
  await probe('A09-revocation-during-heartbeat-refunds',async()=>{
    await hold(false);assert.equal((await generate(0)).status,202);const claimed=await claim();assert.equal(claimed.status,200,JSON.stringify(claimed));await hold(true);
    const job=claimed.data.job,result=await request(`/api/internal/audiobook/jobs/${job.id}/heartbeat`,{role:null,method:'POST',headers,body:{claimToken:job.claimToken}});
    assert.equal(result.status,409);assert.equal(await balance(),1000);return {heartbeatRejected:true,reservationReturned:true};
  });
  await probe('A09-stale-profile-is-rejected',async()=>{
    await hold(false);assert.equal((await generate(0)).status,202);await client.query("update speech_profiles set status='draft' where book_id=$1 and chapter_index=0",[work.id]);
    const result=await claim();assert.equal(result.status,409,JSON.stringify(result));assert.equal(await balance(),1000);
    await client.query("update speech_profiles set status='approved' where book_id=$1 and chapter_index=0",[work.id]);
    return {staleProfileRejected:true,fullRefund:true};
  });
  await probe('CONTROL-valid-generation-completes-and-replays-once',async()=>{
    assert.equal((await generate(0)).status,202);const claimed=await claim();assert.equal(claimed.status,200,JSON.stringify(claimed));
    const job=claimed.data.job,body={claimToken:job.claimToken,storageKey:'synthetic/complete.mp3',mimeType:'audio/mpeg',durationSeconds:1,actualCharacters:job.expectedCharacters};
    const heartbeat=await request(`/api/internal/audiobook/jobs/${job.id}/heartbeat`,{role:null,method:'POST',headers,body:{claimToken:job.claimToken}});assert.equal(heartbeat.status,200,JSON.stringify(heartbeat));
    const complete=()=>request(`/api/internal/audiobook/jobs/${job.id}/complete`,{role:null,method:'POST',headers,body});
    assert.equal((await complete()).status,200);const after=await balance();assert.equal((await complete()).status,200);assert.equal(await balance(),after);
    const {rows:[n]}=await client.query('select count(*)::int as n from audiobook_cache where cache_key=$1',[job.cacheKey]);assert.equal(n.n,1);
    return {authorizedClaim:true,authorizedHeartbeat:true,authorizedCompletion:true,idempotentReplay:true};
  });
} finally {
  server.kill('SIGTERM');await new Promise(resolve=>server.once('close',resolve));
  await writeFile(root+'/.tloque_cache/audio-regressions/server-results.json',JSON.stringify({regressionFor:'audio-audit-20261109',fixture:'HTTP and disposable local PostgreSQL; synthetic voices; no external synthesis or live provider',results:observations},null,2));
  await writeFile(root+'/.tloque_cache/audio-regressions/server.log',serverLog);
  await client.end();await rm(audioDir,{recursive:true,force:true});
}
if(observations.some(x=>!x.passed))process.exitCode=1;
