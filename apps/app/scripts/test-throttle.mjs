// Standalone smoke test for the upgraded throttle helper.
// Run: node apps/app/scripts/test-throttle.mjs
// We cannot import the TS source directly without a build step, so we
// inline a copy of the throttle implementation we expect to ship.
// If you change the impl in system-state.ts, mirror it here.

function throttle(fn, delayMs) {
  let lastCall = 0;
  let timeoutId = null;
  let lastArgs = null;

  const throttled = (...args) => {
    const now = Date.now();
    lastArgs = args;
    if (now - lastCall >= delayMs) {
      lastCall = now;
      lastArgs = null;
      fn(...args);
    } else if (!timeoutId) {
      timeoutId = setTimeout(() => {
        lastCall = Date.now();
        timeoutId = null;
        if (lastArgs) fn(...lastArgs);
      }, delayMs - (now - lastCall));
    }
  };

  throttled.flush = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (lastArgs) {
      lastCall = Date.now();
      const args = lastArgs;
      lastArgs = null;
      fn(...args);
    }
  };

  throttled.cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    lastArgs = null;
  };

  return throttled;
}

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  // Test 1: first call fires immediately
  {
    const calls = [];
    const t = throttle((x) => calls.push(x), 50);
    t(1);
    assert(calls.length === 1 && calls[0] === 1, "first call should fire immediately");
  }

  // Test 2: rapid calls inside window are coalesced
  {
    const calls = [];
    const t = throttle((x) => calls.push(x), 50);
    t(1); t(2); t(3);
    assert(calls.length === 1, "rapid calls should coalesce");
    await sleep(80);
    assert(calls.length === 2 && calls[1] === 3, "trailing call should fire with last args");
  }

  // Test 3: flush() drains a pending trailing call immediately
  {
    const calls = [];
    const t = throttle((x) => calls.push(x), 100);
    t(1); t(2);
    assert(calls.length === 1, "second call deferred");
    t.flush();
    assert(calls.length === 2 && calls[1] === 2, "flush should drain pending call");
  }

  // Test 4: flush() is a no-op when nothing pending
  {
    const calls = [];
    const t = throttle((x) => calls.push(x), 50);
    t.flush();
    assert(calls.length === 0, "flush with nothing pending should not fire");
    t(1);
    t.flush();
    assert(calls.length === 1, "flush after immediate call should not double-fire");
  }

  // Test 5: cancel() drops pending trailing call
  {
    const calls = [];
    const t = throttle((x) => calls.push(x), 100);
    t(1); t(2);
    t.cancel();
    await sleep(150);
    assert(calls.length === 1, "cancel should drop pending trailing call");
  }

  console.log("OK: throttle smoke tests passed");
}

main();
