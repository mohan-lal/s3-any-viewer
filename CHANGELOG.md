# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

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
