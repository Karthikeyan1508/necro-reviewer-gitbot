import type {
  FixIndex,
  GhostPersona,
  GhostRosterEntry,
  PullRequestMeta,
  ReviewEvent,
} from '@necroreview/core';
import {
  DataStore,
  avatarUrl,
  councilVerdict,
  futureYouFinding,
  ghostFindings,
  parseDiff,
  voteFromFinding,
} from '@necroreview/core';

export interface CouncilReviewOptions {
  prMeta?: PullRequestMeta;
  diffText?: string;
  personas?: GhostPersona[];
  fixIndex?: FixIndex | null;
  mode?: 'live' | 'offline';
  /** Broadcast callback for streaming events to clients. */
  onEvent?: (event: ReviewEvent) => void;
}

/**
 * Executes a council review over a diff, summoning ghosts sequentially or concurrently,
 * emitting fine-grained streaming events, and computing the final council verdict.
 */
export async function runOfflineCouncilReview(
  store: DataStore,
  options: CouncilReviewOptions = {},
): Promise<{ verdict: ReturnType<typeof councilVerdict>; findings: ReturnType<typeof ghostFindings> }> {
  const prs = options.prMeta ? [options.prMeta] : store.loadPullRequests();
  const pr = options.prMeta ?? prs[0] ?? {
    number: 0,
    title: 'Untitled pull request',
    author: 'unknown',
    url: '',
    baseRef: '',
    headRef: '',
    body: '',
    additions: 0,
    deletions: 0,
    changedFiles: 0,
    source: 'fixture' as const,
  };
  const diffText = options.diffText ?? store.loadDiffFile(pr.number) ?? '';
  const personas = options.personas ?? store.loadPersonas();
  const fixIndex = options.fixIndex ?? store.loadFixIndex();
  const onEvent = options.onEvent ?? (() => {});

  const startTime = Date.now();
  const parsed = parseDiff(diffText);
  const files = parsed.files.map((f) => f.path);

  // Build ghost roster
  const roster: GhostRosterEntry[] = personas.map((p) => ({
    ghostId: p.id,
    ghostName: p.name,
    emoji: p.emoji,
    avatarUrl: avatarUrl(p.login),
    login: p.login,
    blurb: p.blurb,
    priorities: p.priorities,
    intents: p.commentCount,
    persona: p,
  }));

  // 1. review:start
  onEvent({
    type: 'review:start',
    pr,
    ghosts: roster,
    mode: options.mode ?? 'offline',
  });

  // Short pause for live UI animation feel
  await delay(80);

  // 2. diff:loaded
  onEvent({
    type: 'diff:loaded',
    pr,
    diff: diffText,
    files,
  });

  const allFindings: ReturnType<typeof ghostFindings> = [];

  // 3. Summon each ghost and run review
  for (let i = 0; i < personas.length; i++) {
    const persona = personas[i]!;

    onEvent({
      type: 'ghost:summoned',
      ghostId: persona.id,
      ghostName: persona.name,
      emoji: persona.emoji,
      avatarUrl: avatarUrl(persona.login),
      order: i + 1,
    });

    await delay(120);

    onEvent({
      type: 'ghost:thinking',
      ghostId: persona.id,
      ghostName: persona.name,
      status: `Analyzing ${files.length} changed file${files.length === 1 ? '' : 's'} against historical patterns...`,
    });

    await delay(150);

    // Simulated tool call inspection
    if (files.length > 0) {
      onEvent({
        type: 'ghost:tool',
        ghostId: persona.id,
        toolName: 'Read',
        detail: files[0]!,
      });
      await delay(100);
    }

    // Determine findings for this persona
    let findingsForPersona: ReturnType<typeof ghostFindings> = [];
    if (persona.synthetic) {
      const finding = futureYouFinding({
        persona,
        parsed,
        fixIndex,
        pr,
        live: false,
      });
      if (finding) findingsForPersona = [finding];
    } else {
      findingsForPersona = ghostFindings({
        persona,
        parsed,
        fixIndex,
        pr,
        live: false,
      });
    }

    for (const finding of findingsForPersona) {
      allFindings.push(finding);
      onEvent({
        type: 'ghost:finding',
        ghostId: persona.id,
        finding,
      });
      await delay(90);
    }
  }

  // 4. Council verdict aggregation
  const votes = allFindings.map((f) => voteFromFinding(f));
  const verdict = councilVerdict(votes);

  onEvent({
    type: 'council:verdict',
    verdict,
  });

  await delay(60);

  // 5. review:done
  onEvent({
    type: 'review:done',
    findings: allFindings,
    verdict,
    durationMs: Date.now() - startTime,
  });

  return { verdict, findings: allFindings };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
