/**
 * Step 4 of the pipeline: provision ghost personas as bots in GitBot HQ.
 *
 * If GitBot HQ is running (at GITBOT_URL or http://localhost:3000), this script
 * calls `POST /bots` to register each ghost bot with its instructions, allowed
 * tools, and prompt settings, and marks review-only bots setup-complete so
 * GitBot never blocks their review threads on a machine setup run.
 *
 * Usage:
 *   npm run bots
 */
import {
  DataStore,
  agentHarness,
  botSpecForPersona,
  gitbotUrl,
  loadEnv,
  repoPath,
} from '@necroreview/core';
import type { GitBotAgent } from '@necroreview/core';
import { log } from './lib/gh.js';

loadEnv();

const SCOPE = 'provision';

async function checkGitBotHealth(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/bots`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function registerBot(
  baseUrl: string,
  botSpec: ReturnType<typeof botSpecForPersona>,
): Promise<{ success: boolean; id?: string; setupComplete?: boolean; error?: string }> {
  try {
    const res = await fetch(`${baseUrl}/bots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(botSpec),
    });
    if (!res.ok) {
      return { success: false, error: `HTTP ${res.status}: ${await res.text()}` };
    }
    const data = (await res.json()) as { bot?: { id?: string; setupStatus?: string }; id?: string };
    const id = data.bot?.id ?? data.id;
    if (!id) return { success: true };
    // Ghosts that only review diffs must not be blocked by GitBot's machine-setup
    // gate, so mark their one-time setup complete right after registration.
    let setupComplete = true;
    if (data.bot?.setupStatus && data.bot.setupStatus !== 'complete') {
      try {
        const setupRes = await fetch(`${baseUrl}/bots/${encodeURIComponent(id)}/setup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'complete' }),
          signal: AbortSignal.timeout(10_000),
        });
        setupComplete = setupRes.ok;
      } catch {
        setupComplete = false;
      }
    }
    return { success: true, id, setupComplete };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

async function main(): Promise<void> {
  const store = new DataStore();
  const personas = store.loadPersonas();
  const baseUrl = gitbotUrl();
  const agent = agentHarness() as GitBotAgent;
  const configuredRepo = repoPath();

  if (personas.length === 0) {
    log(SCOPE, 'no personas found in data/personas/ — run `npm run personas` first');
    return;
  }

  log(SCOPE, `found ${personas.length} ghost personas to provision`);
  log(SCOPE, `target GitBot HQ: ${baseUrl} (agent harness: ${agent})`);

  const reachable = await checkGitBotHealth(baseUrl);
  if (!reachable) {
    log(SCOPE, `warning: GitBot HQ at ${baseUrl} is unreachable or offline.`);
    log(
      SCOPE,
      'Ghost personas are saved locally and fully functional via deterministic offline review.',
    );
    log(SCOPE, 'When GitBot HQ is started, run `npm run bots` again to sync.');
    return;
  }

  log(SCOPE, `connected to GitBot HQ at ${baseUrl}. Registering bots…`);

  for (const persona of personas) {
    const spec = botSpecForPersona(persona, {
      agent,
      repoPath: configuredRepo || undefined,
      permissionMode: 'plan',
    });

    const result = await registerBot(baseUrl, spec);
    if (result.success) {
      const setup = result.setupComplete === false ? 'setup: pending' : 'setup: complete';
      log(SCOPE, `✓ registered ${persona.name} (${persona.id}) -> bot ID: ${result.id ?? 'ok'} (${setup})`);
    } else {
      log(SCOPE, `✖ could not register ${persona.name} (${result.error})`);
    }
  }

  log(SCOPE, 'provisioning completed.');
}

main().catch((err: unknown) => {
  console.error(`\n✖ ${(err as Error).stack ?? String(err)}\n`);
  process.exit(1);
});
