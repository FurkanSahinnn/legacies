---
name: tauri-patterns
description: Tauri 2 desktop and mobile apps (a Rust core plus a system webview), covering commands and IPC, capabilities and permission scopes, the official fs, shell, http, store, updater and opener plugins, CSP, managed state, events vs channels, mobile targets, bundling, code signing and the updater. Use when a project has src-tauri/, tauri.conf.json, capabilities/*.json or @tauri-apps/* packages, when adding a command, plugin or window, or when migrating from the Tauri 1 allowlist.
---

# Tauri 2 Patterns

This skill targets Tauri 2.x as of October 2026: the `tauri` crate and `@tauri-apps/cli` at 2.12, and the plugins at 2.x. crates.io also carries a `3.0.0-alpha` line. Don't adopt it unless the project already has, and note that nothing below was checked against it. Rust style is covered by the `rust-patterns` skill; the frontend is whatever framework the project uses.

## Architecture and layout

```text
src/                     frontend (Vite + React/Svelte/...); reaches Rust only via @tauri-apps/api and plugin packages
src-tauri/
  Cargo.toml             [lib] crate-type = ["staticlib", "cdylib", "rlib"]
  build.rs               tauri_build::build(), or try_build(...) with an app manifest
  tauri.conf.json        identifier, build.devUrl/frontendDist, app.security, bundle, plugins.*
  capabilities/*.json    which windows get which permissions
  permissions/*.toml     app-defined permissions and sets (TOML only)
  gen/schemas/           generated JSON schemas; point "$schema" at them
  src/lib.rs             #[cfg_attr(mobile, tauri::mobile_entry_point)] pub fn run()
  src/main.rs            fn main() { app_lib::run() }
```

The trust model splits the app in two:

- **Trusted.** The Rust core and the plugins run unconstrained.
- **Untrusted.** The webview. Anything that runs there can invoke every command and plugin the window's capabilities allow: your code, any npm dependency, an XSS payload. The JS API is only a wrapper over `window.__TAURI_INTERNALS__`.

Capabilities limit the blast radius. Commands must still validate their own arguments.

## Commands and IPC

```rust
use tauri::Manager; // app.path()

#[derive(Debug, thiserror::Error)]
enum Error {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Tauri(#[from] tauri::Error),
    #[error("path not allowed")]
    Forbidden,
}

impl serde::Serialize for Error {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

#[tauri::command]
async fn import_notes(
    app: tauri::AppHandle,
    file_name: String,
    progress: tauri::ipc::Channel<u32>,
) -> Result<usize, Error> {
    let base = app.path().app_data_dir()?.join("imports").canonicalize()?;
    let path = base.join(&file_name).canonicalize()?;
    if !path.starts_with(&base) {
        return Err(Error::Forbidden);
    }
    progress.send(50)?;
    // ...
    Ok(0)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(Notes::default())
        .invoke_handler(tauri::generate_handler![import_notes, note_count])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

```ts
import { invoke, Channel } from '@tauri-apps/api/core';

const progress = new Channel<number>();
progress.onmessage = (pct) => setProgress(pct);
const count = await invoke<number>('import_notes', { fileName, progress }); // fileName → file_name
```

- **Registration.** Register every command in one `generate_handler!`; a second `invoke_handler` call replaces the first. Command names are global. Commands in `lib.rs` are not `pub`; commands in modules are `pub` and registered by path (`notes::note_count`).
- **Threading.** Synchronous commands run on the main thread, so file or network work inside one freezes the UI. Make such commands `async`, or mark them `#[tauri::command(async)]`.
- **Borrowed arguments.** An async command can't take borrowed arguments (`&str`, `State<'_, T>`) unless it returns `Result`. Take owned types or return `Result`.
- **Argument names.** JS keys are camelCase by default; `#[tauri::command(rename_all = "snake_case")]` changes that.
- **Errors.** Errors must implement `Serialize`: thiserror plus the manual impl above. A rejected `invoke` receives the serialized error.
- **Binary data.** Return large binary payloads as `tauri::ipc::Response::new(bytes)`. A plain `Vec<u8>` crosses as a JSON array of numbers.
- **Validation.** Validate every argument in Rust: canonicalize paths and check them against a base directory, allowlist URLs and commands, and cap sizes. Plugin scopes don't cover your own commands that call `std::fs` or `reqwest`.
- **Per-window access.** By default, every registered app command is callable from every window. To gate them per window, list them in `build.rs`. Tauri then generates allow and deny permissions for each command (look up the exact identifiers in `gen/schemas`), and capabilities must grant them:

```rust
fn main() {
    let manifest = tauri_build::AppManifest::new().commands(&["import_notes", "note_count"]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest))
        .expect("failed to run tauri-build");
}
```

## Capabilities and permissions

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "main-window",
  "windows": ["main"],
  "platforms": ["linux", "macOS", "windows"],
  "permissions": [
    "core:default",
    "store:default",
    { "identifier": "fs:allow-read-text-file", "allow": [{ "path": "$APPDATA/notes/**/*" }] },
    { "identifier": "http:default", "allow": [{ "url": "https://api.example.com/*" }] }
  ]
}
```

- **Default deny.** Plugin commands are denied until a permission grants them. Scoped plugins (fs, http, shell, opener) also need a scope; `fs:allow-*` without one fails with "forbidden path".
- **Active files.** Every file in `capabilities/` is active unless `app.security.capabilities` names the ones to use. Without that list, a leftover `migrated.json` or a dev-only capability ships too. List them explicitly.
- **Window labels.** Capabilities attach by window label, not title, and a window in several capabilities gets their union. Avoid `"windows": ["*"]` once there is more than one window. Give a window that shows less trusted content its own minimal capability.
- **Scopes.** `deny` beats `allow`, so deny secrets explicitly (`$HOME/.ssh/**`). In fs scopes `*` matches one level and `**/*` recurses; `..` traversal is rejected.
- **fs defaults.** `fs:default` only reads, and creates, the app's own directories: AppConfig, AppData, AppLocalData, AppCache and AppLog. Prefer the predefined sets such as `fs:allow-appdata-read-recursive` over broad hand-written scopes.
- **Remote origins.** `remote.urls` hands IPC to remote origins, so avoid it. On Linux and Android, Tauri can't tell an embedded iframe from the window.

## Official plugins

Each plugin needs four things: the crate, `.plugin(...)` in `run()`, the `@tauri-apps/plugin-*` package and a capability entry. `tauri add <name>` sets up all four.

| Plugin | Its default set allows | What you add yourself |
|--------|------------------------|-----------------------|
| fs | reading the app's own directories | write commands, scoped to exact paths |
| shell | `open` for http(s), mailto and tel links | `shell:allow-execute` or `allow-spawn` with `name`/`cmd`/`args` scopes |
| opener | opening http(s), mailto and tel URLs; revealing a file in its folder | `opener:allow-open-path` with a path scope |
| http | the fetch commands, but no origins at all | `allow`/`deny` URL scopes; the `unsafe-headers` feature only when required |
| store | load, get, set, save | nothing, but it is an unencrypted JSON file: no tokens or keys |
| updater | check, download, install | `pubkey` and `endpoints` config, plus the process plugin for `relaunch()` |

- **Shell arguments.** Write fixed args as strings and dynamic ones as `{ "validator": "<regex>" }`. `"args": true` allows anything, so never ship it.
- **Sidecars.** List them in `bundle.externalBin`; each binary carries a `-<target-triple>` suffix. Scope them as `{ "name": "binaries/tool", "sidecar": true }`.
- **Opening URLs.** Use the opener plugin; it replaces the shell plugin's `open`.
- **Secrets.** Keep secrets in the OS keychain (for example the `keyring` crate behind a command) or in `tauri-plugin-stronghold`. Never put them in the store or `localStorage`.

## State

```rust
type Notes = std::sync::Mutex<Vec<Note>>; // the alias keeps State<'_, Notes> in step with manage()

