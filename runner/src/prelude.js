// What a browser or GJS would provide and QuickJS does not: timers, a
// microtask queue, a clock. Timers live here, in JS, on the runner's clock;
// the runner calls `__pump()` to run the ones that are due, and it answers how
// many milliseconds until the next one, or -1 for none.
(() => {
  const timers = new Map();
  let nextTimer = 1;

  function delayOf(delay) {
    const number = Number(delay);
    if (!Number.isFinite(number) || number < 0) {
      return 0;
    }
    return number;
  }

  // Out of memory is an InternalError the runner has to see: caught and
  // reported here, the client would carry on half-allocated.
  function report(error) {
    if (error instanceof InternalError) {
      throw error;
    }
    if (error instanceof Error) {
      console.error(`${error.message}\n${error.stack}`);
      return;
    }
    console.error(String(error));
  }

  globalThis.setTimeout = (callback, delay, ...args) => {
    const id = nextTimer++;
    timers.set(id, { callback, args, at: __runner.now() + delayOf(delay), every: 0 });
    return id;
  };

  globalThis.setInterval = (callback, delay, ...args) => {
    const id = nextTimer++;
    const every = Math.max(1, delayOf(delay));
    timers.set(id, { callback, args, at: __runner.now() + every, every });
    return id;
  };

  globalThis.clearTimeout = (id) => {
    timers.delete(id);
  };
  globalThis.clearInterval = globalThis.clearTimeout;

  globalThis.queueMicrotask = (callback) => {
    Promise.resolve().then(callback).catch(report);
  };

  globalThis.performance = { now: () => __runner.now() };

  globalThis.__pump = () => {
    const now = __runner.now();
    for (const [id, timer] of [...timers]) {
      if (timer.at > now || !timers.has(id)) {
        continue;
      }
      if (timer.every > 0) {
        timer.at = now + timer.every;
      } else {
        timers.delete(id);
      }
      try {
        timer.callback(...timer.args);
      } catch (error) {
        report(error);
      }
    }
    let next = Infinity;
    for (const timer of timers.values()) {
      next = Math.min(next, timer.at);
    }
    if (next === Infinity) {
      return -1;
    }
    return Math.max(0, next - __runner.now());
  };
})();
