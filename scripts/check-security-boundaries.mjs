// Integration gate against a disposable local PostgreSQL database only.
// Real Passport sessions and two unmodified compiled application processes;
// synthetic users, no OAuth/Stripe calls or production credentials.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';

const url = new URL(process.env.DATABASE_URL || 'https://invalid');
if (process.env.CI !== 'true' || !['localhost', '127.0.0.1'].includes(url.hostname)
    || url.pathname !== '/tloque_security') {
  throw new Error('Only the disposable CI database tloque_security is allowed');
}
const out = resolve('.tloque_cache/security-boundaries');
await mkdir(out, { recursive: true });
const secret = randomBytes(32).toString('hex');
const client = new pg.Client({ connectionString: url.href });
await client.connect();
const processes = [], checks = [], users = {}, cookies = {};

async function check(name, operation) {
  await operation();
  checks.push(name);
  console.log('PASS ' + name);
}
async function request(path, { role, instance = 0, method = 'GET', body, headers = {}, bind = true } = {}) {
  const response = await fetch('http://127.0.0.1:' + (5192 + instance) + path, {
    method,
    headers: {
      Origin: 'https://security.example.test',
      'X-Tloque-Client': 'accounts-v1',
      ...(role ? { Cookie: cookies[role] } : {}),
      ...(role && bind && path !== '/api/auth/me' ? { 'X-Tloque-Account': String(users[role].id) } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
    redirect: 'manual',
  });
  let data = null;
  try { data = await response.json(); } catch {}
  return { status: response.status, data, headers: response.headers };
}

try {
  assert.equal(Number((await client.query('select count(*) from users')).rows[0].count), 0,
    'An empty migrated database is required');
  await client.query('create table if not exists user_sessions(sid varchar primary key, sess json not null, expire timestamp(6) not null)');
  for (const role of ['reader', 'author', 'other', 'catalog', 'visual', 'audio', 'finance', 'access', 'delegate', 'founder']) {
    const { rows: [user] } = await client.query(
      'insert into users(google_id,email,name) values($1,$2,$3) returning id,email',
      ['security-' + role, role + '@security.example.test', 'Security ' + role]);
    users[role] = user;
    const sid = randomBytes(24).toString('hex');
    const signature = createHmac('sha256', secret).update(sid).digest('base64').replace(/=+$/, '');
    cookies[role] = 'tloque.sid=' + encodeURIComponent('s:' + sid + '.' + signature);
    await client.query('insert into user_sessions values($1,$2,now()+interval \'30 days\')', [
      sid, JSON.stringify({
        cookie: { originalMaxAge: 2592000000, expires: new Date(Date.now() + 2592000000).toISOString(),
          secure: true, httpOnly: true, path: '/', sameSite: 'lax' },
        passport: { user: user.id },
      }),
    ]);
    if (['catalog', 'visual', 'audio', 'finance', 'access', 'delegate'].includes(role)) {
      await client.query('insert into admins(email,added_by,role) values($1,$2,$3)',
        [user.email, 'security fixture', role === 'delegate' ? 'catalog' : role]);
    }
  }
  const { rows: [book] } = await client.query(
    'insert into books(title,author,author_id,status,content,chapters) values($1,$2,$3,$4,$5,$6) returning id',
    ['Private manuscript', 'Security author', users.author.id, 'draft', 'Fixture text', JSON.stringify([{ title: 'One', content: 'Fixture text' }])]);

  for (let instance = 0; instance < 2; instance++) {
    const child = spawn(process.execPath, ['dist/index.cjs'], {
      env: {
        PATH: process.env.PATH, NODE_ENV: 'production', PORT: String(5192 + instance),
        DATABASE_URL: url.href, APP_URL: 'https://security.example.test',
        ADMIN_EMAIL: users.founder.email, SESSION_SECRET: secret,
        CLAIM_KEY_SECRET: randomBytes(32).toString('hex'),
        GOOGLE_CLIENT_ID: 'security-fixture', GOOGLE_CLIENT_SECRET: 'security-fixture-only',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', data => { output = (output + data).slice(-4000); });
    child.stderr.on('data', data => { output = (output + data).slice(-4000); });
    processes.push(child);
    let healthy = false;
    for (let attempt = 0; attempt < 150; attempt++) {
      try { healthy = (await request('/healthz', { instance })).status === 200; } catch {}
      if (healthy) break;
      await delay(150);
    }
    assert.ok(healthy, 'Server did not start: ' + output);
  }

  await check('Passport identities and explicit capabilities', async () => {
    const capabilities = {
      catalog: 'manageCatalog', visual: 'manageFrames', audio: 'manageAudioCatalog',
      finance: 'manageFinance', access: 'manageAdmins',
    };
    for (const [role, capability] of Object.entries(capabilities)) {
      const me = await request('/api/auth/me', { role });
      assert.equal(me.data.id, users[role].id);
      assert.equal(me.data.capabilities[capability], true);
      assert.equal(me.data.capabilities[role === 'access' ? 'manageFinance' : 'manageAdmins'], false);
    }
  });
  await check('Partial book/profile updates preserve omitted fields and chapter completion is explicit', async () => {
    const created = await request('/api/books', { role: 'author', method: 'POST', body: { title: 'Single chapter', author: 'Fixture', status: 'published', content: 'Complete story' } });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const updated = await request(`/api/books/${created.data.id}`, { role: 'author', method: 'PUT', body: { title: 'Renamed chapter', expectedRevision: created.data.revision } });
    assert.equal(updated.status, 200, JSON.stringify(updated.data)); assert.equal(updated.data.status, 'published');
    await client.query('update users set social_links=$1 where id=$2', [JSON.stringify({ website: 'https://example.test/author' }), users.author.id]);
    assert.equal((await request('/api/profile', { role: 'author', method: 'PATCH', body: { bio: 'Only bio changes' } })).status, 200);
    assert.equal((await client.query('select social_links from users where id=$1', [users.author.id])).rows[0].social_links.website, 'https://example.test/author');
    const progress = { bookId: String(created.data.id), chapter: 0, maxChapter: 0 };
    assert.equal((await request('/api/sync/progress', { role: 'author', method: 'PUT', body: progress })).status, 200);
    assert.equal((await request(`/api/books/${created.data.id}/hearts`, { role: 'author' })).data.finishers, 0);
    assert.equal((await request('/api/sync/progress', { role: 'author', method: 'PUT', body: { ...progress, completed: true } })).status, 200);
    assert.equal((await request(`/api/books/${created.data.id}/hearts`, { role: 'author' })).data.finishers, 1);
  });
  await check('New cloud drafts are private and concurrent retries create exactly one work', async () => {
    const body = { draftId: 'new-draft-fixture', data: { title: 'Private cloud draft', author: 'Fixture', content: 'Recoverable private work' } };
    const replies = await Promise.all([0, 1].map(instance => request('/api/books/drafts', { role: 'author', instance, method: 'POST', body })));
    assert.ok(replies.every(result => result.status === 201), JSON.stringify(replies));
    assert.equal(replies[0].data.id, replies[1].data.id); assert.equal(replies[0].data.status, 'draft');
    const id = replies[0].data.id;
    assert.equal((await request(`/api/books/${id}`, { role: 'reader' })).status, 404);
    const revisions = await request(`/api/books/${id}/revisions`, { role: 'author' });
    assert.equal(revisions.status, 200); assert.equal(revisions.data.revisions.length, 1);
    assert.ok(!('snapshot' in revisions.data.revisions[0]));
    const exported = await request('/api/account/export', { role: 'author' });
    assert.equal(exported.status, 200); assert.equal(exported.data.schema, 'tloque-account-export@2');
    assert.ok(exported.data.authorship.revisions.some(item => item.bookId === id && item.snapshot.content === 'Recoverable private work'));
    const catalog = await request('/api/books?limit=1', { role: 'author' });
    assert.ok(catalog.data.length <= 1); assert.ok(catalog.data.every(item => !('content' in item) && !('chapters' in item)));
  });
  await check('Role matrix rejects access to other administrative areas', async () => {
    const areas = {
      catalog: '/api/admin/books/all', audio: '/api/admin/audio/assets',
      finance: '/api/admin/payouts', access: '/api/admin/admins',
    };
    for (const [allowed, path] of Object.entries(areas)) {
      for (const role of ['reader', 'catalog', 'visual', 'audio', 'finance', 'access']) {
        assert.equal((await request(path, { role })).status, role === allowed ? 200 : 403, role + ' ' + path);
      }
    }
    assert.equal((await request('/api/admin/frames', { role: 'finance', method: 'POST', body: {} })).status, 403);
    assert.equal((await request('/api/admin/frames', { role: 'visual', method: 'POST', body: {} })).status, 400);
  });
  await check('Catalogue cursors and server search reach older books without sending manuscripts', async () => {
    const { rows: [needle] } = await client.query("insert into books(title,author,status,content) values('Needle older edition','Pagination fixture','published','Private heavy payload') returning id");
    await client.query("insert into books(title,author,status,content) select 'Page fixture ' || n,'Pagination fixture','published',repeat('body ',1000) from generate_series(1,120) n");
    const first = await request('/api/books?limit=50', { role: 'reader' });
    assert.equal(first.data.length, 50); assert.ok(first.data.every(item => !('content' in item) && !('chapters' in item)));
    const second = await request('/api/books?limit=50&before=' + first.headers.get('X-Next-Cursor'), { role: 'reader' });
    assert.equal(second.data.length, 50);
    assert.ok(second.data.every(item => item.id < Math.min(...first.data.map(book => book.id))));
    const result = await request('/api/books?search=Needle%20older', { role: 'reader' });
    assert.deepEqual(result.data.map(book => book.id), [needle.id]);
    assert.equal((await request('/api/books?limit=1.5', { role: 'reader' })).data.length, 1);
  });
  await check('Private manuscripts remain scoped to owner or catalog capability', async () => {
    for (const role of ['reader', 'visual', 'audio', 'finance', 'access']) {
      assert.equal((await request('/api/books/' + book.id, { role })).status, 404);
      assert.equal((await request('/api/books/' + book.id, { role, method: 'PUT', body: { title: 'Forbidden', expectedRevision: 1 } })).status, 403);
    }
    assert.equal((await request('/api/books/' + book.id, { role: 'author' })).status, 200);
    assert.equal((await request('/api/books/' + book.id, { role: 'catalog' })).status, 200);
  });
  await check('Role changes and revocation take effect on the next request in another instance', async () => {
    assert.equal((await request('/api/admin/books/all', { role: 'delegate', instance: 1 })).status, 200);
    assert.equal((await request('/api/admin/admins/' + encodeURIComponent(users.delegate.email), {
      role: 'founder', method: 'PATCH', body: { role: 'audio' },
    })).status, 200);
    assert.equal((await request('/api/admin/books/all', { role: 'delegate', instance: 1 })).status, 403);
    assert.equal((await request('/api/admin/audio/assets', { role: 'delegate', instance: 1 })).status, 200);
    assert.equal((await request('/api/admin/admins/' + encodeURIComponent(users.delegate.email), { role: 'founder', method: 'DELETE' })).status, 204);
    assert.equal((await request('/api/admin/audio/assets', { role: 'delegate', instance: 1 })).status, 403);
    assert.equal((await request('/api/auth/me', { role: 'delegate', instance: 1 })).data.isAdmin, false);
  });
  await check('Failed permission lookup never falls back to cached access', async () => {
    assert.equal((await request('/api/admin/books/all', { role: 'catalog', instance: 1 })).status, 200);
    await client.query('alter table admins rename to admins_security_fixture');
    try {
      assert.equal((await request('/api/admin/books/all', { role: 'catalog', instance: 1 })).status, 500);
    } finally { await client.query('alter table admins_security_fixture rename to admins'); }
    assert.equal((await request('/api/admin/books/all', { role: 'catalog', instance: 1 })).status, 200);
  });
  await check('Cross-tab writes and old clients are rejected before modifying another account', async () => {
    const body = { days: 12, lastDate: '2026-09-17' };
    const wrong = await request('/api/sync/streak', { role: 'other', method: 'PUT', body,
      headers: { 'X-Tloque-Account': String(users.author.id) } });
    assert.equal(wrong.status, 409);
    assert.equal(wrong.headers.get('X-Tloque-Session'), 'changed');
    assert.equal((await request('/api/sync/streak', { role: 'other', method: 'PUT', body, bind: false })).status, 428);
    assert.equal(Number((await client.query('select count(*) from user_state where user_id=$1', [users.other.id])).rows[0].count), 0);
    assert.equal((await request('/api/auth/me', { role: 'other', headers: { 'X-Tloque-Client': 'old' } })).status, 426);
    assert.equal((await request('/api/sync/streak', { role: 'other', method: 'PUT', body })).status, 200);
  });
  await check('Revision omission and stale edits do not overwrite manuscripts', async () => {
    const path = '/api/books/' + book.id;
    assert.equal((await request(path, { role: 'author', method: 'PUT', body: { title: 'No revision' } })).status, 400);
    assert.equal((await request(path, { role: 'author', method: 'PUT', body: { title: 'New manuscript', expectedRevision: 1 } })).status, 200);
    assert.equal((await request(path, { role: 'author', method: 'PUT', body: { title: 'Stale manuscript', expectedRevision: 1 } })).status, 409);
    const saved = await request(path, { role: 'author' });
    assert.equal(saved.data.title, 'New manuscript');
    assert.equal(saved.data.revision, 2);
  });
  await check('Private responses and QR status are not cached', async () => {
    const securityHeaders = (await request('/healthz')).headers;
    assert.match(securityHeaders.get('content-security-policy'), /connect-src[^;]*https:/);
    const scriptSources = securityHeaders.get('content-security-policy').split(';').find(value => value.trim().startsWith('script-src')).trim().split(/\s+/).slice(1);
    assert.ok(!scriptSources.includes('https:') && !scriptSources.includes("'unsafe-eval'"));
    for (const path of ['/api/auth/me', '/api/wallet', '/api/claim/fixture-not-found']) {
      assert.match((await request(path, { role: 'reader' })).headers.get('cache-control'), /no-store/);
    }
    assert.match((await request('/api/claim/fixture-not-found')).headers.get('cache-control'), /no-store/);
  });
} finally {
  await writeFile(resolve(out, 'results.json'), JSON.stringify({ checks, passed: checks.length }, null, 2) + '\n');
  for (const child of processes) child.kill('SIGTERM');
  await delay(500);
  for (const child of processes) if (child.exitCode === null) child.kill('SIGKILL');
  await client.end();
}