#[tauri::command]
fn note_count(notes: tauri::State<'_, Notes>) -> usize {
    notes.lock().unwrap().len()
}
```

- **Sharing.** `manage` already shares the value, so you don't need an `Arc`. Use `std::sync::Mutex` unless the guard must live across `.await`; then use `tokio::sync::Mutex`.
- **Type mismatches.** A mismatched state type isn't a compile error: `invoke` rejects with "state not managed", and `app.state::<T>()` panics. The alias prevents the mismatch.
- **Outside commands.** Get state through the `Manager` trait (`app_handle.state::<Notes>()`), and move a cloned `AppHandle` into threads and tasks.

## Events vs channels

- **Events** suit fan-out notifications. Send them with `use tauri::Emitter; app.emit("sync-status", &payload)?`, or `emit_to("main", ...)` for one webview. They carry small JSON payloads, have no types, and get no fine-grained capability control.
- **Channels** suit progress, logs, child-process output and any stream tied to one call. Pass a `tauri::ipc::Channel<T>` as a command argument, as above. Channels are ordered and fast.
- **Unlistening.** `listen()` in JS resolves to an unlisten function. Await it and call it on unmount; otherwise every React StrictMode remount adds another listener.

## CSP and webview hardening

```json
"app": {
  "security": {
    "csp": {
      "default-src": "'self'",
      "connect-src": "ipc: http://ipc.localhost https://api.example.com",
      "img-src": "'self' asset: http://asset.localhost data:"
    },
    "freezePrototype": true
  }
}
```

- **No default CSP.** There is no CSP until `app.security.csp` sets one. Tauri adds hashes and nonces for bundled scripts and styles at build time.
- **Required sources.** IPC needs `ipc: http://ipc.localhost` in `connect-src`, and WebAssembly needs `'wasm-unsafe-eval'` in `script-src`. Load no scripts from CDNs or other remote hosts.
- **Asset handling.** Keep `dangerousDisableAssetCspModification` false. The asset protocol stays off unless `assetProtocol.enable` is set; when you enable it, give it a narrow `scope`.
- **`withGlobalTauri`.** It defaults to false and only adds `window.__TAURI__`. Import from `@tauri-apps/api` instead, and don't treat the setting as a security control either way.
- **Isolation pattern.** For apps with large npm dependency trees, use `"pattern": { "use": "isolation", "options": { "dir": "../dist-isolation" } }`. A sandboxed hook then sees, and can reject, every IPC message before Rust does.

