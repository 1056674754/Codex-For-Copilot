import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { resolveTestTempDirectory } from './testTempDirectory.mjs';

const root = await mkdtemp(join(resolveTestTempDirectory(), 'codex-shared-history-'));
try {
  const bundle = join(root, 'store.mjs');
  await build({ entryPoints: ['src/continuationHistoryStore.ts'], outfile: bundle, bundle: true, platform: 'node', format: 'esm' });
  const { ContinuationHistoryStore } = await import(pathToFileURL(bundle).href);
  const directory = join(root, 'private-history');
  const writer = new ContinuationHistoryStore(directory);
  const reader = new ContinuationHistoryStore(directory);
  const branch = fixture('response-one');
  assert.equal(await writer.save('codex::fixture', branch), true);
  assert.equal((await reader.load('codex::fixture', 'account-a/endpoint-a', 'response-one')).status, 'restored');
  assert.equal((await reader.load('codex::other', 'account-a/endpoint-a', 'response-one')).status, 'missing');
  assert.equal((await reader.load('codex::fixture', 'account-b/endpoint-a', 'response-one')).status, 'missing');
  assert.equal((await reader.load('codex::fixture', 'account-a/endpoint-b', 'response-one')).status, 'missing');
  assert.equal((await reader.load('codex::fixture', 'account-a/endpoint-a', '../response-one')).status, 'missing');
  assert.equal((await stat(directory)).mode & 0o777, 0o700);
  const [filename] = await readdir(directory);
  assert.match(filename, /^[a-f0-9]{64}\.json$/);
  assert.equal((await stat(join(directory, filename))).mode & 0o777, 0o600);

  const child = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import { ContinuationHistoryStore } from ${JSON.stringify(pathToFileURL(bundle).href)};
    const result = await new ContinuationHistoryStore(${JSON.stringify(directory)}).load('codex::fixture', 'account-a/endpoint-a', 'response-one');
    process.stdout.write(result.status);
  `], { encoding: 'utf8' });
  assert.equal(child, 'restored', 'independent process restores a snapshot without writer memory');

  await Promise.all(Array.from({ length: 8 }, (_, index) => new ContinuationHistoryStore(directory).save('codex::fixture', fixture(`concurrent-${index}`))));
  for (let index = 0; index < 8; index++) {
    assert.equal((await reader.load('codex::fixture', 'account-a/endpoint-a', `concurrent-${index}`)).status, 'restored');
  }
  assert.equal((await readdir(directory)).some((name) => name.endsWith('.tmp')), false);

  const stored = JSON.parse(await readFile(join(directory, filename), 'utf8'));
  await writeFile(join(directory, filename), JSON.stringify({ ...stored, savedAt: Date.now() - 7 * 24 * 60 * 60 * 1000 - 1 }));
  assert.equal((await reader.load('codex::fixture', 'account-a/endpoint-a', 'response-one')).status, 'expired');
  await writeFile(join(directory, filename), '{incomplete');
  assert.equal((await reader.load('codex::fixture', 'account-a/endpoint-a', 'response-one')).status, 'unavailable');
  await writeFile(join(directory, filename), JSON.stringify({ ...stored, branch: { ...branch, responseId: 'wrong' } }));
  assert.equal((await reader.load('codex::fixture', 'account-a/endpoint-a', 'response-one')).status, 'invalid');

  const limitedDirectory = join(root, 'limited');
  const size = Buffer.byteLength(JSON.stringify(stored));
  const limited = new ContinuationHistoryStore(limitedDirectory, 7 * 86400000, size * 2);
  for (let index = 0; index < 6; index++) {
    assert.equal(await limited.save('codex::fixture', fixture(`bounded-${index}`)), true);
  }
  const sizes = await Promise.all((await readdir(limitedDirectory)).map(async (name) => (await stat(join(limitedDirectory, name))).size));
  assert.ok(sizes.reduce((sum, bytes) => sum + bytes, 0) <= size * 2);
  assert.equal(await limited.save('codex::fixture', { ...branch, input: ['x'.repeat(size * 3)] }), false);

  const link = join(root, 'symlink-history');
  await symlink(directory, link);
  assert.equal(await new ContinuationHistoryStore(link).save('codex::fixture', branch), false);
  assert.equal((await new ContinuationHistoryStore(link).load('codex::fixture', 'account-a/endpoint-a', 'response-one')).status, 'unavailable');
  console.log('Smoke test passed: shared continuation history survives process changes, isolates scopes, enforces privacy, TTL and capacity, and fails closed.');
} finally {
  await rm(root, { recursive: true, force: true });
}

function fixture(responseId) {
  return {
    id: 'branch_1',
    envelope: { scopeKey: 'account-a/endpoint-a', identityKey: 'identity', requestFingerprint: 'fingerprint' },
    input: [{ type: 'message', role: 'user', content: 'private fixture' }],
    continuationInput: [{ type: 'message', role: 'user', content: 'private fixture' }],
    responseId,
    updatedAt: Date.now(),
    state: {
      identity: { sessionId: 'session-fixture' },
      turn: { id: 'turn-fixture', completed: true, startedAt: Date.now() },
      continuation: {
        fullRequest: { model: 'fixture', input: [{ type: 'message', role: 'user', content: 'private fixture' }] },
        responseId, responseItems: [], requestFingerprint: 'fingerprint', turnId: 'turn-fixture'
      }
    }
  };
}
