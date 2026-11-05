/* code files projview shows as source - view only, never rendered or edited.
 * Pure (no DOM): imported by the browser and by the server, so both agree. */

// ext -> highlight.js language
export const CODE_LANGS = {
  '.cs': 'csharp', '.fs': 'fsharp', '.vb': 'vbnet',
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'javascript',
  '.ts': 'typescript', '.mts': 'typescript', '.cts': 'typescript', '.tsx': 'typescript',
  '.html': 'xml', '.htm': 'xml', '.xml': 'xml', '.svg': 'xml', '.vue': 'xml', '.csproj': 'xml',
  '.css': 'css', '.scss': 'scss', '.less': 'less',
  '.py': 'python', '.rb': 'ruby', '.php': 'php-template', '.pl': 'perl', '.lua': 'lua', '.r': 'r',
  '.java': 'java', '.kt': 'kotlin', '.scala': 'scala', '.go': 'go', '.rs': 'rust',
  '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.cc': 'cpp', '.hpp': 'cpp',
  '.swift': 'swift', '.dart': 'dart',
  '.sh': 'bash', '.bash': 'bash', '.zsh': 'bash', '.ps1': 'powershell',
  '.sql': 'sql', '.graphql': 'graphql', '.proto': 'protobuf',
  '.toml': 'ini', '.ini': 'ini'
};

// Extensionless dotfiles shown as code, by exact name. Not .env / .npmrc /
// .netrc and the like: those hold secrets, so they stay unlisted.
export const CODE_NAMES = {
  '.gitignore': 'plaintext', '.gitattributes': 'plaintext', '.dockerignore': 'plaintext',
  '.npmignore': 'plaintext', '.nvmrc': 'plaintext', '.editorconfig': 'ini',
  '.prettierrc': 'json', '.eslintrc': 'json', '.babelrc': 'json'
};

const extOf = (name) => (name.match(/\.[^./]+$/)?.[0] || '').toLowerCase();

// The highlight.js language for a code file (a path, a name or an ext), or null
// if it isn't one. hasOwn, so a file named "constructor" isn't a prototype hit.
export function codeLang(name) {
  const base = name.split(/[\\/]/).pop();
  if (Object.hasOwn(CODE_NAMES, base)) return CODE_NAMES[base];
  const ext = extOf(base);
  return Object.hasOwn(CODE_LANGS, ext) ? CODE_LANGS[ext] : null;
}
