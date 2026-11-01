import { LEGAL_FIXTURE_ENV, legalFixtureAcceptance } from './fixtures/legal-config.mjs';
// Real compiled servers + Passport + PostgreSQL; only Stripe's HTTPS transport
// is replaced by a deterministic local provider. Never connects to live Stripe.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';

const url = new URL(process.env.DATABASE_URL || 'https://invalid');
if (process.env.CI !== 'true' || !['localhost', '127.0.0.1'].includes(url.hostname)
  || url.pathname !== '/tloque_payments') throw new Error('Disposable tloque_payments CI database required');
const out = resolve('.tloque_cache/payment-boundaries');
await mkdir(out, { recursive: true });
const client = new pg.Client({ connectionString: url.href });
await client.connect();
const secret = randomBytes(32).toString('hex'), claimSecret = randomBytes(32).toString('hex');
const webhookSecret = randomBytes(32).toString('hex');
const workerToken = randomBytes(32).toString('hex');
const processes = [], checks = [], users = {}, cookies = {};
const sessions = new Map(), disputes = new Map();
const transfers = new Map();
let transferStarted = () => {}, transferGate = Promise.resolve();
let providerCalls = 0, dropNextCheckout = false, providerFailure = false;
const fixture = createServer(async (req, res) => {
  try {
    let body = ''; for await (const chunk of req) body += chunk;
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'POST' && req.url === '/v1/checkout/sessions') {
      providerCalls++;
      const key = req.headers['idempotency-key'];
      assert.ok(key);
      let saved = sessions.get(key);
      if (saved) assert.equal(body, saved.body, 'Provider retry body must be byte-identical');
      else {
        saved = { body, id: 'cs_' + sessions.size, url: 'https://checkout.stripe.com/c/pay/fixture' + sessions.size };
        sessions.set(key, saved);
      }
      if (dropNextCheckout) { dropNextCheckout = false; req.socket.destroy(); return; }
      res.end(JSON.stringify({ id: saved.id, url: saved.url }));
    } else if (req.method === 'GET' && req.url.startsWith('/v1/accounts/')) {
      res.end(JSON.stringify({ id: req.url.split('/').at(-1), country: 'MX', default_currency: 'mxn', details_submitted: true, payouts_enabled: true, capabilities: { transfers: 'active' }, requirements: { currently_due: [] } }));
    } else if (req.method === 'POST' && req.url === '/v1/transfers') {
      const key = req.headers['idempotency-key']; assert.ok(key);
      transferStarted(); await transferGate;
      if (!transfers.has(key)) transfers.set(key, { id: 'tr_fixture' + transfers.size, body });
      assert.equal(transfers.get(key).body, body);
      res.end(JSON.stringify({ id: transfers.get(key).id }));
    } else if (req.method === 'GET' && req.url.startsWith('/v1/disputes/')) {
      const dispute = disputes.get(req.url.split('/').at(-1));
      if (providerFailure || !dispute) { res.writeHead(503); res.end('{}'); return; }
      res.end(JSON.stringify(dispute));
    } else if (req.url === '/v1/refunds') {
      res.end(JSON.stringify({ id: 're_fixture' }));
    } else { res.writeHead(404); res.end('{}'); }
  } catch (error) { res.writeHead(500); res.end(JSON.stringify({ error: { message: error.message } })); }
});
fixture.listen(0, '127.0.0.1'); await once(fixture, 'listening');
const fixtureUrl = 'http://127.0.0.1:' + fixture.address().port;
const id = prefix => prefix + randomBytes(8).toString('hex');
const key = () => randomUUID();
let book, tokenAcceptance;

