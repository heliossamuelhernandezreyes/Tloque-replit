// Administrative setup, separate from application deployment. Default is a
// local validation. --apply needs an operator-owned token with Administration.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const policy=JSON.parse(await readFile(new URL('../.github/main-protection.json',import.meta.url),'utf8'));
const gates=[['verify','editor-p0-check.yml'],['visual-browser','editor-p0-check.yml'],['boundaries','security-boundaries.yml'],['payments','payment-boundaries.yml'],['audit-regressions','audit-regressions.yml']];
for(const [job,file] of gates){
  assert.ok(policy.required_status_checks.contexts.includes(job));
  const workflow=await readFile(new URL('../.github/workflows/'+file,import.meta.url),'utf8');
  assert.match(workflow,new RegExp('^  '+job+':','m'));
  assert.match(workflow,/pull_request:/);
  assert.doesNotMatch(workflow,/^\s+paths(?:-ignore)?:/m,'A required job must run for every pull request');
}
assert.equal(policy.enforce_admins,true);
assert.equal(policy.allow_force_pushes,false);
assert.equal(policy.allow_deletions,false);
if(!process.argv.includes('--apply')){
  console.log('Main protection configuration validated. No remote setting was changed.');
}else{
  const token=process.env.GH_TOKEN||process.env.GITHUB_TOKEN;
  if(!token) throw new Error('An authenticated repository administrator must apply this configuration with GH_TOKEN or GITHUB_TOKEN. Do not place credentials in files.');
  const branchResponse=await fetch('https://api.github.com/repos/heliossamuelhernandezreyes/Tloque-replit/branches/main',{
    headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(20_000),
  });
  if(!branchResponse.ok) throw new Error('Could not verify existing branch settings. No settings were changed.');
  if((await branchResponse.json()).protected) throw new Error('Main is already protected. Review its existing policy instead of overwriting it. No settings were changed.');
  const response=await fetch('https://api.github.com/repos/heliossamuelhernandezreyes/Tloque-replit/branches/main/protection',{
    method:'PUT',headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},body:JSON.stringify(policy),signal:AbortSignal.timeout(20_000),
  });
  if(!response.ok) throw new Error('GitHub rejected main protection (HTTP '+response.status+'). Existing settings were not intentionally weakened.');
  const saved=await response.json();
  assert.ok(saved.enforce_admins?.enabled);
  assert.ok(policy.required_status_checks.contexts.every(context=>saved.required_status_checks?.contexts?.includes(context)));
  console.log('Main protection enabled and verified.');
}
