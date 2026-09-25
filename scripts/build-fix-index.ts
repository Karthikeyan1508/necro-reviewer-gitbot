/**
 * Step 3 of the pipeline: build a TF-IDF index of fix & revert commits.
 *
 * Usage:
 *   npm run index
 */
import {
  DataStore,
  buildFixIndex,
  buildFutureYouPersona,
  loadEnv,
  sourceRepo,
} from '@necroreview/core';
import { log } from './lib/gh.js';

loadEnv();

const SCOPE = 'fix-index';

async function main(): Promise<void> {
  const store = new DataStore();
  const commits = store.loadRawCommits();
  const { owner, repo } = sourceRepo();

  if (commits.length === 0) {
    log(SCOPE, 'no commits found in data/raw/commits.json');
    log(SCOPE, 'run `npm run data` first to pull commits from GitHub');
    return;
  }

  log(SCOPE, `building fix index from ${commits.length} commits for ${owner}/${repo}…`);

  const index = buildFixIndex({
    owner,
    repo,
    commits,
  });

  store.saveFixIndex(index);
  log(
    SCOPE,
    `indexed ${index.patterns.length} fix/revert commits with ${Object.keys(index.df).length} distinct tokens`,
  );
  log(SCOPE, `fix index saved -> ${store.paths.fixIndex}`);

  // Re-generate Ghost of Future You with the populated index
  const futureYou = buildFutureYouPersona(index);
  store.savePersona(futureYou);
  log(SCOPE, `refreshed synthetic persona: ${futureYou.name} (${futureYou.id}) with index evidence`);

  log(SCOPE, 'done. Next: npm run start or npm run bots');
}

main().catch((err: unknown) => {
  console.error(`\n✖ ${(err as Error).stack ?? String(err)}\n`);
  process.exit(1);
});