async function check(name, fn) {
  // Each scenario stays under the real route limit. Reset only between isolated
  // scenarios so the fixture need not wait minutes between independent cases.
  await client.query('delete from api_rate_limits');
  await fn(); checks.push(name); console.log('PASS ' + name);
}
async function request(path, { role = 'buyer', instance = 0, method = 'GET', body, headers = {}, raw } = {}) {
  const response = await fetch('http://127.0.0.1:' + (5292 + instance) + path, {
    method, headers: {
      Origin: 'https://payments.example.test', 'X-Tloque-Client': 'accounts-v1',
      ...(role ? { Cookie: cookies[role], 'X-Tloque-Account': String(users[role].id) } : {}),
      ...(body || raw ? { 'Content-Type': 'application/json' } : {}), ...headers,
    }, body: raw || (body ? JSON.stringify(body) : undefined), signal: AbortSignal.timeout(20000), redirect: 'manual',
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data, headers: response.headers };
}
async function webhook(event, instance = 0, expected = 200) {
  const raw = JSON.stringify(event), timestamp = Math.floor(Date.now() / 1000);
  const digest = createHmac('sha256', webhookSecret).update(`${timestamp}.${raw}`).digest('hex');
  const response = await request('/api/payments/webhook', {
    role: null, instance, method: 'POST', raw, headers: { 'Stripe-Signature': `t=${timestamp},v1=${digest}` },
  });
  assert.equal(response.status, expected, JSON.stringify(response.data)); return response;
}
async function buyToken(role = 'buyer', { kind = 'sale', payWith = 'money', purchaseKey = key(), instance = 0 } = {}) {
  const quoted = await request(`/api/tokens/quote?bookId=${book.id}&kind=${kind}&payWith=${payWith}`, { role, instance });
  return request('/api/tokens/acquire', { role, instance, method: 'POST',
    headers: { 'Idempotency-Key': purchaseKey }, body: { bookId: book.id, kind, payWith, acceptance: { ...tokenAcceptance, quoteHash: quoted.data?.hash } } });
}
async function buyWallet(role = 'buyer', purchaseKey = key(), instance = 0, packId = 'gota') {
  return request('/api/wallet/buy', { role, instance, method: 'POST', headers: { 'Idempotency-Key': purchaseKey }, body: { packId } });
}
async function complete(table, orderId, paymentRef = id('pi_'), instance = 0, eventType = 'checkout.session.completed') {
  assert.ok(['wallet_orders', 'token_orders'].includes(table));
  const { rows: [order] } = await client.query('select * from ' + table + ' where id=$1', [orderId]);
  await webhook({ id: id('evt_'), type: eventType, data: { object: {
    id: order.provider_ref, payment_intent: paymentRef, payment_status: 'paid',
    amount_total: order.amount_cents, currency: 'mxn',
    metadata: { [table === 'wallet_orders' ? 'walletOrderId' : 'orderId']: String(orderId) },
  } } }, instance);
  return { ...order, paymentRef };
}
const refund = (paymentRef, amount, objectId = id('ch_'), created = 1700000000) => ({
  id: id('evt_'), type: 'charge.refunded', created,
  data: { object: { id: objectId, payment_intent: paymentRef, amount_refunded: amount, refunded: amount >= 4900, currency: 'mxn' } },
});
async function balance(role) { return (await request('/api/wallet', { role })).data.tinta; }
async function copies(role, tokenId) {
  const response = await request('/api/tokens/mine?bookId=' + book.id, { role });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /no-store/);
  for (const token of response.data.tokens) for (const copy of token.copies) {
    assert.ok(!('claimKey' in copy) && !('claimKeyHash' in copy), 'Listings must never expose activation secrets');
  }
  return response.data.tokens.find(token => token.id === tokenId);
}
async function prepare(copy, role, instance = 0) {
  return request(`/api/print-copies/${copy.id}/prepare`, { role, instance, method: 'POST' });
}
async function paidToken(role, kind = 'sale') {
  if (role === 'supporter' && kind === 'support') {
    // Genuine historical shape: no edition snapshot and the original extra
    // personal digital benefits. Never create these benefits for new orders.
    const paymentRef = id('pi_');
    const { rows: [token] } = await client.query("insert into book_tokens(kind,book_id,owner_user_id) values('support',$1,$2) returning id", [book.id, users[role].id]);
    const { rows: [order] } = await client.query("insert into token_orders(user_id,book_id,kind,amount_cents,cash_backing_cents,status,provider,payment_ref,token_id,paid_at) values($1,$2,'support',2000,2000,'paid','stripe',$3,$4,now()) returning *", [users[role].id, book.id, paymentRef, token.id]);
    for (let i = 0; i < 3; i++) await client.query("insert into print_copies(token_id,folio,claim_key,claimed_by_user_id,claimed_at) values($1,$2,'ABCD-EFGH',$3,$4)", [token.id, ('TLQ-' + id('')).toUpperCase(), i === 0 ? users[role].id : null, i === 0 ? new Date() : null]);
    await client.query("insert into unlocked_books(user_id,book_id,source) values($1,$2,'support') on conflict do nothing", [users[role].id, book.id]);
    const mine = await copies(role, token.id);
    for (const copy of mine.copies) copy.claimKey = (await prepare(copy, role)).data.copy.key;
    return { ...order, paymentRef, tokenId: token.id, token: mine };
  }
  const purchase = await buyToken(role, { kind }); assert.equal(purchase.status, 201, JSON.stringify(purchase.data));
  const order = await complete('token_orders', purchase.data.orderId);
  const { rows: [paid] } = await client.query('select token_id from token_orders where id=$1', [order.id]);
  const token = await copies(role, paid.token_id);
  // Obtain each fixture's QR as an explicit owner print action before later
  // refund/claim scenarios. General copy listings no longer carry secrets.
  for (const copy of token.copies) {
    const prepared = await prepare(copy, role);
    assert.equal(prepared.status, 200, JSON.stringify(prepared.data));
    assert.equal(prepared.data.copy.folio, copy.folio);
    assert.match(prepared.headers.get('cache-control'), /no-store/);
    copy.claimKey = prepared.data.copy.key;
    assert.ok(copy.claimKey);
  }
  return { ...order, tokenId: paid.token_id, token };
}
async function paidWallet(role) {
  const purchase = await buyWallet(role); assert.equal(purchase.status, 201, JSON.stringify(purchase.data));
  return complete('wallet_orders', purchase.data.orderId);
}
async function claim(copy, role = 'reader', instance = 0) {
  return request('/api/claim/' + copy.folio, { role, instance, method: 'POST', body: { key: copy.claimKey } });
}

