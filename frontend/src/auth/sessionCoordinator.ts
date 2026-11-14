import type { SessionSnapshot } from './refreshGate';

export function createSessionCoordinator(opts: {
  persist: (next: SessionSnapshot | null) => Promise<void>;
}) {
  let generation = 0;
  let session: SessionSnapshot | null = null;
  let queue: Promise<void> = Promise.resolve();
  const listeners = new Set<(next: SessionSnapshot | null) => void>();

  function notify() {
    for (const listener of listeners) listener(session);
  }

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task);
    queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  function currentGeneration() {
    return generation;
  }

  function getSession() {
    return session;
  }

  function subscribe(listener: (next: SessionSnapshot | null) => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function adoptSession(next: SessionSnapshot | null, seenGeneration = generation) {
    if (seenGeneration !== generation) return false;
    session = next;
    return true;
  }

  async function replaceSession(next: SessionSnapshot, fromGeneration = generation): Promise<void> {
    if (fromGeneration !== generation) {
      throw new Error('Session expired');
    }
    const claimed = generation + 1;
    generation = claimed;
    try {
      await enqueue(async () => {
        if (generation !== claimed) throw new Error('Session expired');
        await opts.persist(next);
        if (generation !== claimed) throw new Error('Session expired');
        session = next;
        notify();
      });
    } catch (error) {
      if (generation === claimed) generation = fromGeneration;
      throw error;
    }
  }

  async function dropSession(): Promise<void> {
    const previous = session;
    const previousGeneration = generation;
    generation += 1;
    const claimed = generation;
    session = null;
    notify();
    try {
      await enqueue(async () => {
        try {
          await opts.persist(null);
        } catch (error) {
          if (generation === claimed) {
            generation = previousGeneration;
            session = previous;
            notify();
          }
          throw error;
        }
      });
    } catch {
      throw new Error('Could not clear session');
    }
  }

  return { currentGeneration, getSession, subscribe, adoptSession, replaceSession, dropSession };
}
