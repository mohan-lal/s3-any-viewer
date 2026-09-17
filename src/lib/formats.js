// Central registry of everything the viewer can render.
// `renderer` is the key in renderers/index.js; `exts` drive detection by file name.

export const FORMATS = {
  csv:      { label: 'CSV / TSV / PSV (any delimiter)', renderer: 'csv',      exts: ['csv', 'tsv', 'psv', 'tab', 'dsv', 'dat'] },
  json:     { label: 'JSON',                             renderer: 'json',     exts: ['json', 'geojson', 'topojson', 'har', 'webmanifest', 'jsonc', 'json5'] },
  ndjson:   { label: 'NDJSON / JSON Lines',              renderer: 'ndjson',   exts: ['ndjson', 'jsonl', 'jsonlines', 'ldjson'] },
  xml:      { label: 'XML / RSS / SVG source',           renderer: 'xml',      exts: ['xml', 'xsd', 'xsl', 'xslt', 'rss', 'atom', 'plist', 'pom', 'wsdl', 'kml', 'gpx', 'xaml', 'csproj', 'nuspec'] },
  yaml:     { label: 'YAML',                             renderer: 'yaml',     exts: ['yaml', 'yml'] },
  toml:     { label: 'TOML',                             renderer: 'toml',     exts: ['toml'] },
  markdown: { label: 'Markdown',                         renderer: 'markdown', exts: ['md', 'markdown', 'mdown', 'mkd'] },
  html:     { label: 'HTML (sandboxed preview)',         renderer: 'html',     exts: ['html', 'htm', 'xhtml'] },
  parquet:  { label: 'Parquet',                          renderer: 'parquet',  exts: ['parquet', 'parq', 'pq'] },
  arrow:    { label: 'Arrow IPC / Feather',              renderer: 'arrow',    exts: ['arrow', 'feather', 'ipc', 'arrows'] },
  xlsx:     { label: 'Excel (XLSX, XLSM, XLS, XLSB), ODS', renderer: 'xlsx',   exts: ['xlsx', 'xlsm', 'xlsb', 'xls', 'ods', 'fods', 'dif', 'sylk', 'prn'] },
  image:    { label: 'Images (PNG, JPEG, GIF, WebP, BMP, ICO, AVIF)', renderer: 'image', exts: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif', 'apng', 'jfif'] },
  svg:      { label: 'SVG',                              renderer: 'svg',      exts: ['svg'] },
  pdf:      { label: 'PDF',                              renderer: 'pdf',      exts: ['pdf'] },
  video:    { label: 'Video (MP4, WebM, OGG)',           renderer: 'video',    exts: ['mp4', 'm4v', 'webm', 'ogv', 'mov'] },
  audio:    { label: 'Audio (MP3, WAV, OGG, M4A, FLAC)', renderer: 'audio',    exts: ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'flac', 'aac', 'opus'] },
  zip:      { label: 'ZIP / JAR (browse entries)',       renderer: 'zip',      exts: ['zip', 'jar', 'war', 'ear', 'aar', 'epub', 'xpi', 'crx', 'whl', 'nupkg'] },
  gzip:     { label: 'GZIP / ZSTD / Brotli wrapped files', renderer: null,     exts: ['gz', 'gzip', 'zst', 'br'] },
  code:     { label: 'Source code (syntax highlighted)', renderer: 'text',     exts: ['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'java', 'kt', 'go', 'rs', 'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'rb', 'php', 'swift', 'scala', 'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd', 'sql', 'hql', 'r', 'lua', 'pl', 'groovy', 'gradle', 'tf', 'hcl', 'dockerfile', 'makefile', 'cmake', 'proto', 'graphql', 'gql', 'css', 'scss', 'less', 'vue', 'svelte', 'dart', 'ex', 'exs', 'erl', 'clj', 'hs', 'm', 'vb', 'asm', 'jinja', 'j2', 'tpl', 'mustache', 'hbs', 'ipynb'] },
  text:     { label: 'Plain text, logs, config (INI, ENV, properties, conf)', renderer: 'text', exts: ['txt', 'log', 'text', 'ini', 'cfg', 'conf', 'config', 'env', 'properties', 'gitignore', 'editorconfig', 'lst', 'out', 'err', 'diff', 'patch', 'rtf', 'srt', 'vtt', 'sub', 'license', 'readme', 'authors', 'changelog', 'nfo', 'asc', 'pem', 'crt', 'cer', 'key', 'pub', 'csr', 'manifest', 'lock', 'sum', 'mod', 'tex', 'bib', 'rst', 'org', 'adoc', 'asciidoc', 'wiki', 'nt', 'ttl', 'n3', 'edn', 'sexp', 'lisp', 'el', 'vcf', 'ics', 'mbox', 'eml', 'msg'] },
  hex:      { label: 'Anything else (hex dump)',         renderer: 'hex',      exts: [] },
};

// Ordered list for the popup.
export const FORMAT_LABELS = Object.values(FORMATS).map(f => f.label);

const extIndex = new Map();
for (const [key, f] of Object.entries(FORMATS)) for (const e of f.exts) if (!extIndex.has(e)) extIndex.set(e, key);
export function formatForExt(ext) { return extIndex.get(ext.toLowerCase()) || null; }

// Extension -> highlight.js language name (only where it differs from ext).
export const HLJS_LANG = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
  py: 'python', rb: 'ruby', rs: 'rust', kt: 'kotlin', cs: 'csharp', sh: 'bash', zsh: 'bash', ps1: 'powershell',
  bat: 'dos', cmd: 'dos', yml: 'yaml', md: 'markdown', h: 'c', hpp: 'cpp', cc: 'cpp', pl: 'perl', tf: 'ini', hcl: 'ini',
  dockerfile: 'dockerfile', makefile: 'makefile', hql: 'sql', gql: 'graphql', scss: 'scss', less: 'less', vue: 'xml', svelte: 'xml',
  ini: 'ini', cfg: 'ini', conf: 'ini', config: 'ini', env: 'bash', properties: 'properties', toml: 'ini', gradle: 'groovy',
  ex: 'elixir', exs: 'elixir', erl: 'erlang', clj: 'clojure', hs: 'haskell', vb: 'vbnet', asm: 'x86asm', proto: 'protobuf',
  diff: 'diff', patch: 'diff', tex: 'latex', ipynb: 'json', html: 'xml', htm: 'xml', xhtml: 'xml', svg: 'xml', xsd: 'xml', xsl: 'xml',
  rss: 'xml', atom: 'xml', plist: 'xml', pom: 'xml', wsdl: 'xml', csproj: 'xml', kml: 'xml', gpx: 'xml', xaml: 'xml', nuspec: 'xml',
  log: 'accesslog', geojson: 'json', har: 'json', jsonc: 'json', json5: 'json',
};
