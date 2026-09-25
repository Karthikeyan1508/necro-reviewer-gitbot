import { createServer } from 'node:http';
import {
  DataStore,
  type Finding,
  type GhostPersona,
  type PullRequestMeta,
  type ReviewEvent,
  applyRun,
  councilVerdict,
  defaultStore,
  futureYouFinding,
  avatarUrl,
  gitbotUrl,
  isOfflineForced,
  leaderboard,
  parseDiff,
  parseSeanceCommand,
  seanceAnswer,
  voteFromFinding,
} from '@necroreview/core';
import cors from 'cors';
import express from 'express';
import { Server as SocketIOServer } from 'socket.io';
import { GitBotClient } from './gitbotClient.js';
import { runOfflineCouncilReview } from './offlineRunner.js';

export interface ServerOptions {
  port?: number;
  gitbotBaseUrl?: string;
  store?: DataStore;
}

export function createApp(options: ServerOptions = {}) {
  const store = options.store ?? defaultStore();
  const gitbotBaseUrl = options.gitbotBaseUrl ?? gitbotUrl();
  const gitbotClient = new GitBotClient({ baseUrl: gitbotBaseUrl });

  const app = express();
  app.use(cors());
  app.use(express.json());

  const httpServer = createServer(app);
  const io = new SocketIOServer(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });

  const broadcastEvent = (event: ReviewEvent) => {
    io.emit('review:event', event);
  };

  io.on('connection', (socket) => {
    socket.emit('bridge:connected', { time: new Date().toISOString() });
  });

  // Health check
  app.get('/health', async (_req, res) => {
    const isGitBotHealthy = !isOfflineForced() && (await gitbotClient.isHealthy());
    res.json({
      status: 'ok',
      mode: isOfflineForced() ? 'offline-forced' : isGitBotHealthy ? 'live' : 'offline-fallback',
      gitbotHealthy: isGitBotHealthy,
      timestamp: new Date().toISOString(),
    });
  });

  // List all available ghost personas
  app.get('/api/ghosts', (_req, res) => {
    const personas = store.loadPersonas();
    res.json(personas);
  });

  // Hall of Fame leaderboard
  app.get('/api/hall-of-fame', (_req, res) => {
    const hof = store.loadHallOfFame();
    const sorted = leaderboard(hof);
    res.json({ ...hof, entries: sorted });
  });

  // PR metadata & diff
  app.get('/api/pr', (_req, res) => {
    const meta = store.loadPullRequests()[0] ?? {
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
    const diff = store.loadDiffFile(meta.number) ?? '';
    res.json({ meta, diff });
  });

  // Fix index stats
  app.get('/api/fix-index', (_req, res) => {
    const fixIndex = store.loadFixIndex();
    res.json({
      totalFixCommits: fixIndex?.patterns.length ?? 0,
      totalTokens: Object.keys(fixIndex?.df ?? {}).length,
      generatedAt: fixIndex?.builtAt ?? null,
      samplePatterns: fixIndex?.patterns.slice(0, 5) ?? [],
    });
  });

  // Trigger Council Review
  app.post('/api/review', async (req, res) => {
    try {
      const personas = store.loadPersonas();
      const pr = (req.body?.pr as PullRequestMeta | undefined) ?? store.loadPullRequests()[0] ?? {
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
      const diffText = (req.body?.diff as string | undefined) ?? store.loadDiffFile(pr.number) ?? '';
      const fixIndex = store.loadFixIndex();

      const forceOffline = isOfflineForced() || req.body?.forceOffline === true;
      const live = !forceOffline && (await gitbotClient.isHealthy());

      if (!live) {
        const result = await runOfflineCouncilReview(store, {
          prMeta: pr,
          diffText,
          personas,
          fixIndex,
          mode: 'offline',
          onEvent: broadcastEvent,
        });

        const hof = store.loadHallOfFame();
        const updatedHof = applyRun({
          hallOfFame: hof,
          findings: result.findings,
          verdict: result.verdict,
          personas,
        });
        store.saveHallOfFame(updatedHof);

        return res.json({
          status: 'completed',
          mode: 'offline',
          verdict: result.verdict,
          findings: result.findings,
        });
      }

      // Live GitBot execution mode
      broadcastEvent({
        type: 'review:start',
        pr,
        ghosts: personas.map((p) => ({
          ghostId: p.id,
          ghostName: p.name,
          emoji: p.emoji,
          avatarUrl: avatarUrl(p.login),
          login: p.login,
          blurb: p.blurb,
          priorities: p.priorities,
          intents: p.commentCount,
          persona: p,
        })),
        mode: 'live',
      });

      broadcastEvent({
        type: 'diff:loaded',
        pr,
        diff: diffText,
        files: parseDiff(diffText).files.map((f) => f.path),
      });

      const findings: Finding[] = [];
      for (const persona of personas) {
        broadcastEvent({
          type: 'ghost:summoned',
          ghostId: persona.id,
          ghostName: persona.name,
          emoji: persona.emoji,
          avatarUrl: avatarUrl(persona.login),
          order: findings.length + 1,
        });

        let finding = null;
        if (persona.synthetic) {
          finding = futureYouFinding({
            persona,
            parsed: parseDiff(diffText),
            fixIndex,
            pr,
            live: true,
          });
        } else {
          finding = await gitbotClient.runReviewSession({
            persona,
            pr,
            diffText,
            onEvent: broadcastEvent,
          });
        }

        if (finding) {
          findings.push(finding);
          broadcastEvent({
            type: 'ghost:finding',
            ghostId: persona.id,
            finding,
          });
        }
      }

      const votes = findings.map((f) => voteFromFinding(f));
      const verdict = councilVerdict(votes);

      broadcastEvent({
        type: 'council:verdict',
        verdict,
      });

      broadcastEvent({
        type: 'review:done',
        findings,
        verdict,
        durationMs: 1200,
      });

      const hof = store.loadHallOfFame();
      const updatedHof = applyRun({
        hallOfFame: hof,
        findings,
        verdict,
        personas,
      });
      store.saveHallOfFame(updatedHof);

      return res.json({
        status: 'completed',
        mode: 'live',
        verdict,
        findings,
      });
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  // Séance invocation (Slack command / interactive prompt)
  app.post('/api/seance', async (req, res) => {
    try {
      const text = (req.body?.text as string) || '';
      const commandParsed = parseSeanceCommand(text);

      let ghostSlug: string | null = (req.body?.ghostId as string) || null;
      let question: string = (req.body?.question as string) || '';

      if (commandParsed) {
        if (commandParsed.ghostSlug) ghostSlug = commandParsed.ghostSlug;
        question = commandParsed.question;
      }

      if (!question) {
        return res.status(400).json({ error: 'Question is required for a séance.' });
      }

      const personas = store.loadPersonas();
      let persona: GhostPersona | undefined;

      if (ghostSlug) {
        const cleanSlug = ghostSlug.replace(/^@/, '').toLowerCase();
        persona = personas.find(
          (p) =>
            p.id.toLowerCase() === cleanSlug ||
            p.login.toLowerCase() === cleanSlug ||
            p.name.toLowerCase().includes(cleanSlug),
        );
      }

      if (!persona) {
        persona = personas.find((p) => p.synthetic) || personas[0];
      }

      if (!persona) {
        return res.status(404).json({ error: 'No ghost available for séance.' });
      }

      const isLive = !isOfflineForced() && (await gitbotClient.isHealthy());
      if (isLive) {
        const liveResult = await gitbotClient.runSeanceSession({
          persona,
          question,
        });
        if (liveResult) {
          return res.json({
            ghostId: persona.id,
            ghostName: persona.name,
            emoji: persona.emoji,
            question,
            answer: liveResult.answer,
            citations: liveResult.citations,
            live: true,
            sessionId: liveResult.sessionId,
            createdAt: new Date().toISOString(),
          });
        }
      }

      // Fallback offline deterministic answer
      const answer = seanceAnswer({ persona, question });
      return res.json(answer);
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  // Human intervention for ghost permission requests
  app.post('/api/permissions', async (req, res) => {
    try {
      const { sessionId, toolUseId, decision } = req.body as {
        sessionId: string;
        toolUseId: string;
        decision: 'allow' | 'deny';
      };
      if (!sessionId || !toolUseId || !decision) {
        return res.status(400).json({ error: 'sessionId, toolUseId, and decision (allow/deny) are required.' });
      }
      const ok = await gitbotClient.resolvePermission(sessionId, toolUseId, decision);
      return res.json({ success: ok });
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  });

  return { app, httpServer, io };
}



