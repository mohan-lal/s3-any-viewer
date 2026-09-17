# Security

Written for people who evaluate browser extensions before allowing them near production data. It covers how the extension handles the bytes it displays, what it is permitted to do, and how to check both.

## Data flow

```
 S3 console tab                                Viewer tab (extension page)
 ──────────────                                ───────────────────────────
 user clicks "Open"
   │
   ▼
 console signs a URL for this one object
 (GET only, expires in minutes)
   │
   ▼
 window.open(https://bucket.s3.region.amazonaws.com/key?X-Amz-Signature=…)
   │
   │  declarativeNetRequest: main-frame URL on *.amazonaws.com
   │  containing X-Amz-Signature= → redirect
   ▼
 chrome-extension://…/viewer.html#u=<that URL>
                                                 │ read URL from the fragment
                                                 │ fetch(url, { credentials: "omit" }) ── one GET ──► S3
                                                 │ detect format, render from tab memory
                                                 │ tab closed → memory released
```

The presigned URL stays in the URL fragment, which browsers do not send in requests or `Referer` headers, and is removed from the address bar by `history.replaceState` once loading starts.

## Permissions

From `src/manifest.json`.

| Permission | Purpose | Scope |
|---|---|---|
| `declarativeNetRequest` | Redirect presigned S3 navigations to the viewer | Declarative rules only; request and response contents are not observable through this API |
| `storage` | Two on/off settings | Nothing else is written |
| `contextMenus` | "Open link in S3 Any Viewer" entry | |
| Host `*://*.amazonaws.com/*`, `*://*.amazonaws.com.cn/*` | Fetch the object bytes | S3 endpoints; the console domain `console.aws.amazon.com` is not covered |
| Optional host `<all_urls>` | Files on S3-compatible stores, CloudFront or other hosts | Not granted at install; requested per origin when the user opens such a URL; revocable under Details → Site access |

Not requested: `cookies`, `tabs`, `history`, `downloads`, `identity`, `webRequest`, `scripting`, `nativeMessaging`. There is no `content_scripts` section.

Content Security Policy for extension pages: `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'`. Remote scripts cannot load. `wasm-unsafe-eval` covers the bundled Snappy decompressor used for Parquet.

## Rendering untrusted content

Object contents are treated as hostile input.

- HTML is previewed in an `<iframe>` with an empty `sandbox` attribute.
- Markdown is converted with `marked` and sanitised with DOMPurify.
- SVG is displayed through `<img>`; the source view is plain text.
- All other renderers build DOM nodes with `textContent`.
- PDF, images, audio and video use `blob:` URLs handed to the browser's own decoders, revoked when the view changes.

## Threat model

| Scenario | Observable check |
|---|---|
| Exfiltration of object contents by a tampered build | A second network destination in DevTools → Network of the viewer tab, and a diff against this repository. Host permissions limit fetch targets to AWS hosts plus origins the user granted. |
| Access to the console session | Requires `cookies` or a content script on the console domain. Adding either changes the manifest and triggers a Chrome permission warning on update. |
| Persistence of object data | DevTools → Application shows empty storage for the extension origin; `chrome.storage.sync` holds two booleans. |

Out of scope: a compromised browser profile, a co-installed extension with broader permissions, or a compromised AWS account.

## Verification

1. **Manifest.** Compare `permissions`, `host_permissions` and the absence of `content_scripts` in the installed copy with the table above.
2. **Network.** Open an object, press F12 in the viewer tab, Network, reload. Expected: one GET to the object host (plus a 1-byte range probe), no `Cookie` request header.
3. **Storage.** DevTools → Application → Storage for the extension origin. Expected: empty. In the service-worker console, `chrome.storage.sync.get(null, console.log)` prints two booleans.
4. **Provenance.** Confirm the installed package was built from this repository, below.

## Verifying a release package

Tagged releases are built by `.github/workflows/build.yml` on GitHub-hosted runners from the tagged commit. Each release carries the zip, a `SHA256SUMS.txt` with one line per file inside it, and a build provenance attestation signed by GitHub.

```bash
gh attestation verify s3-any-viewer-<version>.zip --owner mohan-lal
```

The Chrome Web Store repackages the zip into a signed CRX and adds a `_metadata/` folder, so compare per-file hashes rather than the container. On Windows the installed files are under `%LOCALAPPDATA%\Google\Chrome\User Data\<Profile>\Extensions\<id>\<version>_0\`:

```powershell
Get-ChildItem -Recurse -File | Where-Object FullName -notmatch '\\_metadata\\' | Get-FileHash -Algorithm SHA256
```

`npm ci && npm run build` on the tagged commit produces a `dist/` with the same per-file hashes.

## Deploying in regulated environments

Organisations that do not install from public stores can build from a reviewed commit and distribute through Chrome Enterprise policy (`ExtensionInstallForcelist`, or `ExtensionSettings` with `installation_mode: force_installed` and a self-hosted `update_url`). Pin the version. Remove `optional_host_permissions` from the manifest before building if per-site access is not wanted. Outbound filtering that allows only AWS endpoints does not affect the extension.

The extension performs the same action as the console's **Open** button, in the same browser, and renders instead of saving to disk. It does not bypass a policy that forbids **Open** or mandates S3 Select or a VDI; in those environments, deploy it inside the approved environment.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting for this repository rather than a public issue. Include the extension version, browser version and reproduction steps. Do not include presigned URLs or object contents.
