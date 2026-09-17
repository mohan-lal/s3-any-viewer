# Privacy Policy

S3 Any Viewer is a browser extension that displays files from Amazon S3 inside the browser.

## Data handling

- The extension does not collect, transmit or store any personal data, browsing history or file contents.
- The only network request the extension makes is the HTTP GET (or range GET) for the object you chose to open, sent to the same presigned URL the AWS console generated. This request would have happened anyway when the console opened the file.
- Object contents are parsed and rendered entirely in the browser tab and are discarded when the tab is closed.
- Presigned URLs are kept in the URL fragment (`#`) of the viewer page, so they are never sent to any server in a `Referer` header, and they are removed from the address bar once loading starts.
- No AWS credentials, session tokens or account information are read, stored or requested.

## Storage

The extension stores two boolean preferences ("intercept Open links", "intercept Download links") using `chrome.storage.sync`. Nothing else is persisted.

## Permissions

| Permission | Why |
|---|---|
| `declarativeNetRequest` | Redirect presigned S3 navigations to the viewer page |
| `storage` | Remember the two preferences above |
| `contextMenus` | Provide "Open link in S3 Any Viewer" |
| `*://*.amazonaws.com/*`, `*://*.amazonaws.com.cn/*` | Fetch the object bytes from S3 |
| `<all_urls>` (optional, requested on demand) | Open objects from S3-compatible services or CloudFront when you ask for it in the popup |

## Third parties

No analytics, no telemetry, no remote code. All libraries are bundled at build time.

## Contact

Open an issue at https://github.com/mohan-lal/s3-any-viewer/issues.
