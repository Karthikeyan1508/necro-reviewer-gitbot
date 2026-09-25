import {
  type Finding,
  type GhostPersona,
  type PullRequestMeta,
  type ReviewEvent,
  avatarUrl,
  botSpecForPersona,
  citationHistory,
  extractFindingJson,
  proseWithoutJson,
  retrieveCitations,
  reviewPrompt,
  seancePrompt,
} from '@necroreview/core';

export interface GitBotClientOptions {
  baseUrl: string;
  timeoutMs?: number;
}

export interface SessionCreateResponse {
  id: string;
  botId?: string;
  status?: string;
}

export class GitBotClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: GitBotClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 5000;
  }

  async isHealthy(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/bots`, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      return res.ok || res.status === 200 || res.status === 404;
    } catch {
      return false;
    }
  }

  async registerBot(spec: ReturnType<typeof botSpecForPersona>): Promise<string | null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/bots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(spec),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { id?: string };
      return data.id ?? null;
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

    try {
      const res = await fetch(`${this.baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botName: persona.name,
          login: persona.login,
          prompt,
          permissionMode: 'plan',
        }),
      });

      if (!res.ok) return null;
      const session = (await res.json()) as SessionCreateResponse;
      return await this.listenToSession(session.id, persona, onEvent);
    } catch {
      return null;
    }
  }

  async runSeanceSession(params: {
    persona: GhostPersona;
    question: string;
  }): Promise<{ answer: string; citations: ReturnType<typeof retrieveCitations>; sessionId: string | null } | null> {
    const { persona, question } = params;
    const citations = retrieveCitations(persona, question);
    const history = citationHistory(citations);
    const prompt = seancePrompt({ persona, question, history });

    try {
      const res = await fetch(`${this.baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botName: persona.name,
          login: persona.login,
          prompt,
          permissionMode: 'plan',
        }),
      });

      if (!res.ok) return null;
      const session = (await res.json()) as SessionCreateResponse;
      const transcript = await this.pollSessionResult(session.id);
      return {
        answer: transcript ? proseWithoutJson(transcript) : 'The spirits could not respond.',
        citations,
        sessionId: session.id,
      };
    } catch {
      return null;
    }
  }

  async resolvePermission(sessionId: string, toolUseId: string, decision: 'allow' | 'deny'): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/sessions/${sessionId}/permissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolUseId, decision }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  private async listenToSession(
    sessionId: string,
    persona: GhostPersona,
    onEvent: (event: ReviewEvent) => void,
  ): Promise<Finding | null> {
    try {
      const response = await fetch(`${this.baseUrl}/api/sessions/${sessionId}/events`, {
        headers: { Accept: 'text/event-stream' },
      });

      if (!response.ok || !response.body) {
        const text = await this.pollSessionResult(sessionId);
        return this.parseFindingFromText(persona, sessionId, text);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulatedProse = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        accumulatedProse += chunk;

        onEvent({
          type: 'ghost:thinking',
          ghostId: persona.id,
          ghostName: persona.name,
          status: 'Reviewing diff lines...',
        });
      }

      return this.parseFindingFromText(persona, sessionId, accumulatedProse);
    } catch {
      return null;
    }
  }

  private async pollSessionResult(sessionId: string): Promise<string | null> {
    const maxAttempts = 30;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        const res = await fetch(`${this.baseUrl}/api/sessions/${sessionId}`);
        if (!res.ok) continue;
        const data = (await res.json()) as { status?: string; output?: string; reply?: string; result?: string };
        if (data.status === 'completed' || data.status === 'done' || data.reply || data.output) {
          return data.reply ?? data.output ?? data.result ?? null;
        }
      } catch {
        // Retry
      }
    }
    return null;
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

