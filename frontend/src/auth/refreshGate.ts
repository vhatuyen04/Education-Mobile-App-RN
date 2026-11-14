export type SessionSnapshot = {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    name: string | null;
    role?: 'USER' | 'ADMIN';
  };
};

const ACCESS_AUTH_ERRORS = new Set(['Invalid access token', 'Missing access token']);

export function isAccessAuthError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : '';
  return ACCESS_AUTH_ERRORS.has(message);
}

export function createSessionGate(opts: {
  getSession: () => SessionSnapshot | null;
  getGeneration: () => number;
  setSession: (next: SessionSnapshot, generation: number) => Promise<void>;
  clearSession: () => Promise<void>;
  refresh: (refreshToken: string) => Promise<SessionSnapshot>;
}) {
  let inFlight: Promise<SessionSnapshot> | null = null;

  async function refreshOnce(): Promise<SessionSnapshot> {
    if (inFlight) return inFlight;

    const existing = opts.getSession();
    if (!existing?.refreshToken) {
      await opts.clearSession();
      throw new Error('Session expired');
    }

    const refreshToken = existing.refreshToken;
    const generation = opts.getGeneration();
    inFlight = (async () => {
      try {
        const next = await opts.refresh(refreshToken);
        await opts.setSession(next, generation);
        const applied = opts.getSession();
        if (!applied) throw new Error('Session expired');
        return applied;
      } catch (error) {
        if (opts.getGeneration() === generation) await opts.clearSession();
        throw error;
      }
    })().finally(() => {
      inFlight = null;
    });

    return inFlight;
  }

  async function withAuthRetry<T>(run: (accessToken: string) => Promise<T>): Promise<T> {
    const existing = opts.getSession();
    if (!existing?.accessToken) {
      throw new Error('Not signed in');
    }

    try {
      return await run(existing.accessToken);
    } catch (error) {
      if (!isAccessAuthError(error)) throw error;
      const next = await refreshOnce();
      return run(next.accessToken);
    }
  }

  return { refreshOnce, withAuthRetry };
}
