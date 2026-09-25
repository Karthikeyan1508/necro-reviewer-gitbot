/**
 * Step 2 of the pipeline: extract top reviewer voices into ghost personas.
 *
 * Usage:
 *   npm run personas
 *   npm run personas -- --top=4
 */
import {
  DataStore,
  buildFutureYouPersona,
  buildPersona,
  ghostCount,
  loadEnv,
  rankReviewers,
  seedHallOfFame,
  sourceRepo,
} from '@necroreview/core';
import type { GhostPersona } from '@necroreview/core';
import { log } from './lib/gh.js';

loadEnv();

const SCOPE = 'personas';

interface Argv {
  topCount: number;
}

function parseArgs(): Argv {
  const args = process.argv.slice(2);
  const hit = args.find((arg) => arg.startsWith('--top='));
  const topCount = hit ? Number.parseInt(hit.slice(6), 10) : ghostCount();
  return { topCount: Number.isFinite(topCount) && topCount > 0 ? topCount : 4 };
}

async function main(): Promise<void> {
  const argv = parseArgs();
  const store = new DataStore();
  const comments = store.loadRawReviewComments();
  const { owner, repo } = sourceRepo();

  if (comments.length === 0) {
    log(SCOPE, 'no review comments found in data/raw/review-comments.json');
    log(SCOPE, 'run `npm run data` first to pull real comments from GitHub, or generate fixture data');
    return;
  }

  log(SCOPE, `analyzing ${comments.length} review comments for ${owner}/${repo}…`);

  // Rank reviewers by comment count & activity
  const rankings = rankReviewers(comments);
  log(SCOPE, `found ${rankings.length} distinct reviewers`);

  const topRanked = rankings.slice(0, argv.topCount);
  const personas: GhostPersona[] = [];

  for (const ranking of topRanked) {
    log(
      SCOPE,
      `extracting persona for @${ranking.login} (${ranking.comments} comments, active ${ranking.firstSeen} .. ${ranking.lastSeen})`,
    );
    const persona = buildPersona(ranking.login, comments);
    store.savePersona(persona);
    personas.push(persona);
  }

  // Also build Ghost of Future You from fix index if available
  const fixIndex = store.loadFixIndex();
  const futureYou = buildFutureYouPersona(fixIndex);
  store.savePersona(futureYou);
  personas.push(futureYou);
  log(SCOPE, `added synthetic persona: ${futureYou.name} (${futureYou.id})`);

  // Seed or update the Hall of Fame
  const existingHof = store.loadHallOfFame();
  const updatedHof = seedHallOfFame(personas, existingHof);
  store.saveHallOfFame(updatedHof);
  log(SCOPE, `seeded Hall of Fame with ${personas.length} ghost entries`);

  log(SCOPE, `done. Personas written to ${store.paths.personas}`);
  log(SCOPE, 'Next: npm run index');
}

main().catch((err: unknown) => {
  console.error(`\n✖ ${(err as Error).stack ?? String(err)}\n`);
  process.exit(1);
});
