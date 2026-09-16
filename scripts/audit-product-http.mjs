// Observational audit of the unmodified product. CI + disposable local DB only.
// A finding is printed as FINDING, not disguised as a passing security test.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { protectClaimKey } from '../shared/claim-key-crypto.mjs';

const url = new URL(process.env.DATABASE_URL || 'https://invalid');
if (process.env.CI !== 'true' || !['localhost', '127.0.0.1'].includes(url.hostname)
    || url.pathname !== '/tloque_audit') throw new Error('Only the disposable CI database tloque_audit is allowed');
const out = resolve('.tloque_cache/product-audit');
await mkdir(out, { recursive: true });
const clock = resolve(out, 'clock.txt');
await writeFile(clock, '0');
await writeFile(resolve(out, 'clock.mjs'), `import{readFileSync}from'node:fs';const original=Date.now;Date.now=()=>original()+Number(readFileSync(${JSON.stringify(clock)},'utf8'));`);
const secrets = { session: randomBytes(32).toString('hex'), claim: randomBytes(32).toString('hex'), webhook: randomBytes(32).toString('hex') };
process.env.CLAIM_KEY_SECRET = secrets.claim;
const client = new pg.Client({ connectionString: url.href }); await client.connect();
assert.equal(Number((await client.query('select count(*) from users')).rows[0].count), 0, 'The audit requires an empty migrated database');
await client.query(`create table if not exists user_sessions(sid varchar primary key, sess json not null, expire timestamp(6) not null)`);
const people = {}, cookies = {};
for (const role of ['reader', 'author', 'other', 'delegate', 'founder', 'wallet']) {
  const { rows: [user] } = await client.query(`insert into users(google_id,email,name) values($1,$2,$3) returning id,email`, [`audit-${role}`, `${role}@audit.example.test`, `Audit ${role}`]);
  people[role] = user;
  const sid = randomBytes(24).toString('hex');
  const signature = createHmac('sha256', secrets.session).update(sid).digest('base64').replace(/=+$/, '');
  cookies[role] = 'tloque.sid=' + encodeURIComponent(`s:${sid}.${signature}`);
  await client.query(`insert into user_sessions values($1,$2,now()+interval '30 days')`, [sid, JSON.stringify({cookie:{originalMaxAge:2592000000,expires:new Date(Date.now()+2592000000).toISOString(),secure:true,httpOnly:true,path:'/',sameSite:'lax'},passport:{user:user.id}})]);
}
await client.query(`insert into admins(email,added_by) values($1,'audit'),($2,'audit')`, [people.delegate.email, people.founder.email]);
const bookIds = {};
for (const status of ['published', 'draft', 'review']) {
  const { rows: [book] } = await client.query(`insert into books(title,author,author_id,status,content,chapters,premium_cover_url) values($1,'Audit author',$2,$3,'Audit text',$4,'https://example.test/private-art.jpg') returning id`, [`Audit ${status}`, people.author.id, status, JSON.stringify([{title:'One',content:'Audit chapter one.'},{title:'Two',content:'Audit chapter two.'}])]);
  bookIds[status] = book.id;
}
await client.query(`insert into wallet_ledger(user_id,currency,delta,reason,cash_backing_cents) values($1,'tinta',100,'audit',20000)`, [people.author.id]);
const copyKey = 'ABCD-EFGH', protectedKey = protectClaimKey(copyKey);
async function seedCopy(folio) {
  const {rows:[token]}=await client.query(`insert into book_tokens(kind,book_id,owner_user_id) values('sale',$1,$2) returning id`,[bookIds.published,people.author.id]);
  const {rows:[copy]}=await client.query(`insert into print_copies(token_id,folio,claim_key,claim_key_hash) values($1,$2,$3,$4) returning id`,[token.id,folio,protectedKey.ciphertext,protectedKey.digest]);
  return {token:token.id,copy:copy.id,folio};
}
const raceCopy=await seedCopy('TLQ-AUDT-RACE'), refundCopy=await seedCopy('TLQ-AUDT-RFND');
await client.query(`insert into token_orders(user_id,book_id,kind,amount_cents,status,provider,payment_ref,token_id,author_user_id,author_share_bps) values($1,$2,'sale',2000,'paid','stripe','pi_AuditTokenRefund',$3,$1,9000)`, [people.author.id,bookIds.published,refundCopy.token]);
const {rows:[walletOrder]}=await client.query(`insert into wallet_orders(user_id,currency,amount,amount_cents,status,provider,payment_ref) values($1,'tinta',25,4900,'paid','stripe','pi_AuditWalletRefund') returning id`,[people.wallet.id]);
await client.query(`insert into wallet_ledger(user_id,currency,delta,reason,ref_type,ref_id,cash_backing_cents) values($1,'tinta',25,'purchase','wallet_order',$2,4900)`,[people.wallet.id,walletOrder.id]);