## Mobile, briefly

- **Setup.** Run `tauri android init` or `tauri ios init` (iOS needs macOS with Xcode), then `tauri android dev` or `tauri ios dev`. The entry point is `run()` in `lib.rs`; keep desktop-only code behind `#[cfg(desktop)]`.
- **Physical devices.** The dev server must listen on `TAURI_DEV_HOST`. In Vite, set `server.host = process.env.TAURI_DEV_HOST || false`.
- **Platform limits.** Split capabilities with `platforms`. The updater and global shortcuts are desktop-only. On mobile, the shell plugin can only open URLs and fs is limited to the app's own folders.

## Bundling, signing and updates

- **Build.** `tauri build` produces the installers listed in `bundle.targets`. Settle the reverse-DNS `identifier` before the first release, because it names the app data directories.
- **Windows signing:**
  - Sign with `bundle.windows.certificateThumbprint`, `digestAlgorithm` and `timestampUrl`, or with `signCommand` (Azure Artifact Signing, Key Vault). `signCommand` is required when building on Linux or macOS.
  - EV certificates no longer skip SmartScreen reputation.
  - `webviewInstallMode` defaults to downloading the WebView2 bootstrapper. Offline installers need `embedBootstrapper` or `offlineInstaller`.
- **macOS signing:**
  - Sign with a Developer ID identity set in `APPLE_SIGNING_IDENTITY`. In CI, import the certificate from `APPLE_CERTIFICATE` and `APPLE_CERTIFICATE_PASSWORD`.
  - Notarize with `APPLE_API_ISSUER`, `APPLE_API_KEY` and `APPLE_API_KEY_PATH`, or with `APPLE_ID`, `APPLE_PASSWORD` and `APPLE_TEAM_ID`.
  - Ad-hoc signing (`"-"`) still triggers Gatekeeper prompts.
