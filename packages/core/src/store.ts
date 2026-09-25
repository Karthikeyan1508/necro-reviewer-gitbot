import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import type {
  CommitRecord,
  FixIndex,
  GhostPersona,
  HallOfFame,
  PullRequestMeta,
  ReviewComment,
} from './types.js';
import { dataPaths, sourceRepo, type DataPaths } from './paths.js';

/**
 * Filesystem access for everything NecroReview persists. Writes go through a
 * temp file + rename so a crash mid-write can never leave a half-written
 * persona or index behind.
 */

/** Creates a directory and its parents if needed. */
export function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Reads and parses JSON, or returns `fallback` when the file is absent. */
export function readJson<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch (err) {
    console.error(`[store] could not parse ${file}: ${(err as Error).message}`);
    return fallback;
  }
}

/** Writes JSON atomically, pretty-printed. */
export function writeJson(file: string, value: unknown): void {
  ensureDir(dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(tmp, file);
}

/** Returns an empty hall of fame for the configured repo. */
export function emptyHallOfFame(): HallOfFame {
  const { owner, repo } = sourceRepo();
  return {
    owner,
    repo,
    updatedAt: new Date(0).toISOString(),
    entries: [],
    runs: 0,
    verdicts: { APPROVED: 0, REQUEST_CHANGES: 0, BLOCKED: 0 },
  };
}

export class DataStore {
  readonly paths: DataPaths;

  constructor(rootOverride?: string) {
    this.paths = dataPaths(rootOverride);
  }

  /** Writes raw fetches. */
  saveRawReviewComments(comments: ReviewComment[]): void {
    writeJson(this.paths.reviewComments, comments);
  }

  loadRawReviewComments(): ReviewComment[] {
    return readJson<ReviewComment[]>(this.paths.reviewComments, []);
  }

  saveRawIssueComments(comments: Array<{ id: number; user: string; body: string; createdAt: string }>): void {
    writeJson(this.paths.issueComments, comments);
  }

  loadRawIssueComments(): Array<{ id: number; user: string; body: string; createdAt: string }> {
    return readJson(this.paths.issueComments, []);
  }

  saveRawCommits(commits: CommitRecord[]): void {
    writeJson(this.paths.commits, commits);
  }

  loadRawCommits(): CommitRecord[] {
    return readJson<CommitRecord[]>(this.paths.commits, []);
  }

  savePullRequests(prs: PullRequestMeta[]): void {
    writeJson(this.paths.prMeta, prs);
  }

  loadPullRequests(): PullRequestMeta[] {
    return readJson<PullRequestMeta[]>(this.paths.prMeta, []);
  }

  /** Persona files live one-per-ghost so a re-run only rewrites what changed. */
  personaFile(persona: Pick<GhostPersona, 'id'>): string {
    return join(this.paths.personas, `${persona.id}.json`);
  }

  savePersona(persona: GhostPersona): void {
    writeJson(this.personaFile(persona), persona);
  }

  loadPersona(id: string): GhostPersona | null {
    const file = join(this.paths.personas, `${id}.json`);
    return existsSync(file) ? readJson<GhostPersona | null>(file, null) : null;
  }

  /** Every persona on disk, in stable id order. */
  loadPersonas(): GhostPersona[] {
    ensureDir(this.paths.personas);
    const files = readdirSync(this.paths.personas).filter(
      (name) => name.endsWith('.json') && name !== basename(this.paths.personaManifest),
    );
    const personas: GhostPersona[] = [];
    for (const file of files) {
      const persona = readJson<GhostPersona | null>(join(this.paths.personas, file), null);
      if (persona?.id) personas.push(persona);
    }
    return personas.sort((a, b) => a.id.localeCompare(b.id));
  }

  saveFixIndex(index: FixIndex): void {
    writeJson(this.paths.fixIndex, index);
  }

  loadFixIndex(): FixIndex | null {
    return existsSync(this.paths.fixIndex) ? readJson<FixIndex | null>(this.paths.fixIndex, null) : null;
  }

  loadHallOfFame(): HallOfFame {
    return readJson<HallOfFame>(this.paths.hallOfFame, emptyHallOfFame());
  }

  saveHallOfFame(hof: HallOfFame): void {
    writeJson(this.paths.hallOfFame, hof);
  }

  /** Reads a diff fixture (or a previously fetched PR diff). */
  loadDiffFile(prNumber: number): string | null {
    const candidate = join(this.paths.fixtures, `pr-${prNumber}.diff`);
    return existsSync(candidate) ? readFileSync(candidate, 'utf8') : null;
  }

  saveDiffFile(prNumber: number, diff: string): void {
    const file = join(this.paths.fixtures, `pr-${prNumber}.diff`);
    ensureDir(this.paths.fixtures);
    writeFileSync(file, diff, 'utf8');
  }
}

/** Shared store for the configured data directory. */
export function defaultStore(): DataStore {
  return new DataStore();
}
