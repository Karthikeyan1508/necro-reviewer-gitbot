/**
 * Step 5 of the pipeline: export personas into a shareable JSON ghost library.
 *
 * Can also export or syndicate preconfigured ghost bots as a manifest.
 *
 * Usage:
 *   npm run library
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DataStore, loadEnv, sourceRepo } from '@necroreview/core';
import { log } from './lib/gh.js';

loadEnv();

const SCOPE = 'library';

async function main(): Promise<void> {
  const store = new DataStore();
  const personas = store.loadPersonas();
  const { owner, repo } = sourceRepo();

  if (personas.length === 0) {
    log(SCOPE, 'no personas found to publish');
    return;
  }

  const manifest = {
    repository: `${owner}/${repo}`,
    generatedAt: new Date().toISOString(),
    ghostCount: personas.length,
    ghosts: personas.map((p) => ({
      id: p.id,
      name: p.name,
      emoji: p.emoji,
      login: p.login,
      blurb: p.blurb,
      tone: p.tone,
      priorities: p.priorities,
      synthetic: p.synthetic,
      commentCount: p.commentCount,
    })),
  };

  const outputPath = join(store.paths.personas, 'manifest.json');
  writeFileSync(outputPath, JSON.stringify(manifest, null, 2), 'utf8');
  log(SCOPE, `wrote ghost library manifest (${personas.length} ghosts) -> ${outputPath}`);
}

main().catch((err: unknown) => {
  console.error(`\n✖ ${(err as Error).stack ?? String(err)}\n`);
  process.exit(1);
});