- **Updater setup:**
  - Generate a key pair with `tauri signer generate -w ~/.tauri/app.key`.
  - In CI, provide `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` as real environment variables; `.env` files are ignored.
  - Set `bundle.createUpdaterArtifacts: true`, put the public key's contents (not a path) in `plugins.updater.pubkey`, and use HTTPS `endpoints`.
- **Updater key.** The update signature can't be disabled, and losing the private key strands every installed copy, so store the key like a production secret. It is separate from OS code signing; you need both.
- **Update flow.** v2 has no automatic update check and no dialog. Call `check()`, then `downloadAndInstall()` and `relaunch()`, or users never update.
- **Update manifests.** A static manifest needs `version`, plus a `url` and the signature file's contents for each `os-arch` key. A dynamic server answers 204 when there is nothing new.

## Testing

- **Rust.** Keep command bodies thin and test the logic as plain Rust. For IPC-level tests, enable the `tauri` feature `test` and drive commands through `tauri::test::mock_builder()` and `get_ipc_response`.
- **Frontend.** In unit tests, use `mockIPC((cmd, args) => ...)` from `@tauri-apps/api/mocks` and call `clearMocks()` after each test. jsdom needs a `window.crypto.getRandomValues` polyfill.
- **End to end.** WebDriver drives the app directly on Windows and Linux; macOS has no desktop WebDriver client. Build in CI with `tauri-action` on each target OS.
- **Checks.** Run `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` and `cargo test --manifest-path src-tauri/Cargo.toml`, plus the frontend's own tests and type check.

## Migrating from Tauri 1

`tauri migrate` automates most of the mechanical work and converts the v1 allowlist into a capability file. Treat its output as a draft. Whatever v1 allowed, such as `all: true` or a fs scope covering the whole home directory, stays allowed. The usual security mistakes:

- Shipping the migrated capability unchanged, applied to every window.
- "Fixing" IPC for a hosted frontend by adding its origin to `remote.urls`.
- Replacing a scoped plugin call with a custom command that accepts any path, URL or command line.
- Leaving `csp` null, or keeping v1 shell scopes as `args: true`.
- Forgetting the update flow. v2 dropped the built-in dialog, and apps already shipped on v1 need `createUpdaterArtifacts: "v1Compatible"` until every user has moved.

Read `references/migrating-from-v1.md` when doing a migration. It has the full list of config, JS and Rust renames, plus the Windows origin change that resets `localStorage`.

## Review checklist

- [ ] Capabilities name specific windows and platforms; `app.security.capabilities` lists the active ones
- [ ] Every fs, http, shell and opener permission has a narrow scope; sensitive paths are denied
- [ ] Commands validate paths, URLs and sizes; none runs arbitrary commands or opens arbitrary paths
- [ ] Heavy commands are async; errors serialize; secrets stay out of the store and `localStorage`
- [ ] CSP is set, includes the IPC sources and has no remote script hosts
- [ ] App commands are gated with `AppManifest::commands` when windows differ in trust
- [ ] The updater key lives in CI secrets, `pubkey` and HTTPS endpoints are configured, and the app calls `check()`
- [ ] Release builds are signed, and notarized on macOS
- [ ] Event listeners are removed on unmount; streams use channels

<!-- Written for legacies (MIT). Checked against: https://v2.tauri.app/security/capabilities/, https://v2.tauri.app/security/permissions/, https://v2.tauri.app/develop/calling-rust/, https://v2.tauri.app/develop/calling-frontend/, https://v2.tauri.app/develop/state-management/, https://v2.tauri.app/security/csp/, https://v2.tauri.app/plugin/file-system/, https://v2.tauri.app/plugin/shell/, https://v2.tauri.app/plugin/opener/, https://v2.tauri.app/plugin/http-client/, https://v2.tauri.app/plugin/store/, https://v2.tauri.app/plugin/updater/, https://v2.tauri.app/develop/sidecar/, https://v2.tauri.app/distribute/sign/windows/, https://v2.tauri.app/distribute/sign/macos/, https://v2.tauri.app/develop/tests/mocking/, https://v2.tauri.app/start/migrate/from-tauri-1/, https://docs.rs/tauri-build/latest/tauri_build/struct.AppManifest.html, 2026-10 -->
