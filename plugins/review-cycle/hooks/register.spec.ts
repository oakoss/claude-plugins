import { describe, expect, test } from 'vitest';

import { register } from './register';

// The test kit cannot load a plugin with options set, so the switch is
// exercised here by calling register with a recording `on`.

type Handler = (...args: unknown[]) => unknown;
type Next = (e: unknown) => Promise<unknown>;

// Every handler registered for each `event:matcher`, in registration order.
function load(enabled: boolean): Map<string, Handler[]> {
  const hooks = new Map<string, Handler[]>();
  const on = (event: string, a: unknown, b?: unknown) => {
    const matcher = typeof a === 'function' ? undefined : (a as { tool?: string; key?: string });
    const handler = (typeof a === 'function' ? a : b) as Handler;
    const key = `${event}:${matcher?.tool ?? matcher?.key ?? ''}`;
    hooks.set(key, [...(hooks.get(key) ?? []), handler]);
    return { catch: () => null };
  };
  (register as unknown as (on: unknown, options: unknown) => void)(on, { enabled });
  return hooks;
}

// Runs a tool call through every handler for it, first registered outermost.
function chain(handlers: Handler[], $: unknown, bottom: Next): Next {
  let next = bottom;
  for (const h of handlers.toReversed()) {
    const inner = next;
    next = (e) => Promise.resolve(h($, e, inner));
  }
  return next;
}

// The engine's order between one plugin's hooks is not specified, so both.
function bothOrders(handlers: Handler[], $: unknown, bottom: Next, e: unknown) {
  return Promise.all([chain(handlers, $, bottom)(e), chain(handlers.toReversed(), $, bottom)(e)]);
}

const SETTINGS = '/home/u/.claude/settings.json';
const ON = '{"enabledPlugins":{"review-cycle@oakoss":true}}';

// Enough of `$` for the Edit and Write hooks: the file reads as ON, git finds
// no repository, so the slop scan stays quiet.
const $ = {
  fs: {
    exists: () => Promise.resolve(true),
    read: () => Promise.resolve(ON),
    stat: () => Promise.resolve({ kind: 'file', size: ON.length, mtimeMs: 0 }),
  },
  process: {
    run: () =>
      Promise.resolve({ exitCode: 128, stdout: '', stderr: 'fatal: not a git repository' }),
  },
};

const CALLS = [
  [
    'tool.call:Edit',
    { tool: 'Edit', file_path: SETTINGS, old_string: 'true', new_string: 'false' },
  ],
  ['tool.call:Write', { tool: 'Write', file_path: SETTINGS, content: ON.replace('true', 'false') }],
] as const;
const edited = () => Promise.resolve({ result: 'edited' });

describe('with the gate switched off', () => {
  test('the comment-slop check still hooks Edit and Write; nothing is gated', () => {
    const hooks = load(false);
    expect(hooks.get('tool.call:Edit')).toHaveLength(1);
    expect(hooks.get('tool.call:Write')).toHaveLength(1);
    expect(hooks.has('tool.call:Bash')).toBe(false);
    expect(hooks.has('prompt.submit:')).toBe(false);
  });
  test('an edit or write to its own switch is not refused', async () => {
    const hooks = load(false);
    for (const [key, e] of CALLS) {
      const results = await bothOrders(hooks.get(key) ?? [], $, edited, e);
      expect(results, key).toEqual([{ result: 'edited' }, { result: 'edited' }]);
    }
  });
});

describe('with the gate on', () => {
  test('the gate and the slop check both hook Edit and Write', () => {
    const hooks = load(true);
    expect(hooks.get('tool.call:Edit')).toHaveLength(2);
    expect(hooks.get('tool.call:Write')).toHaveLength(2);
  });
  test('an edit or write to its own switch is refused, whichever hook runs first', async () => {
    const hooks = load(true);
    for (const [key, e] of CALLS) {
      const results = await bothOrders(hooks.get(key) ?? [], $, edited, e);
      for (const r of results) {
        expect(r, key).toEqual({ deny: expect.stringContaining('only by the user') });
      }
    }
  });
});
