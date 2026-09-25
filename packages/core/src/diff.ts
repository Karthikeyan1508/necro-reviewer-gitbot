import type { DiffFile, DiffHunk, DiffLine, ParsedDiff } from './types.js';

/**
 * A focused unified-diff reader. It only needs to answer two questions:
 * "which files changed" and "what lines were added", so it handles the subset
 * of the format that `git diff` and `gh pr diff` actually emit:
 *
 *   diff --git a/src/x.ts b/src/x.ts
 *   new file mode 100644 / deleted file mode / index ...
 *   --- a/src/x.ts
 *   +++ b/src/x.ts
 *   @@ -12,7 +12,9 @@ context
 *    context line
 *   -removed line
 *   +added line
 */

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** Maps a file extension to the language an agent thinks in. */
export function languageOf(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  const table: Record<string, string> = {
    ts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    jsx: 'jsx',
    mjs: 'javascript',
    cjs: 'javascript',
    json: 'json',
    md: 'markdown',
    mdx: 'mdx',
    css: 'css',
    scss: 'scss',
    html: 'html',
    yml: 'yaml',
    yaml: 'yaml',
    py: 'python',
    rs: 'rust',
    go: 'go',
    sh: 'shell',
    snap: 'snapshot',
  };
  return table[ext] ?? (ext || 'text');
}

/** Strips the `a/` or `b/` prefix git puts on diff paths. */
function cleanPath(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '/dev/null') return '';
  return trimmed.replace(/^[ab]\//, '');
}

/** Parses a unified diff into files, hunks and added lines. */
export function parseDiff(raw: string): ParsedDiff {
  const files: DiffFile[] = [];
  const additions: string[] = [];
  const lines = raw.replace(/\r\n/g, '\n').split('\n');

  let current: DiffFile | null = null;
  let hunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;
  let inBinary = false;

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      // `diff --git a/<path> b/<path>` — the b/ side wins for renamed files.
      const parts = line.split(' ');
      const bPath = cleanPath(parts[parts.length - 1] ?? '');
      const aPath = cleanPath(parts[parts.length - 2] ?? '');
      current = {
        path: bPath || aPath,
        oldPath: aPath || null,
        newPath: bPath || null,
        language: languageOf(bPath || aPath),
        hunks: [],
        additions: [],
        deletions: [],
      };
      hunk = null;
      inBinary = false;
      files.push(current);
      continue;
    }
    if (!current) continue;

    if (line.startsWith('Binary files ')) {
      inBinary = true;
      continue;
    }
    if (line.startsWith('--- ')) {
      // `--- /dev/null` means the file is new: there is no old side.
      const raw = line.slice(4).trim();
      current.oldPath = raw === '/dev/null' ? null : cleanPath(raw) || null;
      continue;
    }
    if (line.startsWith('+++ ')) {
      // `+++ /dev/null` means the file was deleted: there is no new side.
      const raw = line.slice(4).trim();
      if (raw === '/dev/null') {
        current.newPath = null;
        continue;
      }
      const p = cleanPath(raw);
      if (p) {
        current.newPath = p;
        current.path = p;
        current.language = languageOf(p);
      }
      continue;
    }
    if (line.startsWith('rename from ')) {
      current.oldPath = line.slice('rename from '.length).trim();
      continue;
    }
    if (line.startsWith('rename to ')) {
      const p = line.slice('rename to '.length).trim();
      current.newPath = p;
      current.path = p;
      current.language = languageOf(p);
      continue;
    }

    const header = HUNK_HEADER.exec(line);
    if (header) {
      oldLine = Number.parseInt(header[1] ?? '0', 10);
      newLine = Number.parseInt(header[2] ?? '0', 10);
      hunk = { header: line, oldStart: oldLine, newStart: newLine, lines: [] };
      current.hunks.push(hunk);
      continue;
    }

    if (!hunk || inBinary) continue;
    if (line.startsWith('\\')) continue; // "\ No newline at end of file"

    const marker = line[0];
    if (marker === '+') {
      const entry: DiffLine = { kind: '+', text: line.slice(1), oldLine: null, newLine };
      hunk.lines.push(entry);
      current.additions.push(entry.text);
      additions.push(entry.text);
      newLine += 1;
    } else if (marker === '-') {
      hunk.lines.push({ kind: '-', text: line.slice(1), oldLine, newLine: null });
      current.deletions.push(line.slice(1));
      oldLine += 1;
    } else if (marker === ' ') {
      hunk.lines.push({ kind: ' ', text: line.slice(1), oldLine, newLine });
      oldLine += 1;
      newLine += 1;
    }
  }

  return { raw, files, additions };
}

/** Human-readable diff stats, used in the review room header. */
export function diffStats(parsed: ParsedDiff): { files: number; additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const file of parsed.files) {
    additions += file.additions.length;
    deletions += file.deletions.length;
  }
  return { files: parsed.files.length, additions, deletions };
}

/** True when the diff touches a test file. */
export function isTestPath(path: string): boolean {
  return /(^|\/)(__tests__|test|tests|e2e)\//.test(path) || /\.(test|spec)\.[a-z]+$/.test(path);
}

/** True when the diff touches a Storybook story. */
export function isStoryPath(path: string): boolean {
  return /\.stories\.(ts|tsx|js|jsx|mdx)$/.test(path) || /(^|\/)stories(\/|$)/.test(path);
}

/** True when the diff touches documentation. */
export function isDocPath(path: string): boolean {
  return /\.(md|mdx)$/.test(path) || /(^|\/)docs?(\/|$)/.test(path);
}

/** True when the diff touches a type declaration or a public API surface. */
export function isTypePath(path: string): boolean {
  return /\.d\.ts$/.test(path) || /(^|\/)(types|interfaces)(\/|\.)/.test(path) || /\.types\.ts$/.test(path);
}

/** The directory a path lives in, used for path-overlap bonuses. */
export function dirOf(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? '' : path.slice(0, idx);
}

/** The file name without extension, so `a/useArgs.ts` matches `b/useArgs.ts`. */
export function stemOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  return base.replace(/\.[^.]+$/, '');
}

/** Every distinct stem in a diff — a cheap fingerprint of what the PR touches. */
export function stemsOf(parsed: ParsedDiff): string[] {
  return [...new Set(parsed.files.map((f) => stemOf(f.path)).filter(Boolean))];
}

