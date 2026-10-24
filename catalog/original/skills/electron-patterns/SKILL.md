---
name: electron-patterns
description: Electron 45 desktop app patterns covering the main, renderer, preload and utility processes, secure webPreferences (contextIsolation, sandbox, nodeIntegration off), contextBridge APIs, IPC sender validation, CSP, custom protocols, fuses, Forge 8 or electron-builder packaging, code signing and notarization, auto-update, and startup and memory performance. Use when package.json depends on electron, when editing main or preload code, BrowserWindow options, ipcMain handlers or forge.config, or when reviewing a desktop app's security.
---

# Electron

Targets **Electron 45** (stable on 2026-10-20, with Chromium 156 and Node 24.22). A new major ships about every 8 weeks, and only the latest three get fixes (45, 44 and 43 now; 42 reached end of life on 2026-10-20). Check `electron` in `package.json` and read the breaking-changes page for each major you cross. **Electron Forge 8** (2026-09-29) is ESM-only and needs Node 22.17+. Renderer UI code follows its framework's pack (React, Vue); this skill covers the Electron layer.

## Process model

| Process | What it is | Rules |
|---|---|---|
| main | one Node.js process that owns the app: windows, menus, dialogs, `ipcMain`, `protocol`, `safeStorage` | never block it with sync I/O or CPU loops: window handling and IPC stall for the whole app |
| renderer | one Chromium process per page, sandboxed, web APIs only | treat it like an untrusted browser tab |
| preload | runs before page scripts in the renderer, in an isolated world | exposes a small, typed API through `contextBridge`; no business logic |
| utility | a Node child started with `utilityProcess.fork()` after `ready` | CPU-heavy or crash-prone work, native modules, services; talks over `postMessage` and MessagePorts |

## Secure window defaults

```ts
const win = new BrowserWindow({
  width: 1100,
  height: 760,
  show: false,
  webPreferences: {
    preload: path.join(__dirname, 'preload.cjs'), // import.meta.dirname in an ESM main
    // These are the defaults. State them so nobody flips them.
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
  },
});
win.once('ready-to-show', () => win.show());
await win.loadURL(app.isPackaged ? 'app://bundle/index.html' : DEV_SERVER_URL);
```

- Never set `nodeIntegration: true`, `contextIsolation: false`, `sandbox: false`, `webSecurity: false`, `allowRunningInsecureContent`, `experimentalFeatures` or `enableBlinkFeatures` to make something work. Turning context isolation off also turns the sandbox off.
- `app.enableSandbox()` before `ready` forces the sandbox on every renderer.
- Load remote sites only over HTTPS, in a window without your preload, or not at all.

## Preload and contextBridge

```ts
// preload.ts: bundle to CommonJS, because sandboxed preloads can't use ESM imports
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

contextBridge.exposeInMainWorld('notesApi', {
  save: (id: string, text: string): Promise<void> => ipcRenderer.invoke('notes:save', { id, text }),
  pickFile: (): Promise<string | null> => ipcRenderer.invoke('dialog:pick-file'),
  onSyncStatus(callback: (status: string) => void) {
    const listener = (_event: IpcRendererEvent, status: string) => callback(status);
    ipcRenderer.on('sync:status', listener);
    return () => {
      ipcRenderer.removeListener('sync:status', listener); // block body: don't return ipcRenderer
    };
  },
});
```

