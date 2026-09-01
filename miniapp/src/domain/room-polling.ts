type TimerHandle = unknown;

type PollingDependencies = {
  refresh: () => Promise<void>;
  setInterval?: (callback: () => void, milliseconds: number) => TimerHandle;
  clearInterval?: (handle: TimerHandle) => void;
};

export function createVisibleRoomPoller({
  refresh,
  setInterval: schedule = (callback, milliseconds) => globalThis.setInterval(callback, milliseconds),
  clearInterval: cancel = (handle) => globalThis.clearInterval(handle as ReturnType<typeof globalThis.setInterval>),
}: PollingDependencies) {
  let handle: TimerHandle | null = null;
  const run = () => { void refresh().catch(() => undefined); };

  return {
    start() {
      if (handle !== null) return;
      run();
      handle = schedule(run, 4_000);
    },
    stop() {
      if (handle === null) return;
      cancel(handle);
      handle = null;
    },
  };
}