const results=[], processes=[];
function record(id, expected, actual, ok, detail='') {
  const row={id,verdict:ok?'PASS':'FINDING',expected,actual,...(detail?{detail}:{})}; results.push(row); console.log(JSON.stringify(row));
}
async function request(path, {role,method='GET',body,instance=0,headers={}}={}) {
  const response=await fetch(`http://127.0.0.1:${5190+instance}${path}`,{method,headers:{Origin:'https://audit.example.test',...(role?{Cookie:cookies[role]}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined,redirect:'manual',signal:AbortSignal.timeout(15000)});
  let data=null;try{data=await response.json()}catch{}
  return {status:response.status,data,headers:Object.fromEntries(response.headers)};
}
async function webhook(event) {
  const body=JSON.stringify(event),t=Math.floor(Date.now()/1000);
  const v1=createHmac('sha256',secrets.webhook).update(`${t}.${body}`).digest('hex');
  return request('/api/payments/webhook',{method:'POST',body:event,headers:{'stripe-signature':`t=${t},v1=${v1}`}});
}
try {
  for(let instance=0;instance<2;instance++) {
    const child=spawn(process.execPath,['--import',resolve(out,'clock.mjs'),'dist/index.cjs'],{env:{PATH:process.env.PATH,NODE_ENV:'production',PORT:String(5190+instance),DATABASE_URL:url.href,APP_URL:'https://audit.example.test',ADMIN_EMAIL:people.founder.email,SESSION_SECRET:secrets.session,CLAIM_KEY_SECRET:secrets.claim,GOOGLE_CLIENT_ID:'audit-client',GOOGLE_CLIENT_SECRET:'audit-not-real',STRIPE_WEBHOOK_SECRET:secrets.webhook},stdio:['ignore','pipe','pipe']});
    let output='';child.stdout.on('data',b=>{output=(output+b.toString()).slice(-4000)});child.stderr.on('data',b=>{output=(output+b.toString()).slice(-4000)});processes.push(child);
    let healthy=false;for(let attempt=0;attempt<150;attempt++){try{healthy=(await request('/healthz',{instance})).status===200}catch{}if(healthy)break;await delay(150)}
    assert.ok(healthy,`Audit server ${instance} failed: ${output}`);
  }
  for(const role of ['reader','author','delegate','founder']) {
    const me=await request('/api/auth/me',{role});assert.equal(me.data?.id,people[role].id,'Fixture must exercise a real Passport session');
  }
  const guards=[
    ['anonymous_wallet','/api/wallet',{},401],
    ['reader_admin','/api/admin/admins',{role:'reader'},403],
    ['author_admin_frames','/api/admin/frames',{role:'author',method:'POST',body:{}},403],
    ['reader_payout_admin','/api/admin/payouts',{role:'reader'},403],
    ['reader_draft',`/api/books/${bookIds.draft}`,{role:'reader'},404],
    ['author_own_draft',`/api/books/${bookIds.draft}`,{role:'author'},200],
    ['reader_edit_other',`/api/books/${bookIds.published}`,{role:'reader',method:'PUT',body:{title:'Unauthorized'}},403],
    ['reader_edit_copy',`/api/author/editions/${raceCopy.copy}`,{role:'reader',method:'PATCH',body:{status:'sold'}},403],
    ['reader_audio_install','/api/admin/audio/sample-pack-catalog',{role:'reader'},403],
    ['reader_get_other_revision',`/api/books/${bookIds.published}/revisions`,{role:'reader'},403],
    ['csrf_cross_origin','/api/sync/streak',{role:'reader',method:'PUT',body:{days:2,lastDate:'2026-09-16'},headers:{Origin:'https://evil.example.test'}},403],
    ['unsigned_webhook','/api/payments/webhook',{method:'POST',body:{type:'checkout.session.completed'}},400],
  ];
  for(const [id,path,options,expected] of guards){const actual=(await request(path,options)).status;record(id,expected,actual,actual===expected)}
  const published=await request(`/api/books/${bookIds.published}`,{role:'reader'});
  record('premium_art_hidden','',published.data?.premiumCoverUrl,published.data?.premiumCoverUrl==='');
  const myTokens=await request(`/api/tokens/mine?bookId=${bookIds.published}`,{role:'reader'});
  record('tokens_owner_scope',0,myTokens.data?.tokens?.length,myTokens.data?.tokens?.length===0);
  const publicCopy=await request(`/api/claim/${raceCopy.folio}`);
  const exposed=Object.keys(publicCopy.data||{}).filter(k=>/key|userId/i.test(k));record('public_qr_secret_redaction',[],exposed,exposed.length===0);
  const incorrect=await request(`/api/claim/${raceCopy.folio}`,{role:'reader',method:'POST',body:{key:'ZZZZ-ZZZZ'}});record('incorrect_claim_key',403,incorrect.status,incorrect.status===403);
  const race=await Promise.all(['reader','other'].map(role=>request(`/api/claim/${raceCopy.folio}`,{role,method:'POST',body:{key:copyKey}})));
  const raceStatus=race.map(r=>r.status).sort();record('claim_concurrency',[200,409],raceStatus,JSON.stringify(raceStatus)==='[200,409]');
  const publicCache=publicCopy.headers['cache-control']||null;record('claim_status_no_store','no-store',publicCache,publicCache?.includes('no-store')===true);

  const replicaBefore=await request('/api/admin/admins',{role:'delegate',instance:1});assert.equal(replicaBefore.status,200);
  const removed=await request('/api/admin/admins/'+encodeURIComponent(people.delegate.email),{role:'founder',method:'DELETE'});assert.equal(removed.status,204);
  await writeFile(clock,String(6*60000));
  const replicaAfter=await request('/api/admin/admins',{role:'delegate',instance:1});
  record('admin_revocation_after_ttl',403,replicaAfter.status,replicaAfter.status===403,'A revokes the admin; B checks after advancing Date.now by six minutes. Product source is unchanged.');
  await writeFile(clock,'0');

  const refund=await webhook({id:'evt_AuditTokenRefund',type:'charge.refunded',created:Math.floor(Date.now()/1000),data:{object:{id:'ch_AuditTokenRefund',payment_intent:'pi_AuditTokenRefund',amount_refunded:2000,currency:'mxn',refunded:true}}});assert.equal(refund.status,200);
  assert.equal((await client.query(`select status from token_orders where payment_ref='pi_AuditTokenRefund'`)).rows[0].status,'refunded');
  const afterRefund=await request(`/api/claim/${refundCopy.folio}`,{role:'reader',method:'POST',body:{key:copyKey}});
  record('unclaimed_copy_after_full_refund','blocked',afterRefund.status,afterRefund.status>=400,'Signed fixture refund was recorded; unclaimed copy must have an explicit refund/revocation policy.');
  const walletRefund=await webhook({id:'evt_AuditWalletRefund',type:'charge.refunded',created:Math.floor(Date.now()/1000),data:{object:{id:'ch_AuditWalletRefund',payment_intent:'pi_AuditWalletRefund',amount_refunded:4900,currency:'mxn',refunded:true}}});assert.equal(walletRefund.status,200);
  const walletAfter=await request('/api/wallet',{role:'wallet'});
  const spendAfter=await request('/api/tokens/acquire',{role:'wallet',method:'POST',body:{bookId:bookIds.published,kind:'sale',payWith:'tinta'}});
  record('wallet_refund_spending','blocked',{balance:walletAfter.data?.tinta,purchaseStatus:spendAfter.status},spendAfter.status>=400,'A fully refunded top-up must not remain available to spend as cash-backed Tinta.');

  const purchase={role:'author',method:'POST',body:{bookId:bookIds.published,kind:'sale',payWith:'tinta'},headers:{'Idempotency-Key':'audit-retry-one-purchase'}};
  const first=await request('/api/tokens/acquire',purchase), retry=await request('/api/tokens/acquire',purchase);
  assert.equal(first.status,201);assert.equal(retry.status,201);
  record('sale_retry_idempotency','same token',{first:first.data?.token?.id,retry:retry.data?.token?.id},first.data?.token?.id===retry.data?.token?.id);
  const stale=await request(`/api/books/${bookIds.published}`,{role:'author',method:'PUT',body:{title:'Audit revised',expectedRevision:1}});assert.equal(stale.status,200);
  const conflict=await request(`/api/books/${bookIds.published}`,{role:'author',method:'PUT',body:{title:'Audit stale',expectedRevision:1}});record('revision_conflict',409,conflict.status,conflict.status===409);
  const implicit=await request(`/api/books/${bookIds.published}`,{role:'author',method:'PUT',body:{title:'Audit without revision'}});record('revision_required','precondition rejected',implicit.status,implicit.status>=400);
} finally {
  await writeFile(resolve(out,'http-results.json'),JSON.stringify({auditedBase:'0e88f6c7f5b8d82f6d46e467ca953557704eb869',results},null,2));
  for(const child of processes)child.kill('SIGTERM');
  await delay(1000);for(const child of processes)if(child.exitCode===null)child.kill('SIGKILL');
  await client.end();
}
