import { createHash } from 'node:crypto';
import type * as vscode from 'vscode';
import type { CodexAccountSummary } from './auth/codexAuthManager';

const ACCOUNT_MODEL_DELIMITER = '::account=';

export function accountModelReference(accountKey: string): string {
  return createHash('sha256').update(accountKey).digest('hex').slice(0, 24);
}

export function parseAccountModelIdentifier(id: string): { modelId: string; accountReference?: string } {
  const index = id.indexOf(ACCOUNT_MODEL_DELIMITER);
  if (index < 0) {
    return { modelId: id };
  }
  const modelId = id.slice(0, index);
  const accountReference = id.slice(index + ACCOUNT_MODEL_DELIMITER.length);
  if (!modelId.startsWith('codex::') || modelId === 'codex::' || !/^[a-f0-9]{24}$/.test(accountReference)) {
    throw new Error('Invalid account-bound Codex model. Select an account-labelled model again.');
  }
  return { modelId, accountReference };
}

export function bindModelToAccount(
  model: vscode.LanguageModelChatInformation,
  account: CodexAccountSummary,
  accounts: readonly CodexAccountSummary[],
  displayNames: Record<string, string> = {}
): vscode.LanguageModelChatInformation {
  const displayOwner = (candidate: CodexAccountSummary): string => {
    const email = candidate.email;
    const alias = displayNames && typeof displayNames === 'object'
      ? displayNames[accountModelReference(candidate.accountKey)]
      : undefined;
    return typeof alias === 'string' && alias.trim()
      ? alias.trim().replace(/[\r\n\t]+/g, ' ').slice(0, 40)
      : email ?? 'ChatGPT account';
  };
  const owner = displayOwner(account);
  const sameOwnerCount = accounts.filter((candidate) => displayOwner(candidate) === owner).length;
  const workspace = account.accountId?.trim();
  const duplicateWorkspace = accounts.filter((candidate) => displayOwner(candidate) === owner
    && candidate.accountId?.trim().slice(-6) === workspace?.slice(-6)).length > 1;
  const label = sameOwnerCount > 1
    ? `${owner} · ${workspace && !duplicateWorkspace ? `Workspace ${workspace.slice(-6)}` : `Account ${accounts.findIndex((candidate) => candidate.accountKey === account.accountKey) + 1}`}`
    : owner;
  const fullLabel = account.email && !label.includes(account.email) ? `${label} (${account.email})` : label;
  return {
    ...model,
    id: `${parseAccountModelIdentifier(model.id).modelId}${ACCOUNT_MODEL_DELIMITER}${accountModelReference(account.accountKey)}`,
    name: `${model.name} · ${label}`,
    tooltip: `${model.tooltip ?? model.name}\nAccount: ${fullLabel}. Requests always use this account, regardless of the serving window.`,
    detail: [model.detail, `Account: ${fullLabel}`, account.reauthRequired ? 'Re-authentication required' : undefined].filter(Boolean).join(' · ')
  };
}
