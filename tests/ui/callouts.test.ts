import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callout, calloutFor } from '../../src/ui/store';

// Callouts (docs/MVP/05 § 8): the outcome of a plate appearance always plays (§ 9.1).

describe('callouts', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
  });

  it("an award in the same frame as a hit waits for the hit's callout", () => {
    // The 3rd rally hit lights HOT BAT (Rally Cap) at once: "HOT BAT LIT" used to replace the hit.
    calloutFor({ type: 'hit', hit: '2B', bases: 2, hotBat: false, runs: 0 });
    calloutFor({ type: 'hotBat', source: 'rallyCap' });
    expect(callout.value?.text).toBe('DOUBLE!');
    vi.advanceTimersByTime(1400);
    expect(callout.value?.text).toBe('HOT BAT LIT');
    vi.advanceTimersByTime(1400);
    expect(callout.value).toBeNull();
  });

  it('an outcome replaces whatever is up', () => {
    calloutFor({ type: 'kickbackLit' });
    calloutFor({ type: 'out', how: 'K', outs: 1 });
    expect(callout.value?.text).toBe('STRIKEOUT');
  });
});
