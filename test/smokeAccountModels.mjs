import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from 'esbuild';
import { resolveTestTempDirectory } from './testTempDirectory.mjs';

const temp = await mkdtemp(join(resolveTestTempDirectory(), 'codex-account-model-labels-'));
try {
  const outfile = join(temp, 'accountModels.cjs');
  await build({ entryPoints: ['src/accountModels.ts'], outfile, bundle: true, platform: 'node', format: 'cjs' });
  const { bindModelToAccount, accountModelReference } = createRequire(import.meta.url)(outfile);
  const model = { id: 'codex::gpt-6.1-sol', name: 'GPT-6.1-Sol', tooltip: 'Model description', detail: 'Model detail' };
  const accounts = [
    { accountKey: 'a', email: 'research@example.test', accountId: 'workspace-one' },
    { accountKey: 'b', email: 'dev@example.test', accountId: 'workspace-two' }
  ];
  const original = bindModelToAccount(model, accounts[0], accounts);
  const alias = bindModelToAccount(model, accounts[0], accounts, { [accountModelReference('a')]: ' 教研 ' });
  assert.equal(alias.name, 'GPT-6.1-Sol · 教研');
  assert.equal(alias.id, original.id, 'renaming must not change the bound account model ID');
  assert.ok(alias.tooltip.includes('research@example.test'));
  assert.ok(alias.detail.includes('research@example.test'));
  for (const value of ['', '   ', null, 42]) {
    assert.equal(bindModelToAccount(model, accounts[0], accounts, { [accountModelReference('a')]: value }).name, original.name);
  }
  const duplicates = { [accountModelReference('a')]: '开发', [accountModelReference('b')]: '开发' };
  assert.notEqual(bindModelToAccount(model, accounts[0], accounts, duplicates).name, bindModelToAccount(model, accounts[1], accounts, duplicates).name);
  const sameWorkspace = accounts.map((account) => ({ ...account, accountId: 'shared-workspace' }));
  assert.notEqual(bindModelToAccount(model, sameWorkspace[0], sameWorkspace, duplicates).name, bindModelToAccount(model, sameWorkspace[1], sameWorkspace, duplicates).name);
  const long = bindModelToAccount(model, accounts[0], accounts, { [accountModelReference('a')]: 'x'.repeat(100) });
  assert.equal(long.name, `GPT-6.1-Sol · ${'x'.repeat(40)}`);
  assert.equal(bindModelToAccount(model, accounts[0], accounts, { [accountModelReference('a')]: '开发\n一' }).name, 'GPT-6.1-Sol · 开发 一');
  assert.equal(model.name, 'GPT-6.1-Sol');
  console.log('Smoke test passed: account aliases preserve routing, full identities, and distinct labels.');
} finally {
  await rm(temp, { recursive: true, force: true });
}
