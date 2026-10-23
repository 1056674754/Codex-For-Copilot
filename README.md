<div align="center">
  <img src="assets/codex-for-copilot.png" alt="Codex For Copilot logo" width="128" height="128">

  <h1>Codex For Copilot</h1>

  <p><strong>Use your Codex models directly inside VS Code Chat and Agent mode.</strong></p>

  <p>
    <a href="https://marketplace.visualstudio.com/items?itemName=Gaussian.gaussian-codex-for-copilot">
      <img src="https://img.shields.io/badge/Install_from-VS_Code_Marketplace-007ACC?style=for-the-badge&logo=visualstudiocode&logoColor=white" alt="Install from VS Code Marketplace">
    </a>
  </p>
</div>

Codex For Copilot is a lightweight VS Code Language Model Provider that connects VS Code Chat to the ChatGPT Codex Responses backend. Select **Codex** from the model picker and keep the native VS Code experience for chat, tools, confirmations, workspace trust, and extensions.

<p align="center">
  <img src="assets/showcase.gif" alt="Codex For Copilot running in VS Code" width="420">
</p>

## Highlights

- **Native VS Code integration** — works in Chat and Agent mode through the standard model picker.
- **Automatic model discovery** — exposes available upstream Codex models with configurable fallbacks. This fork hides and locally blocks `gpt-5.6-luna` and `gpt-5.6-sol`; select GPT-6 Luna or GPT-6 Sol instead. Other models, including GPT-5.6 Terra, remain unchanged.
- **Fast streaming transport** — supports reusable WebSocket sessions with HTTP fallback. HTTP 5xx and structured stream/WebSocket overloads share the configured retry budget (15 retries by default), with 10, 20, 40, 80, then 120-second waits; server retry hints can increase waits up to the same two-minute cap. Once visible output exists, requests are not replayed. Retry attempts and delays are logged. After bounded retries, server overloads are reported through Copilot's `ChatRateLimited` classification (matching its upstream-overload behavior), with a concise server-overload message and no UI stack trace. Overloads do not refresh account usage or imply exhausted quota.
- **VS Code tool support** — forwards built-in, extension, and MCP tool calls through the Responses API.
- **Hosted Web Search** — optionally gives Codex live web access through OpenAI's native Responses tool, with clickable sources. The same `#webSearch` tool also works with other tool-capable VS Code models.
- **Optional Native Tool Search** — lets compatible Codex models search selected Agent tools on demand when you explicitly enable it.
- **Conversation continuity** — reuses compatible response branches for efficient follow-up turns. Agent Host can dispatch successive requests through different VS Code windows. Stateful markers are therefore emitted only after a private cross-window snapshot is saved, with `codexModelProvider.persistContinuationHistory` explicitly enabled. Without that opt-in, new responses leave full history with the client instead of replacing it with an instance-local marker. Shared snapshots expire after 7 days; cleanup on writes limits storage to 256 MiB, with 64 MiB per snapshot. In-memory branch reuse remains bounded to 64 branches and 10 minutes of inactivity. Complete, integrity-checked snapshots permit full replay when request settings change; credentials/endpoints, model, and incompatible tools never reuse an incorrect branch. Missing or corrupt snapshots fail closed rather than silently dropping context. Older markers whose history was already lost cannot be restored. Classified diagnostics include provider-instance and hashed response/envelope correlation IDs, not conversation text. Agent Host currently maps provider errors to HTTP 502; the stable API cannot prevent its retries.
- **Usage visibility** — shows available account limits or Credits in the status bar when supplied by the backend.

## Get started

### 1. Install

Install the extension from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=Gaussian.gaussian-codex-for-copilot).

### 2. Add credentials

Open the Command Palette and choose one of the following:

- **`Codex for Copilot: Sign in with ChatGPT`** for the normal browser-based login flow.
- **`Codex for Copilot: Sign in with Device Code`** when a loopback browser callback is unavailable.
- **`Codex for Copilot: Import Codex auth.json`** to import existing Codex CLI ChatGPT credentials.
- **`Codex: Set API Key`** to store an API key in VS Code SecretStorage.

The extension stores imported and signed-in ChatGPT credentials in VS Code SecretStorage and refreshes them automatically, including refresh-token rotation. On activation and every five minutes while VS Code is running, it checks all stored accounts (including inactive ones) and refreshes only those due. Importing copies the credentials and never writes to the original `~/.codex/auth.json` file; signing out of an imported credential only removes the extension's copy. The direct `~/.codex/auth.json` fallback remains read-only. If another client rotates or revokes an imported refresh token, the extension's copy cannot recover automatically; sign in through this extension for separate credentials, or re-import a current `auth.json` for that account.

### 3. Select Codex

Open VS Code Chat, choose **Codex** from the model picker, and start chatting or using Agent mode.

