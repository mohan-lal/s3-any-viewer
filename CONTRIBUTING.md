# Contributing

Thanks for taking the time to improve S3 Any Viewer.

## Getting started

```bash
git clone https://github.com/mohan-lal/s3-any-viewer.git
cd s3-any-viewer
npm install
npm run build
```

Load the `dist` folder as an unpacked extension from `chrome://extensions` (enable Developer mode first). After every rebuild, click **Reload** on the extension card.

## Development loop

```bash
npm run watch                 # rebuild JS on change (HTML/CSS are copied once; re-run for those)
npm run fixtures              # generate sample files of every format into ./fixtures
npm run serve                 # serve dist + fixtures on http://localhost:8765
```

With the dev server running you can exercise the viewer in an ordinary tab, without the extension:

```
http://localhost:8765/viewer.html#u=http://localhost:8765/fixtures/users.csv
```

Append `?ct=application/octet-stream` to a fixture URL to test detection without a content type, `?gz=1` to test gzip unwrapping, or `?attachment=1` to mimic a download-only response.

## Tests

```bash
npm test
```

This builds the extension, generates the fixtures, packages the release zip and then runs every suite (Node 22 or newer and an installed Google Chrome are required; set `CHROME_PATH` if Chrome is somewhere unusual):

| Suite | Covers |
|---|---|
| `detect` | Magic bytes, extensions, content types and text sniffing for every format |
| `decompress` | gzip, zstd and Brotli unwrapping, including the size guard |
| `background` | The interception rules the service worker installs, checked against real console, download and non-AWS URLs |
| `package` | Manifest limits, every referenced file present, imports resolve, permissions and CSP unchanged, zip matches `dist` |
| `viewer-formats` | Every fixture opens in the right view with no console errors |
| `viewer-features` | Tabs, search, nested search, filters, sorting, export, Copy, Download, local files, archives, large and ranged files |
| `popup` | Settings, per-site permission requests and the open-URL form |

The browser suites drive Chrome headless with a throwaway profile against the built `dist` served over `localhost` with the extension's own Content-Security-Policy. They never install the extension and never touch your Chrome profile.

### Load-time benchmark

When the tests pass, `npm test` then compares how fast files open in this build against the version live on the Chrome Web Store (about a minute). It asks the store which version is live, only the version number, and uses that version's zip from `./release`. Each file is opened three times in each build and the median is shown: `▲ slower` in red, `▼ faster` in green, and a different default view in yellow. A copy is saved to `.bench/report.md`. Run it on its own with `npm run bench`, or skip it with `SKIP_BENCH=1`.

It only reports and never fails the run. It runs locally only; on GitHub it is skipped, since shared machines vary too much to compare timings. Keep the zip of each published version in `./release`, and bump the version when starting new work, as `npm test` rebuilds the zip of the current version.

### Before a release

A few things only exist inside an installed extension and are checked by hand. Load `dist` unpacked from `chrome://extensions` (Developer mode on), then:

1. In the S3 console, select a CSV object and click **Open**. It opens formatted in the viewer.
2. Click **Download** for the same object. The file downloads normally and is not intercepted.
3. Right-click a link to an S3 object and choose **Open link in S3 Any Viewer**. It opens in the viewer.
4. From the toolbar popup, open a URL on a non-AWS site. Chrome asks for access to that one site, and the file opens after you allow it.

## Adding a renderer

1. Create `src/renderers/<name>.js` exporting `async function render<Name>(ctx)`. The `ctx` object gives you `bytes`, `name`, `ext`, `text()`, `mount`, `toolbar`, `setStatus`, `showProgress`, `hideProgress`, `openSub` and `rerender`. Return an object with an optional `destroy()`.
2. Register it in `src/renderers/index.js`.
3. Add the format, its label and its extensions to `src/lib/formats.js`. Add magic bytes to `src/lib/detect.js` if the format has them.
4. Add a fixture to `scripts/make-fixtures.mjs` and check it renders.
5. Update the format table in `README.md` and add a line to `CHANGELOG.md`.

Tabular formats should reuse `renderTable` from `src/lib/vtable.js` and `objectsToTable` from `src/lib/util.js` so they get sorting, filtering and export for free.

## Guidelines

- No remote code and no network requests other than fetching the object. The extension must keep working with only the `*.amazonaws.com` host permission.
- Never store AWS credentials. Interception works from the presigned URL the console already produces.
- Anything rendered from object content must be inert: HTML goes into a fully sandboxed iframe, Markdown is sanitized, SVG is shown through `<img>`.
- Keep the bundle lean. Import highlight.js languages individually and prefer small, dependency-free libraries.
- Keep the code plain ES modules with no framework. `esbuild` is the only build tool.

## Reporting issues

Please include the object's file extension, its `Content-Type` as shown in the viewer header, the "Detected" line from the status bar and any error text shown in the page. Do not paste presigned URLs into issues; they grant access to the object until they expire.
