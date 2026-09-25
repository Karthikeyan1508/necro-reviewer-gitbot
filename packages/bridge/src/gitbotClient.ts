import {
  type Finding,
  type GhostPersona,
  type PullRequestMeta,
  type ReviewEvent,
  type GitBotAgent,
  agentHarness,
  avatarUrl,
  botSpecForPersona,
  citationHistory,
  extractFindingJson,
  loadEnv,
  proseWithoutJson,
  repoPath,
  retrieveCitations,
  reviewPrompt,
  seancePrompt,
} from '@necroreview/core';

export interface GitBotClientOptions {
  baseUrl: string;
  timeoutMs?: number;
}

interface BotRow {
  id: string;
  name: string;
  setupStatus?: string;
}

interface TurnResult {
  sessionId: string;
  threadId: string | null;
  transcript: string;
}

const HTTP_TIMEOUT_MS = 20_000;
const SSE_TIMEOUT_MS = 5 * 60 * 1000;
const JSON_HEADERS = { 'Content-Type': 'application/json' };

/**
 * Bridge client for the installed GitBot HQ service.
 *
 * Transport contract (installed GitBot version):
 * - GET  /bots                    -> { bots }
 * - POST /bots                    -> { bot, setupThread }
 * - POST /bots/:id/setup          -> { bot }       (body { action: "complete" })
 * - POST /threads                 -> { thread }    (body { botId, repoPath, title })
 * - POST /chat                    -> { sessionId } (body { threadId, prompt, ... })
 * - GET  /events?sessionId=...    -> SSE, ends on done / error / aborted
 * - GET  /threads/:id/messages    -> { messages }  (transcript fallback)
 * - POST /sessions/:id/permission -> { ok: true }  (body { toolUseID, approved })
 */
