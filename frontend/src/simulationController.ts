/** Ordre des requêtes et cycle du calcul, indépendant de l’animation pédagogique. */
export type SimulationPhase = 'idle' | 'running' | 'stopping';
export type SimulationSnapshot = Readonly<{
  phase: SimulationPhase;
  canStart: boolean;
  canStop: boolean;
  inFlight: boolean;
  serverRunning: boolean;
  awaitingServer: boolean;
}>;
export type SimulationPoll = Readonly<{ epoch: number; sequence: number }>;
type ControllerOptions = {
  onChange?: (snapshot: SimulationSnapshot) => void;
  onPhaseChange?: (phase: SimulationPhase) => void;
};

/** Un OP terminé est idle, même si son animation de courant continue à jouer. */
export function createSimulationController(options: ControllerOptions = {}) {
  let activeJob: { abort: AbortController } | null = null;
  let serverRunning = false;
  let awaitingServer = false;
  let stopRequested = false;
  let stopPending = false;
  let pendingStop: Promise<boolean> | null = null;
  let epoch = 0;
  let pollSequence = 0;
  let lastAcceptedPoll = 0;
  let snapshot: SimulationSnapshot = Object.freeze({
    phase: 'idle', canStart: true, canStop: false, inFlight: false, serverRunning: false, awaitingServer: false,
  });
  function emit() {
    const phase: SimulationPhase = stopPending || stopRequested
      ? 'stopping' : activeJob || serverRunning || awaitingServer ? 'running' : 'idle';
    const next: SimulationSnapshot = Object.freeze({
      phase, canStart: phase === 'idle', canStop: phase === 'running',
      inFlight: activeJob !== null, serverRunning, awaitingServer,
    });
    if (Object.keys(next).every(key => next[key as keyof SimulationSnapshot] === snapshot[key as keyof SimulationSnapshot])) return;
    const previousPhase = snapshot.phase;
    snapshot = next;
    options.onChange?.(snapshot);
    if (phase !== previousPhase) options.onPhaseChange?.(phase);
  }
  function invalidatePolls() { epoch += 1; }

  /** undefined signifie qu’un calcul/arrêt était déjà en cours; action n’est pas appelée. */
  async function start<T>(action: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
    if (!snapshot.canStart) return undefined;
    const token = { abort: new AbortController() };
    activeJob = token;
    awaitingServer = false;
    stopRequested = false;
    invalidatePolls();
    emit();
    let completed = false;
    try {
      const result = await action(token.abort.signal);
      completed = true;
      return result;
    } finally {
      if (activeJob === token) {
        activeJob = null;
        // Une réponse complète prouve la fin du worker; un fetch aborté ne la prouve pas.
        if (completed || !token.abort.signal.aborted) {
          serverRunning = false;
          awaitingServer = false;
        }
        if (!stopPending && !serverRunning && !awaitingServer) stopRequested = false;
        invalidatePolls();
        emit();
      }
    }
  }

  /** Aucun POST d’arrêt à vide. Une demande pendante est partagée, pas répétée. */
  function stop(stopRequest: () => Promise<unknown>): Promise<boolean> {
    if (pendingStop) return pendingStop;
    if (!snapshot.canStop) return Promise.resolve(false);
    stopRequested = true;
    stopPending = true;
    if (activeJob) {
      awaitingServer = true;
      activeJob.abort.abort();
    }
    invalidatePolls();
    emit();
    // Le différé capture aussi une exception synchrone du transport.
    pendingStop = Promise.resolve().then(stopRequest).then(response => {
      if (response !== null && typeof response === 'object' && 'running' in response && typeof response.running === 'boolean') {
        serverRunning = response.running;
        awaitingServer = false;
      }
      return true;
    }).catch(error => {
      stopRequested = false;
      throw error;
    }).finally(() => {
      stopPending = false;
      pendingStop = null;
      if (!activeJob && !serverRunning && !awaitingServer) stopRequested = false;
      invalidatePolls();
      emit();
    });
    return pendingStop;
  }

  function beginPoll(): SimulationPoll {
    return Object.freeze({ epoch, sequence: ++pollSequence });
  }
  function acceptPoll(ticket: SimulationPoll, running: boolean): boolean {
    // Un GET antérieur peut avoir le même project.revision qu’un POST terminé.
    if (ticket.epoch !== epoch || ticket.sequence <= lastAcceptedPoll || activeJob || stopPending) return false;
    lastAcceptedPoll = ticket.sequence;
    serverRunning = running;
    awaitingServer = false;
    if (!running) stopRequested = false;
    emit();
    return true;
  }
  return {
    start, stop, beginPoll, acceptPoll, invalidatePolls,
    getSnapshot: () => snapshot,
    get phase(): SimulationPhase { return snapshot.phase; },
  };
}
