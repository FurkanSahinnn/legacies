# Migrating a Tauri 1 app to Tauri 2

Read this when you are moving a project from Tauri 1 to Tauri 2. For day-to-day Tauri 2 work, SKILL.md is enough.

## Order of work

1. Commit. Install the v2 CLI, then run `npm run tauri migrate` (or `cargo tauri migrate`) from the project root. It automates most of the mechanical work and turns the v1 allowlist into a capability file. The official guide doesn't list everything it changes, so diff the result and walk through the tables below.
2. Restructure the entry point:
   - Move the app setup into `src-tauri/src/lib.rs` as `pub fn run()`, annotated with `#[cfg_attr(mobile, tauri::mobile_entry_point)]`.
   - Add `[lib]` with `crate-type = ["staticlib", "cdylib", "rlib"]` to `Cargo.toml`.
   - Reduce `main.rs` to a call to `run()`, keeping the `windows_subsystem` attribute.
3. Install a plugin for every v1 API module the app used (`tauri add fs`, `tauri add dialog`, ...). Then fix the JS imports.
4. Rewrite the generated capability by hand. Use one file per window role, with scopes as narrow as the old code really needed. List the files in `app.security.capabilities`, and delete the generated one.
5. Rebuild the update flow, then test it from a real installed v1 build: download, verify the signature, install, relaunch.
6. Check persisted data on Windows (see "Behavior changes").

## Config keys (`tauri.conf.json`)

| Tauri 1 | Tauri 2 |
|---------|---------|
| `package.productName`, `package.version` | top-level `productName`, `version`; also add `mainBinaryName`, because the binary is no longer renamed for you |
| `tauri` | `app` |
| `tauri.allowlist` | removed: capability files in `src-tauri/capabilities/` |
| `tauri.bundle` | top-level `bundle` |
| `tauri.bundle.identifier` | top-level `identifier` |
| `tauri.bundle.dmg` | `bundle.macOS.dmg` |
| `tauri.bundle.deb`, `tauri.bundle.appimage` | `bundle.linux.deb`, `bundle.linux.appimage` |
| `tauri.cli` | `plugins.cli` |
| `tauri.updater` | `plugins.updater`; `active` and `dialog` are gone |
| `tauri.systemTray` | `app.trayIcon` |
| `tauri.security.*` (CSP, pattern, asset scope) | `app.security.*`: asset scope under `app.security.assetProtocol.scope`, pattern under `app.security.pattern` |
| `tauri.windows[].fileDropEnabled` | `app.windows[].dragDropEnabled` |
| `build.withGlobalTauri` | `app.withGlobalTauri` |
| `build.distDir` | `build.frontendDist` |
| `build.devPath` | `build.devUrl` |
| license keys | `bundle.licenseFile` |
| `webviewFixedRuntimePath` | `bundle.windows.webviewInstallMode` |

## JavaScript API

| Tauri 1 | Tauri 2 |
|---------|---------|
| `@tauri-apps/api/tauri` (`invoke`) | `@tauri-apps/api/core` |
| `@tauri-apps/api/window` | `@tauri-apps/api/webviewWindow` |
| `cli`, `clipboard`, `dialog`, `fs`, `globalShortcut`, `http`, `notification`, `os`, `process`, `shell`, `updater` modules | `@tauri-apps/plugin-<name>` packages, each with a Rust plugin and permissions |
| fs `createDir` | `mkdir` |
| fs `readBinaryFile` / `writeBinaryFile` | `readFile` / `writeFile` |
| fs `removeFile` / `removeDir` | `remove` |
| fs `renameFile` | `rename` |
| shell `open` | the opener plugin |

## Rust API

| Tauri 1 | Tauri 2 |
|---------|---------|
| `Window`, `WindowBuilder`, `WindowUrl` | `WebviewWindow`, `WebviewWindowBuilder`, `WebviewUrl` |
| `Manager::get_window` | `Manager::get_webview_window` |
| `parent_window` | `parent_raw` |
| `tauri::api::path`, `PathResolver` | `app.path()` from the `Manager` trait |
| `tauri::api::process::restart` | `tauri::process` |
| `App::global_shortcut_manager`, `clipboard_manager`, `get_cli_matches` | the matching plugins |
| `Manager::fs_scope` | `tauri_plugin_fs::FsExt` |
| `SystemTray`, tray `on_event` | `tray::TrayIconBuilder` with `on_menu_event` and `on_tray_icon_event` |
| menu types, `Builder::on_menu_event` | `tauri::menu` builders (`MenuBuilder`, `SubmenuBuilder`, `MenuItemBuilder`, `PredefinedMenuItem`); `App::on_menu_event` or `AppHandle::on_menu_event` |
| `tauri::updater` | `tauri_plugin_updater::UpdaterExt` |
| `listen_global` | `listen_any` |

## Events

- `emit` now reaches every listener. Use `emit_to` for a specific target, and `emit_filter` to pick targets with a predicate over `EventTarget`.
- In JS, `WebviewWindow.listen` only receives events aimed at that window. The global `listen` from `@tauri-apps/api/event` behaves like `listen_any` unless you give it a target.
- High-volume streams that v1 apps pushed through events should become `tauri::ipc::Channel` arguments.

## Behavior changes that bite after the build succeeds

- **Windows origin.** The webview origin on Windows is now `http://tauri.localhost`. `localStorage`, IndexedDB and cookies written by the v1 app are therefore not visible, unless you set `app.windows[].useHttpsScheme: true` to keep the old origin.
- **Updater.** The built-in update dialog and the automatic check are gone. If the app never calls `check()`, users silently stop receiving updates.
  - Set `bundle.createUpdaterArtifacts` to `"v1Compatible"` while v1 installs still need to update. Switch it to `true` once they are gone; `v1Compatible` is slated for removal in v3.
- **Commands and plugins.** The v1 `process-command-api` and `shell-open-api` features are now `tauri-plugin-shell`, and opening URLs is now the opener plugin. Both need explicit permissions.
- **Remote content.** In v2, remote origins get IPC access only through a capability's `remote.urls` entry. Prefer bundling the frontend over granting it.

## Security review of the migrated capability

- Split it by window. A settings window doesn't need the permissions the main window has.
- Replace each broad scope (`$HOME/**`, `**`, `"args": true`) with the exact paths, URLs or argument validators the code uses.
- Add `deny` entries for sensitive locations if any broad read scope must remain.
- Confirm `csp` is set and includes `ipc: http://ipc.localhost` in `connect-src`.
- Search the Rust side for commands that take raw paths, URLs or shell strings, and add validation or move them to scoped plugins.
