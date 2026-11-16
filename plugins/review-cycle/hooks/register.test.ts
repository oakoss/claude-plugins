import { describe, expect, test } from 'claude-code/testing';

import { fakeWorld, say } from './fixtures';

describe('the off switch', () => {
  test('only the user can change it', async ($, on) => {
    fakeWorld(on);
    const change = {
      key: 'review-cycle.enabled',
      value: false,
      previous: true,
      provider: { plugin: 'review-cycle', tier: 'user' as const },
    };
    const byPlugin = await $.config.set({ ...change, origin: { kind: 'plugin', name: 'other' } });
    expect(byPlugin).toEqual({ deny: expect.stringContaining('only by the user') });
    const byUser = await $.config.set({ ...change, origin: { kind: 'composer' } });
    expect(byUser).toEqual({ value: false });
  });
});

describe('the status tool', () => {
  test('reports uncovered paths and whether a push was asked for', async ($, on) => {
    fakeWorld(on);
    await say($, 'push it');
    const r = await $.tool.call({ tool: 'mcp__review-cycle__status' });
    const status = JSON.parse((r as { result: string }).result);
    expect(status.uncovered).toEqual([{ path: 'a.ts', state: 'never-reviewed' }]);
    expect(status.pushRequested).toBe(true);
    expect(status.error).toBe(null);
    expect(status.snapshot).toMatch(/^[0-9a-f]{64}$/);
  });
  test('reports no push request for a message without one', async ($, on) => {
    fakeWorld(on);
    await say($, 'fix the parser');
    const r = await $.tool.call({ tool: 'mcp__review-cycle__status' });
    expect(JSON.parse((r as { result: string }).result).pushRequested).toBe(false);
  });
});
