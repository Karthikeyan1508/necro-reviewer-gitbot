import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Repository root, derived from this file's location rather than the process
 * cwd, so scripts behave the same whether they are run from the root or from a
 * workspace folder.
 */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

let loaded = false;

/**
 * Minimal `.env` reader. Deliberately not `dotenv`: one dependency fewer, and
 * the format we need is a handful of KEY=VALUE lines. Real environment
 * variables always win over the file, so CI and shell exports stay in charge.
 */
export function loadEnv(file = resolve(REPO_ROOT, '.env')): void {
  if (loaded) return;
  loaded = true;
  if (!existsSync(file)) return;

  for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Strip one layer of matching quotes, if present.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

/** Reads a string env var. */
export function env(key: string, fallback = ''): string {
  const value = process.env[key];
  return value === undefined || value === '' ? fallback : value;
}

/** Reads a numeric env var, falling back when unset or unparseable. */
export function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * True when explicitly running offline. `NRR_MODE=offline` skips GitBot
 * entirely; anything else means "try live, fall back to offline".
 */
export function isOfflineForced(): boolean {
  return env('NRR_MODE').toLowerCase() === 'offline';
}
