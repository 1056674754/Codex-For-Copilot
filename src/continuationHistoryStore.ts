import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, readdir, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { ResponseBranchEntry } from './responseBranchStore';

const HISTORY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const HISTORY_MAX_BYTES = 256 * 1024 * 1024;
const HISTORY_MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const HISTORY_FILE = /^[a-f0-9]{64}\.json$/;

interface StoredHistory {
  version: 1;
  modelId: string;
  savedAt: number;
  branch: ResponseBranchEntry;
}

export type HistoryReadResult =
  | { status: 'restored'; branch: ResponseBranchEntry }
  | { status: 'missing' | 'expired' | 'invalid' | 'unavailable' };

// One atomic file per response avoids lost updates between extension hosts.
// These are private conversation snapshots, not credentials or a server-state cache.
export class ContinuationHistoryStore {
  constructor(
    private readonly directory: string,
    private readonly ttlMs = HISTORY_TTL_MS,
    private readonly maxBytes = HISTORY_MAX_BYTES
  ) {}

  async save(modelId: string, branch: ResponseBranchEntry): Promise<boolean> {
    let temporary: string | undefined;
    try {
      await this.prepareDirectory();
      const serialized = JSON.stringify({ version: 1, modelId, savedAt: Date.now(), branch } satisfies StoredHistory);
      const size = Buffer.byteLength(serialized);
      if (size > Math.min(this.maxBytes, HISTORY_MAX_ENTRY_BYTES)) {
        return false;
      }
      const filename = this.filename(modelId, branch.envelope.scopeKey, branch.responseId);
      temporary = `${filename}.${randomUUID()}.tmp`;
      const file = await open(temporary, 'wx', 0o600);
      try {
        await file.writeFile(serialized, 'utf8');
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, filename);
      temporary = undefined;
      await this.prune(filename);
      return (await lstat(filename)).isFile();
    } catch {
      return false;
    } finally {
      if (temporary) {
        await unlink(temporary).catch(() => {});
      }
    }
  }

  async load(modelId: string, scopeKey: string, responseId: string): Promise<HistoryReadResult> {
    try {
      const directory = await lstat(this.directory);
      if (!directory.isDirectory() || (directory.mode & 0o077) !== 0) {
        return { status: 'unavailable' };
      }
      const file = await open(this.filename(modelId, scopeKey, responseId), constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const metadata = await file.stat();
        if (!metadata.isFile() || (metadata.mode & 0o077) !== 0
          || metadata.size > Math.min(this.maxBytes, HISTORY_MAX_ENTRY_BYTES)) {
          return { status: 'invalid' };
        }
        const value: unknown = JSON.parse(await file.readFile('utf8'));
        if (!isStoredHistory(value, modelId, scopeKey, responseId)) {
          return { status: 'invalid' };
        }
        if (Date.now() - value.savedAt > this.ttlMs || value.savedAt > Date.now() + 60_000) {
          return { status: 'expired' };
        }
        return { status: 'restored', branch: value.branch };
      } finally {
        await file.close();
      }
    } catch (error) {
      return { status: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unavailable' };
    }
  }

  private filename(modelId: string, scopeKey: string, responseId: string): string {
    const digest = createHash('sha256').update(JSON.stringify([modelId, scopeKey, responseId])).digest('hex');
    return join(this.directory, `${digest}.json`);
  }

  private async prepareDirectory(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const directory = await lstat(this.directory);
    if (!directory.isDirectory()) {
      throw new Error('Continuation history directory must not be a symbolic link.');
    }
    await chmod(this.directory, 0o700);
  }

  private async prune(protectedFilename: string): Promise<void> {
    const files: { filename: string; size: number; time: number }[] = [];
    for (const entry of await readdir(this.directory, { withFileTypes: true })) {
      if (!entry.isFile() || !HISTORY_FILE.test(entry.name)) {
        continue;
      }
      const filename = join(this.directory, entry.name);
      const metadata = await lstat(filename).catch(() => undefined);
      if (!metadata?.isFile()) {
        continue;
      }
      if (filename !== protectedFilename && Date.now() - metadata.mtimeMs > this.ttlMs) {
        await unlink(filename).catch(() => {});
      } else {
        files.push({ filename, size: metadata.size, time: metadata.mtimeMs });
      }
    }
    let total = files.reduce((sum, entry) => sum + entry.size, 0);
    for (const entry of files.sort((left, right) => left.time - right.time)) {
      if (total <= this.maxBytes) {
        break;
      }
      if (entry.filename !== protectedFilename) {
        await unlink(entry.filename).catch(() => {});
        total -= entry.size;
      }
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStoredHistory(value: unknown, modelId: string, scopeKey: string, responseId: string): value is StoredHistory {
  if (!isRecord(value) || value.version !== 1 || value.modelId !== modelId
    || typeof value.savedAt !== 'number' || !Number.isFinite(value.savedAt) || !isRecord(value.branch)) {
    return false;
  }
  const branch = value.branch;
  if (branch.responseId !== responseId || typeof branch.id !== 'string'
    || !Array.isArray(branch.input) || !Array.isArray(branch.continuationInput)
    || !isRecord(branch.envelope) || branch.envelope.scopeKey !== scopeKey
    || typeof branch.envelope.identityKey !== 'string' || typeof branch.envelope.requestFingerprint !== 'string'
    || !isRecord(branch.state) || !isRecord(branch.state.identity) || !isRecord(branch.state.turn)
    || typeof branch.state.turn.id !== 'string' || !isRecord(branch.state.continuation)) {
    return false;
  }
  const snapshot = branch.state.continuation;
  return snapshot.responseId === responseId && snapshot.turnId === branch.state.turn.id
    && typeof snapshot.requestFingerprint === 'string' && Array.isArray(snapshot.responseItems)
    && isRecord(snapshot.fullRequest) && Array.isArray(snapshot.fullRequest.input)
    && typeof snapshot.fullRequest.model === 'string' && !snapshot.fullRequest.previous_response_id;
}
