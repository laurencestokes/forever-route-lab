import { describe, expect, it } from 'vitest';
import { createAutosave } from './autosave';
import { manualAutosaveHost } from './persistence-test-helpers';

const TIMING = { quietMs: 100, idleTimeoutMs: 1000, maxWaitMs: 1000 };

function setup() {
  const clock = manualAutosaveHost();
  let saves = 0;
  const autosave = createAutosave(
    () => {
      saves += 1;
    },
    clock.host,
    TIMING,
  );
  return { clock, autosave, saves: () => saves };
}

describe('createAutosave', () => {
  it('saves once after a burst of changes has been quiet, in an idle moment', () => {
    const { clock, autosave, saves } = setup();
    autosave.notify();
    clock.advance(60);
    autosave.notify();
    clock.advance(60);
    autosave.notify();
    // Quiet for less than 100 ms since the last change: nothing yet.
    clock.advance(99);
    expect(saves()).toBe(0);
    expect(autosave.pending()).toBe(true);
    clock.advance(1);
    // The quiet period is over; the save waits for an idle moment.
    expect(saves()).toBe(0);
    clock.idle();
    expect(saves()).toBe(1);
    expect(autosave.pending()).toBe(false);
  });

  it('saves within the idle timeout when no idle moment comes', () => {
    const { clock, autosave, saves } = setup();
    autosave.notify();
    clock.advance(100);
    clock.advance(999);
    expect(saves()).toBe(0);
    clock.advance(1);
    expect(saves()).toBe(1);
  });

  it('still saves every maxWaitMs while changes never pause', () => {
    const { clock, autosave, saves } = setup();
    for (let t = 0; t < 1000; t += 50) {
      autosave.notify();
      clock.advance(50);
    }
    // 1000 ms of changes 50 ms apart: the max wait turned the quiet timer into a save request.
    clock.idle();
    expect(saves()).toBe(1);
  });

  it('takes changes made while waiting for idle into the same save', () => {
    const { clock, autosave, saves } = setup();
    autosave.notify();
    clock.advance(100);
    autosave.notify();
    autosave.notify();
    clock.idle();
    expect(saves()).toBe(1);
    expect(autosave.pending()).toBe(false);
  });

  it('flush saves at once and cancels what was scheduled', () => {
    const { clock, autosave, saves } = setup();
    autosave.notify();
    autosave.flush();
    expect(saves()).toBe(1);
    expect(clock.pendingCount()).toBe(0);
    clock.advance(5000);
    clock.idle();
    expect(saves()).toBe(1);
  });

  it('cancel drops the schedule without saving', () => {
    const { clock, autosave, saves } = setup();
    autosave.notify();
    autosave.cancel();
    clock.advance(5000);
    clock.idle();
    expect(saves()).toBe(0);
  });
});