try {
  assert.equal(Number((await client.query('select count(*) from users')).rows[0].count), 0);
  await client.query('create table if not exists user_sessions(sid varchar primary key, sess json not null, expire timestamp(6) not null)');
  for (const role of ['buyer', 'second', 'refund', 'partial', 'disputed', 'seller', 'supporter', 'reader', 'author', 'finance', 'beta', 'history', 'collector', 'payoutAuthor']) {
    const { rows: [user] } = await client.query('insert into users(google_id,email,name) values($1,$2,$3) returning id,email',
      ['payments-' + role, role + '@payments.example.test', 'Payments ' + role]);
    users[role] = user;
    const sid = randomBytes(24).toString('hex');
    const signature = createHmac('sha256', secret).update(sid).digest('base64').replace(/=+$/, '');
    cookies[role] = 'tloque.sid=' + encodeURIComponent('s:' + sid + '.' + signature);
    await client.query('insert into user_sessions values($1,$2,now()+interval \'30 days\')', [sid, JSON.stringify({
      cookie: { originalMaxAge: 2592000000, expires: new Date(Date.now() + 2592000000).toISOString(),
        secure: true, httpOnly: true, path: '/', sameSite: 'lax' }, passport: { user: user.id },
    })]);
  }
  await client.query('insert into admins(email,added_by,role) values($1,$2,$3)', [users.finance.email, 'fixture', 'finance']);
  ({ rows: [book] } = await client.query(`insert into books(title,author,author_id,status,content,chapters,is_classic)
    values($1,$2,$3,'published',$4,$5,false) returning id`, ['Fixture book', 'Fixture author', users.author.id, 'Text',
    JSON.stringify([{ title: 'One', content: 'One' }, { title: 'Two', content: 'Two' }])]));
  for (let instance = 0; instance < 3; instance++) {
    const child = spawn(process.execPath, ['--import', resolve('scripts/fixtures/stripe-preload.mjs'), 'dist/index.cjs'], {
      env: { ...LEGAL_FIXTURE_ENV, PATH: process.env.PATH, CI: 'true', NODE_ENV: 'production', PORT: String(5292 + instance),
        DATABASE_URL: url.href, APP_URL: 'https://payments.example.test', SESSION_SECRET: secret,
        ADMIN_EMAIL: 'founder@payments.example.test',
        CLAIM_KEY_SECRET: claimSecret, STRIPE_WEBHOOK_SECRET: webhookSecret, STRIPE_SECRET_KEY: 'sk_test_fixture',
        AUDIOBOOK_WORKER_TOKEN: workerToken,
        STRIPE_CONNECT_WEBHOOK_SECRET: 'whsec_fixture', STRIPE_CONNECT_ENABLED: instance < 2 ? 'true' : 'false',
        MONETIZATION_ENABLED: 'true', PAYOUTS_READY: 'true', PAYMENTS_BETA_MODE: 'true',
        GOOGLE_CLIENT_ID: 'fixture', GOOGLE_CLIENT_SECRET: 'fixture', TLOQUE_QA_STRIPE_URL: fixtureUrl },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', data => { output = (output + data).slice(-4000); });
    child.stderr.on('data', data => { output = (output + data).slice(-4000); });
    processes.push(child);
    let healthy = false;
    for (let attempt = 0; attempt < 150; attempt++) {
      try { healthy = (await request('/healthz', { role: null, instance })).status === 200; } catch {}
      if (healthy) break; await delay(150);
    }
    assert.ok(healthy, 'Server did not start: ' + output);
  }

  const legalAcceptance = legalFixtureAcceptance((await request('/api/legal/documents')).data);
  const fixtureBook = (await request('/api/books/' + book.id, { role: 'author' })).data;
  const authorizedBook = await request('/api/books/' + book.id, { role: 'author', method: 'PUT', body: { expectedRevision: fixtureBook.revision, legalAcceptance } });
  assert.equal(authorizedBook.status, 200, JSON.stringify(authorizedBook.data));
  tokenAcceptance = { accepted: true, documentHash: legalAcceptance.documentHash };
  // Explicit author acceptance plus synthetic review; never a production approval.
  const offer = await request(`/api/commercial/agreements/${book.id}`, { role: 'author' });
  assert.equal(offer.status, 200, JSON.stringify(offer.data));
  const agreement = await request(`/api/commercial/agreements/${book.id}/accept`, { role: 'author', method: 'POST', body: { accepted: true, termsHash: offer.data.hash } });
  assert.equal(agreement.status, 201, JSON.stringify(agreement.data));
  await client.query(`insert into commercial_approvals(book_id,acceptance_id,work_hash,actor_id,action,agreement_ref,evidence_ref,commercial_agreement_id)
    select book_id,id,work_hash,$1,'approve','fixture-commercial-agreement','fixture-holder-evidence',$3
    from legal_acceptances where book_id=$2 order by id desc limit 1`, [users.author.id, book.id, agreement.data.id]);
  await check('A commercial token requires active support; personal folios do not mint extra digital access', async () => {
    assert.equal((await buyToken('reader')).status, 428);
    const missing = await request('/api/tokens/acquire', { role: 'reader', method: 'POST', headers: { 'Idempotency-Key': key() }, body: { bookId: book.id, kind: 'support', payWith: 'money' } });
    assert.equal(missing.status, 428);
    const owned = await paidToken('reader', 'support');
    assert.equal(owned.token.copies.length, 3);
    for (const copy of owned.token.copies) {
      assert.equal((await request('/api/claim/' + copy.folio, { role: null })).data.status, 'personal');
      assert.equal((await claim(copy, 'second')).status, 409);
    }
    const mine = await request('/api/tokens/receipts', { role: 'reader' });
    assert.equal(mine.data.find(row => row.id === owned.id).purchaseTerms.documentHash, tokenAcceptance.documentHash);
    assert.ok(!(await request('/api/tokens/receipts', { role: 'second' })).data.some(row => row.id === owned.id));
  });
  for (const role of ['buyer', 'second', 'refund', 'seller', 'beta']) {
    await client.query("insert into book_tokens(kind,book_id,owner_user_id) values('support',$1,$2)", [book.id, users[role].id]);
  }

  await check('Accepted economic quote survives retry and rejects a changed cash basis before debit', async () => {
    await client.query("insert into wallet_ledger(user_id,currency,delta,cash_backing_cents,reason) values($1,'tinta',20,730,'fixture')", [users.author.id]);
    const quoted = await request(`/api/tokens/quote?bookId=${book.id}&kind=sale&payWith=tinta`, { role: 'author' });
    assert.equal(quoted.status, 200, JSON.stringify(quoted.data));
    assert.equal(quoted.data.economics.cashBasisCents, 730);
    assert.equal(quoted.data.economics.authorCents, 657);
    await client.query("insert into wallet_ledger(user_id,currency,delta,cash_backing_cents,reason) values($1,'tinta',1,200,'fixture')", [users.author.id]);
    const stale = await request('/api/tokens/acquire', { role: 'author', method: 'POST', headers: { 'Idempotency-Key': key() }, body: { bookId: book.id, kind: 'sale', payWith: 'tinta', acceptance: { ...tokenAcceptance, quoteHash: quoted.data.hash } } });
    assert.equal(stale.status, 409); assert.equal(stale.data.code, 'ECONOMIC_QUOTE_CHANGED');
    const purchaseKey = key(), paid = await buyToken('author', { payWith: 'tinta', purchaseKey });
    assert.equal(paid.status, 201, JSON.stringify(paid.data));
    assert.equal(paid.data.purchaseTerms.economics.cashBasisCents, 930);
    const again = await buyToken('author', { payWith: 'tinta', purchaseKey, instance: 1 });
    assert.equal(again.data.orderId, paid.data.orderId);
    const { rows: [earning] } = await client.query('select * from author_earnings where order_id=$1', [paid.data.orderId]);
    assert.equal(earning.gross_cents, 930); assert.equal(earning.author_cents, 837);
    const statement = await request('/api/commercial/statement', { role: 'author' });
    assert.equal(statement.data.entries.find(row => row.orderId === paid.data.orderId).economics.agreementHash, offer.data.hash);
    assert.ok(!(await request('/api/commercial/statement', { role: 'buyer' })).data.entries.some(row => row.orderId === paid.data.orderId));
  });

  await check('Concurrent payout approval and rejection cannot release money in flight', async () => {
    const authorId = users.payoutAuthor.id;
    await client.query("insert into author_payout_accounts(user_id,provider_account_id) values($1,'acct_fixturepayout')", [authorId]);
    const { rows: [order] } = await client.query("insert into token_orders(user_id,book_id,kind,amount_cents,status,provider) values($1,$2,'support',1000,'paid','stripe') returning id", [users.collector.id, book.id]);
    const { rows: [payout] } = await client.query("insert into author_payouts(author_user_id,amount_cents) values($1,1000) returning id", [authorId]);
    await client.query("insert into author_earnings(author_user_id,order_id,book_id,gross_cents,author_cents,platform_cents,status,payout_eligible,payout_id) values($1,$2,$3,1000,1000,0,'reserved',true,$4)", [authorId, order.id, book.id, payout.id]);
    const started = new Promise(resolve => { transferStarted = resolve; });
    let release; transferGate = new Promise(resolve => { release = resolve; });
    const approval = request(`/api/admin/payouts/${payout.id}/approve`, { role: 'finance', method: 'POST' });
    try {
      await Promise.race([started, approval.then(result => { throw new Error('Approval ended before provider transfer: ' + JSON.stringify(result)); }), delay(10_000).then(() => { throw new Error('Transfer did not start'); })]);
      const competing = await Promise.all(['reject', 'approve'].map(action => request(`/api/admin/payouts/${payout.id}/${action}`, { role: 'finance', instance: 1, method: 'POST' })));
      assert.ok(competing.every(result => result.status === 409), JSON.stringify(competing));
      assert.equal((await client.query('select status from author_earnings where order_id=$1', [order.id])).rows[0].status, 'reserved');
    } finally { release(); }
    assert.equal((await approval).status, 200);
    assert.equal(transfers.size, 1);
    const { rows: [earning] } = await client.query('select status,payout_id from author_earnings where order_id=$1', [order.id]);
    assert.equal(earning.status, 'paid_out'); assert.equal(earning.payout_id, payout.id);
    const { rows: [old] } = await client.query("insert into author_payouts(author_user_id,amount_cents,status,processed_at,updated_at) values($1,1000,'processing_unknown',now()-interval '25 hours',now()-interval '25 hours') returning id", [authorId]);
    assert.equal((await request(`/api/admin/payouts/${old.id}/approve`, { role: 'finance', method: 'POST' })).status, 409);
    assert.equal((await request(`/api/admin/payouts/${old.id}/reject`, { role: 'finance', method: 'POST' })).status, 409);
    assert.equal(transfers.size, 1);
  });

  await check('Payout availability honours the hold accepted on each order', async () => {
    const terms = { economics: { version: '2026-11-01.1', holdDays: 180, minimumCents: 10000 } };
    const { rows: [order] } = await client.query("insert into token_orders(user_id,book_id,kind,amount_cents,status,provider,purchase_terms) values($1,$2,'sale',1000,'paid','stripe',$3) returning id", [users.collector.id,book.id,JSON.stringify(terms)]);
    await client.query("insert into author_earnings(author_user_id,order_id,book_id,gross_cents,author_cents,platform_cents,status,payout_eligible,created_at) values($1,$2,$3,1000,900,100,'accrued',true,now()-interval '60 days')", [users.payoutAuthor.id,order.id,book.id]);
    const state = await request('/api/payouts/mine', { role: 'payoutAuthor' });
    assert.equal(state.status,200,JSON.stringify(state.data));
    assert.equal(state.data.availableCents,0);assert.equal(state.data.heldCents,900);
  });

  await check('Purchased card art, frame and book survive edits and withdrawal', async () => {
    const created = await request('/api/books', { role: 'author', method: 'POST', body: { title: 'Preserved edition', author: 'Fixture', status: 'published', legalAcceptance, chapters: [{ title: 'Only chapter', content: 'Public edition text' }] } });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const work = created.data;
    const { rows: [frame] } = await client.query("insert into frames(name,pkg) values('Frame fixture',$1) returning id", [JSON.stringify({ label: 'Original frame' })]);
    const card = await request(`/api/books/${work.id}/cards`, { role: 'author', method: 'POST', body: { name: 'Original art', unlock: 'tinta', priceTinta: 5, fx: { layers: { back: 'https://example.test/original.png', mid: '', front: '' }, frameId: frame.id } } });
    assert.equal(card.status, 201, JSON.stringify(card.data));
    await client.query("insert into wallet_ledger(user_id,currency,delta,reason) values($1,'tinta',20,'fixture')", [users.collector.id]);
    const purchase = await request(`/api/cards/${card.data.id}/buy`, { role: 'collector', method: 'POST' });
    assert.equal(purchase.status, 201, JSON.stringify(purchase.data));
    await client.query("update book_cards set name='Later art',fx='{}'::jsonb where id=$1", [card.data.id]);
    await client.query("update frames set pkg='{}'::jsonb where id=$1", [frame.id]);
    assert.equal((await request(`/api/cards/${card.data.id}`, { role: 'author', method: 'DELETE' })).status, 200);
    const collection = await request('/api/cards/collection', { role: 'collector' });
    const acquired = collection.data.groups.flatMap(group => group.cards).find(item => item.id === card.data.id);
    assert.equal(acquired.name, 'Original art'); assert.equal(acquired.frameSnapshot.label, 'Original frame');
    assert.equal(acquired.fx.layers.back, 'https://example.test/original.png');
    await assert.rejects(client.query('delete from book_cards where id=$1', [card.data.id]), error => error.code === '23503');
    const changed = await request(`/api/books/${work.id}`, { role: 'author', method: 'PUT', body: { title: 'Private edit', status: 'draft', expectedRevision: work.revision, chapters: [{ title: 'Private', content: 'DO NOT EXPOSE' }] } });
    assert.equal(changed.status, 200, JSON.stringify(changed.data));
    const preserved = await request(`/api/books/${work.id}`, { role: 'collector' });
    assert.equal(preserved.status, 200); assert.equal(preserved.data.chapters[0].content, 'Public edition text');
    assert.equal((await request(`/api/sync/library/${work.id}`, { role: 'collector', method: 'PUT' })).status, 200);
    const restored = await request('/api/sync/library', { role: 'collector' });
    const bookmark = restored.data.books.find(item => item.id === work.id);
    assert.equal(bookmark.chapters, undefined, 'sync returns bookmarks without silently delivering a manuscript');
    assert.equal(bookmark.offlineAvailable, true);
    const offline = await request(`/api/books/${work.id}/offline`, { role: 'collector' });
    assert.equal(offline.status, 200); assert.equal(offline.data.chapters[0].content, 'Public edition text');
    assert.equal((await request('/api/sync/progress', { role: 'collector', method: 'PUT', body: { bookId: work.id, chapter: 0, maxChapter: 0, completed: true } })).status, 200);
    assert.equal((await request(`/api/books/${work.id}`, { role: 'reader' })).status, 404);
  });

  await check('Denied offline and collectible rights stop new deliveries before any debit', async () => {
    const denied = { ...legalAcceptance, choices: Object.fromEntries(Object.keys(legalAcceptance.choices).map(name => [name, false])) };
    const created = await request('/api/books', { role: 'author', method: 'POST', body: { title: 'Online reading only', author: 'Fixture', status: 'published', legalAcceptance: denied, content: 'Do not download' } });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const work = created.data;
    assert.equal((await request(`/api/books/${work.id}`, { role: 'reader' })).status, 200);
    assert.equal((await request(`/api/books/${work.id}/offline`, { role: 'reader' })).status, 428);
    assert.equal((await request(`/api/books/${work.id}/offline`, { role: 'author' })).status, 200);
    assert.equal((await request(`/api/sync/library/${work.id}`, { role: 'reader', method: 'PUT' })).status, 200);
    const restored = await request('/api/sync/library', { role: 'reader' });
    const bookmark = restored.data.books.find(item => item.id === work.id);
    assert.equal(bookmark.offlineAvailable, false); assert.equal(bookmark.content, undefined);
    const card = await request(`/api/books/${work.id}/cards`, { role: 'author', method: 'POST', body: { name: 'Pending art', unlock: 'tinta', priceTinta: 5, fx: { layers: { back: 'https://example.test/pending.png', mid: '', front: '' } } } });
    assert.equal(card.status, 201, JSON.stringify(card.data));
    const before = await client.query('select count(*)::integer as count from wallet_ledger where user_id=$1', [users.collector.id]);
    const purchase = await request(`/api/cards/${card.data.id}/buy`, { role: 'collector', method: 'POST' });
    assert.equal(purchase.status, 428, JSON.stringify(purchase.data));
    const after = await client.query('select count(*)::integer as count from wallet_ledger where user_id=$1', [users.collector.id]);
    assert.equal(after.rows[0].count, before.rows[0].count);
    const catalog = await request(`/api/books/${work.id}/cards`, { role: 'reader' });
    assert.deepEqual(catalog.data.cards, []);
  });

  await check('Tinta purchase retries across two servers issue one token and one debit', async () => {
    await paidWallet('buyer');
    const purchaseKey = key();
    const replies = await Promise.all(Array.from({ length: 6 }, (_, i) => buyToken('buyer', { payWith: 'tinta', purchaseKey, instance: i % 2 })));
    assert.ok(replies.every(r => r.status === 201), JSON.stringify(replies));
    assert.equal(new Set(replies.map(r => r.data.token.id)).size, 1);
    assert.ok(replies.every(r => r.data.copies[0].claimKey === replies[0].data.copies[0].claimKey));
    assert.equal(await balance('buyer'), 15);
    const mismatch = await buyToken('buyer', { kind: 'support', payWith: 'tinta', purchaseKey });
    assert.equal(mismatch.status, 409);
    assert.equal((await client.query("select count(*) from wallet_ledger where user_id=$1 and reason='spend_token'", [users.buyer.id])).rows[0].count, '1');
    const another = await buyToken('buyer', { payWith: 'tinta' }); assert.equal(another.status, 201);
    assert.notEqual(another.data.token.id, replies[0].data.token.id);
    assert.equal(await balance('buyer'), 5);
  });
  await check('Checkout survives a lost provider response without a second order or new parameters', async () => {
    const purchaseKey = key(), before = sessions.size;
    dropNextCheckout = true;
    const failed = await buyToken('second', { purchaseKey }); assert.equal(failed.status, 503);
    const retried = await buyToken('second', { purchaseKey, instance: 1 }); assert.equal(retried.status, 201, JSON.stringify(retried.data));
    const repeated = await buyToken('second', { purchaseKey });
    assert.deepEqual(repeated.data, retried.data); assert.equal(sessions.size, before + 1);
    await complete('token_orders', retried.data.orderId);
    const paid = await buyToken('second', { purchaseKey }); assert.equal(paid.data.mode, 'paid');
    assert.equal(paid.data.orderId, retried.data.orderId);
    assert.equal((await client.query('select count(*) from token_orders where user_id=$1 and purchase_key=$2', [users.second.id, purchaseKey])).rows[0].count, '1');
    assert.equal((await buyToken('buyer', { purchaseKey })).status, 201, 'Keys are scoped to the account');
  });
  await check('Wallet checkout and beta credit retries reuse one purchase', async () => {
    const purchaseKey = key();
    const first = await buyWallet('second', purchaseKey), repeated = await buyWallet('second', purchaseKey, 1);
    assert.equal(first.status, 201); assert.deepEqual(first.data, repeated.data);
    assert.equal((await buyWallet('second', purchaseKey, 1, 'tintero')).status, 409);
    await complete('wallet_orders', first.data.orderId);
    assert.equal((await buyWallet('second', purchaseKey)).data.mode, 'paid');
    const betaKey = key();
    const beta = await Promise.all([buyWallet('beta', betaKey, 2), buyWallet('beta', betaKey, 2)]);
    assert.ok(beta.every(r => r.status === 201)); assert.equal(await balance('beta'), 25);
    const betaTokenKey = key();
    const tokens = await Promise.all([buyToken('beta', { purchaseKey: betaTokenKey, instance: 2 }), buyToken('beta', { purchaseKey: betaTokenKey, instance: 2 })]);
    assert.equal(tokens[0].data.token.id, tokens[1].data.token.id);
    assert.equal(tokens[0].data.mode, 'free_beta');
  });
  await check('Refunded spent credit becomes debt and cannot fund another token', async () => {
    const order = await paidWallet('refund');
    assert.equal((await buyToken('refund', { payWith: 'tinta' })).status, 201);
    const event = refund(order.paymentRef, 4900);
    await Promise.all([webhook(event), webhook(event, 1)]);
    assert.equal(await balance('refund'), -10);
    assert.equal((await buyToken('refund', { payWith: 'tinta' })).status, 402);
    assert.equal((await client.query("select count(*) from wallet_ledger where ref_type='wallet_order_adjustment' and ref_id=$1", [order.id])).rows[0].count, '1');
    const adjustment = (await client.query("select delta,cash_backing_cents from wallet_ledger where ref_type='wallet_order_adjustment' and ref_id=$1", [order.id])).rows[0];
    assert.deepEqual(adjustment, { delta: -25, cash_backing_cents: -4900 });
    await paidWallet('refund'); assert.equal(await balance('refund'), 15);
  });
  await check('Cumulative partial refunds ignore older equal-timestamp deliveries', async () => {
    const order = await paidWallet('partial'), charge = id('ch_');
    await webhook(refund(order.paymentRef, 2450, charge)); assert.equal(await balance('partial'), 12);
    await webhook(refund(order.paymentRef, 100, charge)); assert.equal(await balance('partial'), 12);
    await webhook(refund(order.paymentRef, 4900, charge)); assert.equal(await balance('partial'), 0);
    await webhook(refund(order.paymentRef, 2450, charge)); assert.equal(await balance('partial'), 0);
  });
  await check('An incident preceding checkout is applied in the same credit transaction', async () => {
    const purchase = await buyWallet('partial'), paymentRef = id('pi_');
    await webhook(refund(paymentRef, 4900));
    await complete('wallet_orders', purchase.data.orderId, paymentRef);
    assert.equal(await balance('partial'), 0);
    assert.equal((await client.query('select status from wallet_orders where id=$1', [purchase.data.orderId])).rows[0].status, 'refunded');
  });
  await check('Disputes use current provider state; restores are exact and do not erase refunds', async () => {
    const order = await paidWallet('disputed'), disputeId = id('du_');
    const current = { id: disputeId, payment_intent: order.paymentRef, amount: 4900, currency: 'mxn', status: 'needs_response', reason: 'fraudulent' };
    disputes.set(disputeId, current);
    const event = { id: id('evt_'), type: 'charge.dispute.created', created: 1700000000, data: { object: { ...current } } };
    providerFailure = true; await webhook(event, 0, 500);
    assert.equal(await balance('disputed'), 0, 'Provider outage must reserve disputed funds');
    providerFailure = false; await webhook(event); assert.equal(await balance('disputed'), 0);
    await webhook(refund(order.paymentRef, 2450)); assert.equal(await balance('disputed'), 0);
    current.status = 'won';
    await webhook({ ...event, id: id('evt_'), type: 'charge.dispute.closed' });
    assert.equal(await balance('disputed'), 12);
    await webhook({ ...event, id: id('evt_') }, 1); // Stale payload, provider still says won.
    assert.equal(await balance('disputed'), 12);
    const { rows: [incident] } = await client.query("select id from payment_incidents where payment_ref=$1 and kind='refund'", [order.paymentRef]);
    assert.equal((await request(`/api/admin/payment-incidents/${incident.id}/resolve`, {
      role: 'finance', method: 'POST', body: { outcome: 'liability_reconciled', note: 'Fixture: liability documented' },
    })).status, 200);
    await webhook({ ...event, id: id('evt_') }); assert.equal(await balance('disputed'), 12);
  });
  await check('Preparing a selected copy requires its owner and never charges or issues another copy', async () => {
    const order = await paidToken('seller'), copy = order.token.copies[0];
    const snapshot = async () => (await client.query(`select
      (select count(*) from print_copies) as copies,
      (select count(*) from book_tokens) as tokens,
      (select count(*) from token_orders) as orders,
      (select count(*) from wallet_ledger) as ledger`)).rows[0];
    const before = await snapshot();
    const replies = await Promise.all([prepare(copy, 'seller'), prepare(copy, 'seller', 1)]);
    for (const response of replies) {
      assert.equal(response.status, 200);
      assert.equal(response.data.copy.key, copy.claimKey);
      assert.equal(response.data.bookId, book.id);
      assert.deepEqual(Object.keys(response.data.copy).sort(), ['digitalClaimAllowed', 'folio', 'key', 'licenseKind']);
      assert.equal(response.data.copy.digitalClaimAllowed, true);
      assert.equal(response.data.book.id, book.id);
      assert.match(response.headers.get('cache-control'), /no-store/);
    }
    for (const [role, status] of [[null, 401], ['buyer', 404]]) {
      const denied = await prepare(copy, role);
      assert.equal(denied.status, status);
      assert.ok(!JSON.stringify(denied.data).includes(copy.claimKey));
      assert.match(denied.headers.get('cache-control'), /no-store/);
    }
    assert.equal((await prepare({ id: 'invalid' }, 'seller')).status, 400);
    assert.equal((await prepare({ id: 2147483648 }, 'seller')).status, 400);
    assert.deepEqual(await snapshot(), before);
  });
  await check('Refund suspends new QR claims and printing without exposing the internal key', async () => {
    const order = await paidToken('seller');
    const copy = order.token.copies[0];
    await webhook(refund(order.paymentRef, order.amount_cents));
    assert.equal((await claim(copy)).status, 409);
    const info = await request('/api/claim/' + copy.folio, { role: null });
    assert.equal(info.data.status, 'unavailable'); assert.match(info.headers.get('cache-control'), /no-store/);
    const token = await copies('seller', order.tokenId);
    assert.equal(token.licenseStatus, 'revoked'); assert.equal(token.copies[0].canPrint, false);
    assert.equal((await prepare(copy, 'seller')).status, 409);
    assert.equal((await request(`/api/author/editions/${copy.id}`, { role: 'seller', method: 'PATCH', body: { status: 'sold' } })).status, 409);
    assert.equal((await client.query('select status,payout_eligible from author_earnings where order_id=$1', [order.id])).rows[0].payout_eligible, false);
  });
  await check('A reader keeps an existing claim while a refunded supporter loses only their own entitlement', async () => {
    const order = await paidToken('supporter', 'support');
    const copy = order.token.copies.find(copy => !copy.digitalClaimed);
    assert.equal((await claim(copy)).status, 200);
    await webhook(refund(order.paymentRef, order.amount_cents));
    const owner = await request('/api/tokens/unlocked', { role: 'supporter' }); assert.ok(!owner.data.bookIds.includes(book.id));
    const reader = await request('/api/tokens/unlocked', { role: 'reader' }); assert.ok(reader.data.bookIds.includes(book.id));
    assert.equal((await claim(copy)).status, 200);
    assert.equal((await request('/api/claim/' + copy.folio, { role: 'reader' })).data.status, 'yours');
    const available = order.token.copies.find(c => !c.digitalClaimed && c.id !== copy.id);
    assert.equal((await claim(available, 'second')).status, 409);
  });
  await check('A concurrent claim and refund serialize, and an earlier reader claim always survives', async () => {
    const order = await paidToken('seller'), copy = order.token.copies[0];
    const [claimed] = await Promise.all([claim(copy, 'second', 1), webhook(refund(order.paymentRef, order.amount_cents))]);
    assert.ok([200, 409].includes(claimed.status));
    const repeat = await claim(copy, 'second'); assert.equal(repeat.status, claimed.status);
    assert.equal((await claim(copy, 'buyer')).status, 409);
  });
  await check('A token incident before delayed checkout cannot produce an activatable licence', async () => {
    const purchase = await buyToken('seller'); assert.equal(purchase.status, 201);
    const paymentRef = id('pi_');
    await webhook(refund(paymentRef, 2000));
    await complete('token_orders', purchase.data.orderId, paymentRef, 1, 'checkout.session.async_payment_succeeded');
    const { rows: [order] } = await client.query('select * from token_orders where id=$1', [purchase.data.orderId]);
    assert.equal(order.status, 'refunded');
    const token = await copies('seller', order.token_id);
    assert.equal(token.licenseStatus, 'revoked'); assert.equal(token.copies[0].canPrint, false);
    assert.equal((await prepare(token.copies[0], 'seller')).status, 409);
    assert.equal((await request('/api/claim/' + token.copies[0].folio, { role: null })).data.status, 'unavailable');
  });
  await check('Winning a token dispute reactivates the same licence and its QR', async () => {
    const order = await paidToken('seller'), copy = order.token.copies[0], disputeId = id('du_');
    const current = { id: disputeId, payment_intent: order.paymentRef, amount: 2000, currency: 'mxn', status: 'needs_response', reason: 'fraudulent' };
    disputes.set(disputeId, current);
    const event = { id: id('evt_'), type: 'charge.dispute.created', data: { object: { ...current } } };
    await webhook(event); assert.equal((await claim(copy)).status, 409);
    assert.equal((await prepare(copy, 'seller')).status, 409);
    current.status = 'won';
    await webhook({ ...event, id: id('evt_'), type: 'charge.dispute.closed' });
    const token = await copies('seller', order.tokenId);
    assert.equal(token.licenseStatus, 'active'); assert.equal(token.copies[0].canPrint, true);
    assert.equal((await prepare(copy, 'seller')).data.copy.key, copy.claimKey);
    assert.equal((await claim(copy)).status, 200);
  });
  await check('Historical reconciliation repairs prior incidents and can be replayed without double adjustment', async () => {
    const order = await paidWallet('history');
    await client.query(`insert into payment_incidents(provider_event_id,provider_object_id,kind,payment_ref,wallet_order_id,
      amount_cents,currency,provider_status,resolution) values($1,$2,'refund',$3,$4,4900,'mxn','refunded','liability_reconciled')`,
      [id('evt_'), id('ch_'), order.paymentRef, order.id]);
    // Simulate old code: status says refunded, but spendable ledger stayed paid.
    await client.query("update wallet_orders set status='refunded' where id=$1", [order.id]);
    const historicalToken = await paidToken('history', 'support');
    await client.query(`insert into payment_incidents(provider_event_id,provider_object_id,kind,payment_ref,token_order_id,
      amount_cents,currency,provider_status,resolution) values($1,$2,'refund',$3,$4,2000,'mxn','refunded','liability_reconciled')`,
      [id('evt_'), id('ch_'), historicalToken.paymentRef, historicalToken.id]);
    await client.query("update token_orders set status='refunded' where id=$1", [historicalToken.id]);
    assert.ok((await request('/api/tokens/unlocked', { role: 'history' })).data.bookIds.includes(book.id));
    const migration = await readFile('migrations/0018_payment_reconciliation.sql', 'utf8');
    for (let run = 0; run < 2; run++) {
      await client.query('begin'); await client.query(migration); await client.query('commit');
      assert.equal(await balance('history'), 0);
      assert.equal((await copies('history', historicalToken.tokenId)).licenseStatus, 'revoked');
      assert.ok(!(await request('/api/tokens/unlocked', { role: 'history' })).data.bookIds.includes(book.id));
    }
    assert.equal((await client.query("select count(*) from wallet_ledger where ref_type='wallet_order_adjustment' and ref_id=$1", [order.id])).rows[0].count, '1');
  });
  await check('AI reservation serializes concurrent requests, replays results and refunds expired work once', async () => {
    const { reserveAiRequest, finishAiRequest, recoverExpiredAiRequests } = await import('../server/aiRequests.ts');
    const userId = users.collector.id;
    await client.query("insert into wallet_ledger(user_id,currency,delta,reason) values($1,'papel',20,'fixture')", [userId]);
    const requestKey = key();
    const results = await Promise.allSettled([1, 2].map(() => reserveAiRequest(userId, requestKey, 'hash-fixture', 8)));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    const reservation = results.find(result => result.status === 'fulfilled').value;
    assert.equal((await client.query("select sum(delta)::int as balance from wallet_ledger where user_id=$1 and currency='papel'", [userId])).rows[0].balance, 12);
    await finishAiRequest(reservation.id, { provider: 'fixture', inputUnits: 1000, outputUnits: 1000, paperCharged: 2, metadata: {} }, { project: { fixture: true }, paperCharged: 2 });
    assert.equal((await reserveAiRequest(userId, requestKey, 'hash-fixture', 8)).result.paperCharged, 2);
    assert.equal((await client.query("select sum(delta)::int as balance from wallet_ledger where user_id=$1 and currency='papel'", [userId])).rows[0].balance, 18);
    const expired = await reserveAiRequest(userId, key(), 'expired-fixture', 8);
    await client.query("update ai_requests set expires_at=now()-interval '1 second' where id=$1", [expired.id]);
    await Promise.all([recoverExpiredAiRequests(), recoverExpiredAiRequests()]);
    assert.equal((await client.query("select sum(delta)::int as balance from wallet_ledger where user_id=$1 and currency='papel'", [userId])).rows[0].balance, 18);
    await assert.rejects(finishAiRequest(expired.id, { provider: 'fixture', inputUnits: 1, outputUnits: 1, paperCharged: 1, metadata: {} }, {}));
  });
  await check('Expired audiobook workers release Papel exactly once; model quota is cumulative', async () => {
    const { recoverExpiredAudiobookJobs } = await import('../server/speech.ts');
    const { reserveVisualUpload, MODEL_ACCOUNT_QUOTA } = await import('../server/visualUploads.ts');
    const userId = users.collector.id, hash = 'a'.repeat(64), claimToken = key();
    const { rows: [job] } = await client.query(`insert into audiobook_jobs(request_key,cache_key,user_id,book_id,chapter_index,speech_profile_revision,content_hash,model_id,status,estimated_paper,reserved_paper,expected_characters,claim_token,lease_expires_at)
      values($1,$2,$3,$4,0,1,$2,'fixture','processing',4,4,4000,$5,now()-interval '1 second') returning id`, [key(), hash, userId, book.id, claimToken]);
    await Promise.all([recoverExpiredAudiobookJobs(), recoverExpiredAudiobookJobs()]);
    assert.equal((await client.query("select count(*) from wallet_ledger where ref_type='audiobook_job' and ref_id=$1 and reason='refund_ai'", [job.id])).rows[0].count, '1');
    assert.equal((await client.query('select status from audiobook_jobs where id=$1', [job.id])).rows[0].status, 'failed');
    const workerHeaders = { Authorization: 'Bearer ' + workerToken };
    assert.equal((await request(`/api/internal/audiobook/jobs/${job.id}/complete`, { role: null, method: 'POST', headers: workerHeaders,
      body: { claimToken, storageKey: 'audiobooks/fixture/late.mp3', mimeType: 'audio/mpeg', durationSeconds: 20, actualCharacters: 4000 } })).status, 409);
    const activeToken = key(), activeHash = 'b'.repeat(64);
    const { rows: [active] } = await client.query(`insert into audiobook_jobs(request_key,cache_key,user_id,book_id,chapter_index,speech_profile_revision,content_hash,model_id,status,estimated_paper,reserved_paper,expected_characters,claim_token,lease_expires_at,started_at)
      values($1,$2,$3,$4,0,1,$2,'fixture','processing',4,4,4000,$5,now()+interval '1 minute',now()) returning id`, [key(), activeHash, userId, book.id, activeToken]);
    const heartbeat = token => request(`/api/internal/audiobook/jobs/${active.id}/heartbeat`, { role: null, method: 'POST', headers: workerHeaders, body: { claimToken: token } });
    assert.equal((await heartbeat(key())).status, 409);
    const extended = await heartbeat(activeToken);
    assert.equal(extended.status, 200, JSON.stringify(extended.data));
    assert.ok(Date.parse(extended.data.leaseExpiresAt) > Date.now() + 240_000);
    await client.query("update audiobook_jobs set lease_expires_at=now()-interval '1 second' where id=$1", [active.id]);
    assert.equal((await heartbeat(activeToken)).status, 409);
    await recoverExpiredAudiobookJobs();
    assert.equal((await client.query("select count(*) from wallet_ledger where ref_type='audiobook_job' and ref_id=$1 and reason='refund_ai'", [active.id])).rows[0].count, '1');
    const bytes = MODEL_ACCOUNT_QUOTA / 10;
    const reservations = await Promise.all(Array.from({ length: 12 }, (_, i) => reserveVisualUpload(userId, String(i).padStart(64, '0'), bytes)));
    assert.equal(reservations.filter(Boolean).length, 10);
    const { rows: [first] } = await client.query('select hash from visual_uploads where user_id=$1 limit 1', [userId]);
    assert.equal(await reserveVisualUpload(userId, first.hash, bytes), true);
    await (await import('../server/db.ts')).pool.end();
  });
  console.log(`Payment gate passed: ${checks.length} scenario groups; ${providerCalls} local provider calls; no live payments.`);
} finally {
  await writeFile(resolve(out, 'results.json'), JSON.stringify({ checks, provider: 'local fixture only', instances: 3 }, null, 2));
  for (const child of processes) child.kill('SIGTERM');
  fixture.closeAllConnections(); fixture.close(); await client.end();
}
