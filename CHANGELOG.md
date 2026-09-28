# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [0.3.0] - unreleased

### Added

- Word documents (DOCX, DOCM, DOTX) render as pages, with styles, tables, images, headers, footers and footnotes. The renderer is loaded on demand, so it adds nothing to the viewer until a Word file is opened.
- PowerPoint presentations (PPTX, PPTM, PPSX, POTX) render as one card per slide: title, subtitle, text with bullet levels, tables, pictures and speaker notes. Charts and SmartArt are marked rather than drawn, and slide layout is not reproduced.
- Office files with no helpful extension, common for S3 keys, are identified from the entry names inside the archive.
- Search now shows what a matched key contains. In the JSON tree (also used by YAML, TOML and NDJSON), matching the key of an object or list shows everything under it, expanded, with any matches inside it still highlighted and reachable. In text views, a matching line that opens a block brings the block with it: the body of a JSON object, a YAML mapping, an XML element, or a stack trace under a log line. A **Show nested** toggle beside the search box turns this off.
- An automated test suite (`npm test`) covering format detection, decompression, the interception rules, package integrity, every format and viewer feature in headless Chrome, and the popup. It runs on every push and pull request, and a release is not built if it fails.
- A load-time benchmark that runs locally after the tests pass, comparing how fast each format opens in this build against the version live on the Chrome Web Store.

### Fixed

- Word and PowerPoint files opened as a list of their internal XML parts instead of as documents.
- Legacy `.doc` and `.ppt` files were sent to the Excel renderer. They now show a clear note suggesting a save as `.docx` or `.pptx`, since the old binary formats cannot be rendered in a browser. Legacy `.xls` still opens as a spreadsheet.
- Brotli-compressed objects (`.br` or `Content-Encoding: br`) opened empty. They now decompress, with the same 1 GB output limit as the other formats.
- **Download** on a compressed object saved the decompressed bytes under the original `.gz`, `.zst` or `.br` name. It now saves the object exactly as stored.
- **Download** on a large Parquet file that was being read in parts saved nothing. It now fetches the whole object, with progress.
- **Copy** on a large Parquet file that was being read in parts threw an error. It now explains that the file is read in parts and points to Download.
- A format that failed to render and fell back to the text or hex view logged a console error even though the fallback worked. It is now a debug message.

### Changed

- JSON files always open in the Pretty view, like a browser's own JSON viewer. Tree and Table remain one click away. Previously, lists of records opened in Table and everything else in Tree.
- Array positions (0, 1, 2 ...) no longer match a search as if they were keys, so searching for a number finds values instead of expanding every item whose index contains it.
- The build uses code splitting, so large renderers can be loaded lazily as separate files.

### Known issues

- A server that answers the viewer's initial one-byte range request with `416 Range Not Satisfiable` gets an error page instead of the file. S3 is not affected; this can happen with some non-AWS hosts opened from the popup.

## [0.2.0] - unreleased

### Added

- Search in every text-based view: logs, source code, plain text, XML, YAML, TOML, Markdown source, HTML and SVG source, and the JSON pretty tab. Typing filters the view to the lines that contain the term, highlights each occurrence, and Enter / Shift+Enter or the arrow buttons step through the matches. Clearing the box restores the full file, syntax colours included. Small files idle exactly as before; large files reuse the virtualized list, so a 60,000-line log filters in tens of milliseconds.
- Search in the JSON tree, also used by NDJSON, YAML and TOML tree tabs. The search runs over the parsed data rather than the page, so it finds values inside collapsed nodes and deep in long arrays. The tree collapses to the branches that contain a match, with the paths auto-expanded and the matched text highlighted in keys and values. Results are capped at 1,000 rendered matches with the full count shown, and a note lists the top-level keys that were hidden.

### Changed

- The large-log grep box is replaced by the new search, which adds word highlighting and match navigation at the same speed.

## [0.1.1] - 2026-09-21

### Changed

- Use the `declarativeNetRequestWithHostAccess` permission instead of `declarativeNetRequest`. The two are equivalent for rules that act only on hosts the extension already has permission for, which is the case here: every rule matches a main-frame navigation on `*.amazonaws.com`. The difference is that Chrome no longer shows "Block content on any page" in the install dialog.
- Reword the site-permission panel. It now asks "Allow access to \<host\>?" instead of announcing that the host is not an AWS one, and drops the explanation of which hosts are allowed by default.

## [0.1.0] - 2026-09-18

### Fixed

- "Open link in S3 Any Viewer" on a non-AWS site failed with a bare "Failed to fetch". The context menu now requests the site's host permission at click time, and the viewer shows a "Grant access" button with an explanation if a fetch is still blocked.

### Added

- Intercept the S3 console **Open** action (any presigned `*.amazonaws.com` navigation) and render the object in the extension viewer instead of downloading it. The console **Download** action is left untouched.
- Format detection by magic bytes, file extension, content type and content sniffing, with manual override.
- Transparent unwrapping of gzip, zstd and brotli, including nested cases such as `events.json.gz`.
- Virtualized table with sort, filter, column resize, cell detail and CSV / TSV / JSON export, shared by every tabular format.
- Renderers: CSV with any delimiter, JSON (tree, pretty, table), NDJSON, XML (pretty, raw, table), YAML, TOML, Markdown, HTML (sandboxed), source code and logs (highlighted, virtualized grep for large files), Parquet (paged, schema panel, HTTP range reads for large files), Arrow / Feather, Excel and OpenDocument spreadsheets, images, SVG, PDF, video, audio, ZIP archives (recursive entry browsing) and a hex dump fallback.
- Popup with an interception toggle, "open URL" and "open local file" entry points and the supported format list.
- Context menu entry to open any link in the viewer.
- Size guard for objects above 256 MB with a partial-preview option.