export class GitBotClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: GitBotClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 5000;
  }

  async isHealthy(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/bots`, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Registers a bot and marks review-only ghosts setup-complete so review threads are not blocked. */
  async registerBot(spec: ReturnType<typeof botSpecForPersona>): Promise<string | null> {
    try {
      const res = await fetch(`${this.baseUrl}/bots`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(spec),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { bot?: { id?: string }; id?: string };
      const botId = data.bot?.id ?? data.id;
      if (botId) await this.completeSetup(botId);
      return botId ?? null;
    } catch {
      return null;
    }
  }

  async runReviewSession(params: {
    persona: GhostPersona;
    pr: PullRequestMeta;
    diffText: string;
    onEvent: (event: ReviewEvent) => void;
  }): Promise<Finding | null> {
    const { persona, pr, diffText, onEvent } = params;
    const prompt = reviewPrompt({ persona, pr, diff: diffText });
    const turn = await this.runTurn(persona, prompt, onEvent);
    if (!turn) return null;
    onEvent({
      type: 'ghost:thinking',
      ghostId: persona.id,
      ghostName: persona.name,
      status: turn.transcript.trim() ? 'Review complete.' : 'The spirit returned nothing.',
    });
    return this.parseFindingFromText(persona, turn.sessionId, turn.transcript);
  }

  async runSeanceSession(params: {
    persona: GhostPersona;
    question: string;
  }): Promise<{ answer: string; citations: ReturnType<typeof retrieveCitations>; sessionId: string | null } | null> {
    const { persona, question } = params;
    const citations = retrieveCitations(persona, question);
    const history = citationHistory(citations);
    const prompt = seancePrompt({ persona, question, history });
    const turn = await this.runTurn(persona, prompt);
    if (!turn) return null;
    return {
      answer: turn.transcript.trim() ? proseWithoutJson(turn.transcript) : 'The spirits could not be reached this time.',
      citations,
      sessionId: turn.sessionId,
    };
  }

  /** Answers a GitBot permission prompt on behalf of the human reviewer. */
  async resolvePermission(sessionId: string, toolUseId: string, decision: 'allow' | 'deny'): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/sessions/${encodeURIComponent(sessionId)}/permission`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ toolUseID: toolUseId, approved: decision === 'allow' }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  private async runTurn(
    persona: GhostPersona,
    prompt: string,
    onEvent?: (event: ReviewEvent) => void,
  ): Promise<TurnResult | null> {
    const botId = await this.ensureBot(persona);
    if (!botId) return null;

    const threadId = await this.createReviewThread(botId, persona);
    if (!threadId) return null;

    const sessionId = await this.startChat(threadId, prompt);
    if (!sessionId) return null;

    onEvent?.({
      type: 'ghost:thinking',
      ghostId: persona.id,
      ghostName: persona.name,
      status: 'Reviewing diff lines...',
    });

    let transcript = await this.streamSession(sessionId, persona, onEvent);
    if (!transcript.trim()) transcript = await this.fetchThreadTranscript(threadId);
    if (!transcript.trim()) return null;

    return { sessionId, threadId, transcript };
  }

  private async ensureBot(persona: GhostPersona): Promise<string | null> {
    try {
      const res = await fetch(`${this.baseUrl}/bots`, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (res.ok) {
        const data = (await res.json()) as { bots?: BotRow[] };
        const existing = (data.bots ?? []).find((bot) => bot.name === persona.name);
        if (existing) {
          if (existing.setupStatus && existing.setupStatus !== 'complete') {
            await this.completeSetup(existing.id);
          }
          return existing.id;
        }
      }
    } catch {
      // Registration below is the fallback path.
    }
    return this.registerBot(this.specFor(persona));
  }

  private specFor(persona: GhostPersona): ReturnType<typeof botSpecForPersona> {
    loadEnv();
    return botSpecForPersona(persona, {
      agent: agentHarness() as GitBotAgent,
      repoPath: repoPath() || undefined,
      permissionMode: 'plan',
    });
  }

  private async completeSetup(botId: string): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/bots/${encodeURIComponent(botId)}/setup`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ action: 'complete' }),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
    } catch {
      // Best-effort: GitBot may already consider the bot ready.
    }
  }

  private async createReviewThread(botId: string, persona: GhostPersona): Promise<string | null> {
    loadEnv();
    const payload: Record<string, unknown> = { botId, title: `Review for ${persona.name}` };
    const repo = repoPath();
    if (repo) payload.repoPath = repo;
    try {
      const res = await fetch(`${this.baseUrl}/threads`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { thread?: { id?: string } };
      return data.thread?.id ?? null;
    } catch {
      return null;
    }
  }

  private async startChat(threadId: string, prompt: string): Promise<string | null> {
    try {
      const res = await fetch(`${this.baseUrl}/chat`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ threadId, prompt, permissionMode: 'plan' }),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { sessionId?: string };
      return data.sessionId ?? null;
    } catch {
      return null;
    }
  }

  /** Consumes the SSE session stream; returns the assistant text accumulated. */
  private async streamSession(
    sessionId: string,
    persona: GhostPersona | null,
    onEvent?: (event: ReviewEvent) => void,
  ): Promise<string> {
    const parts: string[] = [];
    try {
      const response = await fetch(`${this.baseUrl}/events?sessionId=${encodeURIComponent(sessionId)}`, {
        headers: { Accept: 'text/event-stream' },
        signal: AbortSignal.timeout(SSE_TIMEOUT_MS),
      });
      if (!response.ok || !response.body) return parts.join('');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let sepIndex = buffer.indexOf('\n\n');
        while (sepIndex !== -1) {
          const frame = buffer.slice(0, sepIndex);
          buffer = buffer.slice(sepIndex + 2);
          const text = this.frameText(frame);
          if (text) {
            parts.push(text);
            onEvent?.({
              type: 'ghost:thinking',
              ghostId: persona?.id ?? 'ghost',
              ghostName: persona?.name ?? 'Ghost',
              status: 'Reviewing diff lines...',
            });
          }
          sepIndex = buffer.indexOf('\n\n');
        }
      }
    } catch {
      // Disconnects are normal once GitBot ends the stream; the caller falls
      // back to the thread transcript when nothing accumulated.
    }
    return parts.join('\n');
  }

  /** Pulls assistant text out of one SSE frame (`id:` / `event:` / `data:` lines). */
  private frameText(frame: string): string {
    let eventType = '';
    let raw = '';
    for (const line of frame.split('\n')) {
      if (line.startsWith('event: ')) eventType = line.slice(7).trim();
      else if (line.startsWith('data: ')) raw = line.slice(6).trim();
    }
    if (!raw) return '';
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return '';
    }
    if (!parsed || typeof parsed !== 'object') return '';
    const obj = parsed as Record<string, unknown>;
    const type = typeof obj.type === 'string' ? (obj.type as string) : eventType;
    if (type !== 'assistant') return '';
    const content = obj.content ?? obj.text ?? obj.message;
    return typeof content === 'string' ? content : '';
  }

  /** Transcript fallback: reads the thread's saved conversation from GitBot. */
  private async fetchThreadTranscript(threadId: string): Promise<string> {
    try {
      const res = await fetch(`${this.baseUrl}/threads/${encodeURIComponent(threadId)}/messages`, {
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (!res.ok) return '';
      const data = (await res.json()) as { messages?: unknown[] };
      if (!Array.isArray(data.messages)) return '';
      const parts: string[] = [];
      for (const message of data.messages) {
        if (typeof message === 'string') {
          if (message.trim()) parts.push(message.trim());
          continue;
        }
        if (!message || typeof message !== 'object') continue;
        const obj = message as Record<string, unknown>;
        if (obj.role !== undefined && obj.role !== 'assistant') continue;
        const content = obj.content ?? obj.text ?? obj.message;
        if (typeof content === 'string' && content.trim()) parts.push(content.trim());
      }
      return parts.join('\n');
    } catch {
      return '';
    }
  }

  private parseFindingFromText(persona: GhostPersona, sessionId: string, text: string | null): Finding | null {
    if (!text) return null;
    const json = extractFindingJson(text);
    const prose = proseWithoutJson(text);

    return {
      id: `live-${persona.id}-${Date.now()}`,
      ghostId: persona.id,
      ghostName: persona.name,
      emoji: persona.emoji,
      avatarUrl: avatarUrl(persona.login),
      path: typeof json?.path === 'string' ? (json.path as string) : '*',
      line: typeof json?.line === 'number' ? (json.line as number) : null,
      severity: isSeverity(json?.severity) ? json.severity : 'concern',
      comment: prose || (typeof json?.comment === 'string' ? (json.comment as string) : 'Observation recorded.'),
      rationale: typeof json?.rationale === 'string' ? (json.rationale as string) : persona.blurb,
      quote: null,
      evidence: [],
      vote: isVoteKind(json?.vote) ? json.vote : 'request_changes',
      confidence: 0.9,
      createdAt: new Date().toISOString(),
      sessionId,
      live: true,
    };
  }
}

function isSeverity(value: unknown): value is Finding['severity'] {
  return value === 'nit' || value === 'concern' || value === 'bug' || value === 'blocker';
}

function isVoteKind(value: unknown): value is Finding['vote'] {
  return value === 'approve' || value === 'request_changes' || value === 'block';
}