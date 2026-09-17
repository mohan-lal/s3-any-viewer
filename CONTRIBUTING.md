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