To give a request live web access, enable **Web Search** in the Chat tools picker or reference `#webSearch` in the prompt. With a Codex model the Codex backend executes the search directly through OpenAI's hosted `web_search` tool. With any other tool-capable VS Code model, the same `#webSearch` tool runs one isolated Responses request that also uses OpenAI's hosted `web_search` tool and returns the synthesized answer plus sources.

Web Search settings under **Settings → Extensions → Codex** let you choose live or cached access, search context size, and an optional domain allowlist. You can also choose whether Chat shows compact statuses, search/open/find actions, or actions with clickable source pages.

### Choose the account in the model picker

Account-bound requests may run concurrently: account/token identity is part of each connection pool scope, and requesting another account must not globally dispose active sockets. Logs correlate `request.credentials-resolved` and `request.failed` by operation ID and include the selected account-bound model ID plus a hashed resolved account key. A bare `OK` failure can be a WebSocket close reason, not a successful response.

Native collapsible account groups are not exposed by the stable model-information API. The current Agent Host reconstructs BYOK grouping by vendor and does not retain per-account provider configuration groups. Account-labelled models therefore remain in the Codex vendor group; separate account vendors would require a distinct compatibility design.

Use **`Codex for Copilot: Rename Account`** to select an existing account and edit its short display name. Leave the name empty to restore its original label. Names are stored as editable account-reference-keyed data in User settings (`codexModelProvider.accountDisplayNames`), without email matching or hardcoded account identities. Full emails remain in details/tooltips; duplicate labels are disambiguated. Renaming never changes model IDs or request routing.

After adding accounts with **`Codex for Copilot: Add Codex Account`**, select an account-labelled model in Chat, for example **`GPT-6 Sol · alice@example.com`** or **`GPT-6 Sol · bob@example.com`**. Each saved account has its own model entries, even when there is only one saved account. Accounts with the same email in different ChatGPT workspaces include a short workspace fingerprint in the label.

**For Copilot SDK / Agent Host chats, the account in the model label is authoritative.** VS Code's shared Agent Host can send a request through a different window from the one containing the chat. A workspace-local account preference alone cannot control that routing. Account-bound model IDs carry a stable, non-secret account reference, so the serving window resolves that exact account for model requests, HTTP/401 retries, WebSocket handshakes, and remote token counts. No email, token, or raw local account key is embedded in the model ID or sent as part of the upstream model slug. Listing account models uses stored snapshots without refreshing unrelated accounts.

Different chats or windows can select different account-labelled models without changing each other's accounts. If a bound account was removed or requires reauthentication, its request fails rather than silently using another account, the Codex CLI file, or an API key. Shared credentials still mean that removing an account or signing out of all accounts affects all windows.

**After installing this update, reload all relevant VS Code windows and reselect an account-labelled model in existing SDK chats.** Legacy model IDs without an account suffix remain compatible, but still use the serving window's default account and are not safe for cross-window account isolation. When continuing a stateful SDK conversation under a different model/account, start a new chat or resend the full history; another account cannot reuse the old account's response ID.

**`Codex for Copilot: Switch Codex Account`** and account selection in **`Codex: Show Account Limits`** only change the workspace default. This preference remains in workspace state across restarts and drives the compact usage display, legacy unbound requests, and the isolated Web Search helper used by non-Codex models. It does **not** change an existing account-bound chat model. The usage tooltip identifies the workspace default; inspect the account named in the chat model to determine which account that chat uses. With `credentialsSource: secretStorage`, the picker retains the API-key model entries; an already selected explicitly bound model still uses its bound account.

On first use, a workspace adopts the previously selected global account (or the first available account). If that default account is removed, it saves the first remaining account on its next credential lookup. A default-account authentication failure is surfaced rather than silently falling back to CLI credentials. CLI fallback remains available when no stored account is selected.

Separate accounts can distribute account-specific usage, but switching accounts does not guarantee that short-term rate limits or backend overloads disappear.

## Tool discovery

The extension uses **VS Code Virtual Tool Groups by default**. VS Code organizes selected Agent tools into groups and reveals a group when the model needs it.

**Native Tool Search is optional.** When enabled, it temporarily disables VS Code Virtual Tool Groups and instead lets the Codex backend search the selected tool catalog and load matching tools on demand. Both methods solve the same problem—avoiding loading every tool into the model at once—but VS Code performs the grouping in the default mode, while Codex performs the search in Native Tool Search mode.

Use **`Codex: Enable Native Tool Search`** to opt in. The extension saves the previous VS Code grouping setting. Use **`Codex: Use VS Code Virtual Tool Groups`** to disable Native Tool Search and restore that setting. Tool execution, confirmation, workspace trust, and permissions remain handled by VS Code in both modes.