- Expose one function per operation, with a fixed channel. Never expose `ipcRenderer` itself (it can't cross the bridge since 29), a generic `invoke(channel, ...args)`, `require`, `shell`, `fs` or Node objects.
- Wrap listeners so the page never receives the `IpcRendererEvent`, which carries `sender`, and return an unsubscribe function.
- Bridged values are copied and frozen. Functions are proxied, Promises work, Errors lose custom properties, and classes, prototypes and Symbols don't survive. Pass plain data.
- Type the API for the renderer in a `.d.ts` (`interface Window { notesApi: NotesApi }`).
- An ESM preload needs `sandbox: false` and a `.mjs` file. Keep preloads sandboxed and bundled instead. On 45, sandboxed preloads have no `events`, `timers` or `url` shims and no `Buffer` or `setImmediate` globals.
- Per-session preloads use `session.registerPreloadScript()` (35+), not `setPreloads()`. For a dropped file's path, call `webUtils.getPathForFile(file)` in the preload; `File.path` was removed in 32.

## IPC handlers in main

```ts
const TRUSTED_ORIGINS = new Set(['app://bundle']); // add the dev server origin only when !app.isPackaged
const SaveNote = z.object({ id: z.string().min(1), text: z.string().max(100_000) });

function assertTrustedSender(event: IpcMainInvokeEvent) {
  const origin = event.senderFrame?.origin; // senderFrame is null once the frame is gone
  if (!origin || !TRUSTED_ORIGINS.has(origin)) throw new Error('Untrusted IPC sender');
}

ipcMain.handle('notes:save', async (event, payload: unknown) => {
  assertTrustedSender(event);
  const { id, text } = SaveNote.parse(payload);
  await notes.save(id, text);
});
```

- Use `invoke`/`handle` for request and response, `webContents.send` for pushes from main (check `win.isDestroyed()` first), and MessagePorts for streams or renderer-to-renderer traffic. Never use `sendSync`.
- Validate the sender's `origin`, not its URL: `about:blank`, `blob:` and sandboxed documents don't identify who controls them. Read `senderFrame` before any `await`, because it may be detached later.
- Validate every payload as attacker-controlled. Accept ids, not file paths or SQL; when a path is unavoidable, resolve it and confirm it stays inside an allowed directory.
- A thrown error reaches the renderer as its message only. Return `{ ok: false, code }` objects for expected failures.
- `webContents.ipc.handle` scopes a handler to one window when only that window may call it.

## Navigation, new windows, permissions and CSP

```ts
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== APP_ORIGIN) event.preventDefault();
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternal(url)) void shell.openExternal(url); // https: and known hosts only
    return { action: 'deny' };
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
});

session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
  callback(ALLOWED_PERMISSIONS.has(permission)); // without a handler, every request is granted
});
```

- Ship a Content-Security-Policy such as `default-src 'self'; script-src 'self'`, without `'unsafe-eval'` or `'unsafe-inline'` in `script-src`. Send it as a header (`session.webRequest.onHeadersReceived`) where you control responses, otherwise as a `<meta http-equiv>` tag in `index.html`.
- Also add a `setPermissionCheckHandler`. Since 45, screen capture requests arrive as `display-capture` instead of `media`.

## Serve the app from a custom protocol, not file://

```ts
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]); // must run before 'ready'

app.whenReady().then(() => {
  protocol.handle('app', (request) => {
    const file = path.resolve(RENDERER_DIR, '.' + decodeURIComponent(new URL(request.url).pathname));
    const rel = path.relative(RENDERER_DIR, file);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return new Response(null, { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
});
```

`protocol.handle` replaced `registerFileProtocol` and the other `register*Protocol`/`intercept*Protocol` APIs in 25. The relative-path check blocks `../` traversal.

## Fuses

Fuses are flags in the Electron binary, flipped at package time before signing. Forge templates include `@electron-forge/plugin-fuses`, and electron-builder has an `electronFuses` config block (an `afterPack` hook calling `flipFuses` from `@electron/fuses` also works). Turn off `RunAsNode`, `EnableNodeOptionsEnvironmentVariable` and `EnableNodeCliInspectArguments`; turn on `EnableCookieEncryption`, `EnableEmbeddedAsarIntegrityValidation` and `OnlyLoadAppFromAsar`; turn off `GrantFileProtocolExtraPrivileges` when nothing loads from `file://`. Check a build with `npx @electron/fuses read --app <path>`.

## Packaging, signing and updates

- **Forge 8**: `npx create-electron-app@latest my-app --template vite --typescript`, configured in `forge.config.ts`. The Vite plugin is stable and targets Vite 8, and it emits `main.cjs` and `preload.cjs` (`"main": ".vite/build/main.cjs"`). `electron-forge publish` became `release` (the old name is a deprecated alias), and config strings are no longer lodash templates. DMG and PKG output moved to `out/make/<format>/<arch>/`.
- **electron-builder** (26.x): `build` config in `package.json` or `electron-builder.yml`, NSIS, DMG and AppImage targets, `electron-updater` for updates. It is often paired with `electron-vite`. Use one toolchain per app.
- Only `dependencies` are packaged. Native modules must match Electron's ABI: both toolchains rebuild them when packaging, and `electron-builder install-app-deps` covers development installs. Keep the app in asar.
- Since 42, the `electron` npm package downloads its binary on first run instead of in `postinstall`, and `ELECTRON_SKIP_BINARY_DOWNLOAD` is ignored. Cache accordingly in CI.
- **macOS**: sign with a Developer ID certificate and hardened runtime, then notarize through `@electron/notarize` (Forge: `packagerConfig.osxSign` and `osxNotarize`; electron-builder: its `mac` signing options). Unsigned builds can't auto-update, and `safeStorage` or Keychain may prompt again after every update.
- **Windows**: code-signing keys must live in hardware or a cloud HSM, so CI usually signs through a cloud signing service. Azure Artifact Signing (formerly Trusted Signing) is the cheapest option where it's available and clears SmartScreen warnings. Forge and Packager pass a `windowsSign` config to `@electron/windows-sign`.
- Keep certificates and notarization credentials in CI secrets, never in the repo.
- **Updates**: for a public GitHub repo, use `update-electron-app` with update.electronjs.org (macOS builds must be signed). For S3-style storage, use `update-electron-app` with `UpdateSourceType.StaticStorage` and Forge publishers that write `RELEASES` and `releases.json`. electron-builder apps use `electron-updater`, which also covers AppImage. The built-in `autoUpdater` (Squirrel.Mac and Squirrel.Windows) has no Linux support.
- Check for updates only when `app.isPackaged`, handle the `error` event, and let the user choose when to restart. Squirrel.Windows installs also need first-run handling (`electron-squirrel-startup` in Forge templates).

## Performance

- Startup: bundle main and preload into single files, load heavy modules with `await import()` when first needed, do no sync I/O before the first window, and show windows on `ready-to-show`. Call `Menu.setApplicationMenu(null)` before `ready` when the app doesn't use the default menu.
- Keep CPU and disk work off the main process: async `fs`, a `utilityProcess` or `worker_threads`. In renderers, use Web Workers for heavy work and `requestIdleCallback` for small tasks.
- Don't ship polyfills: set the bundler target to the Chromium version in your Electron. Ship fonts and static assets with the app instead of fetching them.
- Memory: each window is a renderer process. Close windows you no longer need instead of hiding many of them, remove IPC listeners on unmount, and watch `app.getAppMetrics()` per process.

## Testing and commands

- Forge: `npm start` (`electron-forge start`), `npm run package`, `npm run make`, `npm run release`. electron-builder: `electron-builder --dir` builds an unpacked app for smoke tests.
- Unit-test main-process logic as plain Node modules (Vitest), with Electron APIs behind thin adapters you can fake.
- E2E: Playwright's `_electron.launch({ args: ['.'] })` (experimental, Electron 21+) or the WebdriverIO Electron service. Run the packaged app at least once per release, because fuses, asar and signing only exist there.
- Typecheck main and preload (Node and Electron types) separately from the renderer (DOM types).

## Common security mistakes

1. Turning on `nodeIntegration` or turning off `contextIsolation` or `sandbox` so the renderer can `require`. Move the Node work to main and expose a narrow bridge.
2. `exposeInMainWorld('ipc', ipcRenderer)` or a generic `send(channel, data)` bridge. Expose specific functions with fixed channels.
3. Handlers without sender or payload checks, such as `fs:read` with a renderer-chosen path. Check the origin, validate input and constrain paths.
4. `shell.openExternal(url)` on untrusted URLs, which can launch local programs. Allowlist the schemes and hosts.
5. Missing `will-navigate` and `setWindowOpenHandler` handlers, so an XSS can navigate a privileged window to an attacker's page. Deny by default.
6. Remote content in a window that has a preload, or a `<webview>` with `allowpopups` or attacker-controlled preferences.
7. `webSecurity: false` to get around CORS. Proxy the request through main with `net.fetch`, or fix the server.
8. Loading the UI from `file://` with default fuses. Use a custom protocol and flip the fuses.
9. API keys bundled in the app, where anyone can read them from the asar. Keep secrets on a server; store user tokens with the async `safeStorage` methods (`encryptStringAsync`, `decryptStringAsync`). The sync methods are deprecated in 45 and slated for removal in 46.
10. `webContents.executeJavaScript` with interpolated strings, or `innerHTML` with IPC data. Pass data, not code.
11. Running an Electron major that no longer gets fixes, so Chromium vulnerabilities stay unpatched.

## Recent breaking changes worth knowing

- 44: the `clipboard` module is no longer exposed to renderer processes. Use `navigator.clipboard`, or expose a narrow helper through `contextBridge`. macOS 12 support, Windows ia32 and Linux armv7l builds are gone.
- 45: `window.open()` children of unsandboxed windows get their own sandboxed process, and `contentTracing` writes Perfetto protobuf only.
- 33+: `event.senderFrame` can be `null` when the frame navigated or was destroyed.

## Review checklist

- [ ] `contextIsolation`, `sandbox` and `webSecurity` are on and `nodeIntegration` is off in every window.
- [ ] The preload exposes specific functions only, and listeners strip the event object.
- [ ] Every `ipcMain` handler checks `senderFrame.origin` and validates its payload.
- [ ] Navigation, new windows, webviews, permissions and `shell.openExternal` are deny-by-default.
- [ ] The UI loads from a custom protocol with a CSP; fuses are flipped and verified on the packaged app.
- [ ] Builds are signed (and notarized on macOS) with credentials from CI secrets, and updates run only when packaged.
- [ ] No sync I/O or heavy CPU work on the main process; Electron is a supported major.

<!-- Written for legacies (MIT). Checked against: https://releases.electronjs.org/schedule, https://www.electronjs.org/docs/latest/breaking-changes, https://www.electronjs.org/docs/latest/tutorial/security, https://www.electronjs.org/docs/latest/tutorial/ipc, https://www.electronjs.org/docs/latest/api/context-bridge, https://www.electronjs.org/docs/latest/api/utility-process, https://www.electronjs.org/docs/latest/api/protocol, https://www.electronjs.org/docs/latest/api/web-frame-main, https://www.electronjs.org/docs/latest/api/safe-storage, https://www.electronjs.org/docs/latest/tutorial/esm, https://www.electronjs.org/docs/latest/tutorial/fuses, https://www.electronjs.org/docs/latest/tutorial/code-signing, https://www.electronjs.org/docs/latest/tutorial/updates, https://www.electronjs.org/docs/latest/tutorial/performance, https://github.com/electron/forge/releases/tag/v8.0.1, https://playwright.dev/docs/api/class-electron, 2026-10 -->