Hosted Web Search is independent from Native Tool Search. It remains available when Native Tool Search is disabled and is only combined with selected client tools in the final Responses API `tools` array.

## Requirements

- VS Code 1.104.0 or newer.
- A ChatGPT sign-in, imported Codex CLI `auth.json`, or API key.

## Common commands

- `Codex: Manage`
- `Codex: Open Settings`
- `Codex: Open Logs`
- `Codex: Refresh Account Limits`
- `Codex: Enable Native Tool Search`
- `Codex: Use VS Code Virtual Tool Groups`
- `Codex: Show Native Tool Search Status`
- `Codex for Copilot: Sign in with ChatGPT`
- `Codex for Copilot: Add Codex Account`
- `Codex for Copilot: Switch Codex Account`
- `Codex for Copilot: Remove Codex Account`
- `Codex for Copilot: Sign in with Device Code`
- `Codex for Copilot: Import Codex auth.json`
- `Codex for Copilot: Show Auth Status`
- `Codex for Copilot: Sign Out (All Accounts)`

## Diagnostics and privacy

Use **Codex: Open Logs** to view the extension's structured VS Code log channel. Each model request, authentication flow, model discovery operation, and account-limit refresh receives an `operationId`; search for that value to follow one operation through retries, WebSocket fallback, and completion.

The channel follows VS Code's native log level. Use **Developer: Set Log Level...** and select the Codex channel to enable Debug or Trace detail when investigating a problem.

Logs never include prompt or instruction text, reasoning, tool arguments/results, credentials, cookies, or Turn State. They retain only safe counts, sizes, hashes, identifiers hashed for correlation, transport decisions, and redacted error metadata.

Shared history is **opt-in** via `codexModelProvider.persistContinuationHistory` (default `false`). It stores full conversation/replay content, including tool results, under the extension's global storage in `continuation-history-v1/`, not in logs or the repository. Files use owner-only permissions (directory `0700`, files `0600`); authentication tokens and request headers are not stored. Snapshots are isolated by model and credential/endpoint scope. Seven-day expiry is enforced on reads; obsolete and excess snapshots are cleaned on subsequent writes. Disabling the setting prevents new writes and marker emission; remove that directory while requests are stopped to erase existing snapshots. Local and remote extension hosts with separate filesystems do not share snapshots.

Copilot utility overrides require `vendor/modelId`, not the bare model ID displayed in chat. Account-bound model IDs must include their account suffix. To follow the current BYOK main model instead, clear `chat.utilityModel` and `chat.utilitySmallModel`, and set `chat.byokUtilityModelDefault` to `mainAgent`. Copilot only follows that model after it has established a main BYOK endpoint; this does not force every independent utility task to use BYOK.

## Configuration

Most users can keep the defaults. Advanced settings are available under **Settings → Extensions → Codex**, including:

- credential source
- backend URL
- model catalog `client_version` override (defaults to `999.0.0` for discovery only; does not change Codex protocol headers)
- HTTP or WebSocket transport
- fallback model and model visibility
- reasoning effort and service tier
- request compression and WebSocket prewarming
- Web Search access, context, domains, and status detail

For custom Responses-compatible API endpoints such as CLIProxyAPI, you can opt in to
sending a stable per-thread prompt cache key with
`"codexModelProvider.enablePromptCacheKey": true`. It is disabled by default
because not every third-party endpoint accepts `prompt_cache_key`; the official
ChatGPT Codex compatibility profile continues to send its cache key normally.

For a proxy-required network, set VS Code's `http.proxy` setting or the Extension Host's `HTTPS_PROXY`/`HTTP_PROXY` environment variable. The provider applies that proxy consistently to model discovery, account usage, HTTP Responses requests, token counting, and WebSocket requests; `NO_PROXY` remains honored.

## Develop locally

```bash
npm install
npm run compile
```

Press `F5` in VS Code to launch an Extension Development Host.

Useful checks:

```bash
npm run check
npm run test:smoke
npm run test:extension-host
npm run package:vsix
```

Release and Marketplace publishing details are documented in [docs/releasing.md](docs/releasing.md).

## Remote workspaces

In Remote-SSH, Dev Containers, WSL, and Codespaces, the extension prefers the remote workspace host to work around [issue #25](https://github.com/GaussianGuaicai/Codex-For-Copilot/issues/25). It runs locally in local workspaces. No settings change is needed.

VS Code SecretStorage credentials remain available. The `~/.codex/auth.json` fallback is read on the host running the extension. If browser sign-in fails remotely, use **Codex for Copilot: Sign in with Device Code**.

This preference remains remote after [VS Code fixes the routing bug](https://github.com/microsoft/vscode/issues/326554); it does not automatically switch back to the local host.

## License

[MIT](LICENSE)
