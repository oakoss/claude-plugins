import { describe, expect, test } from 'vitest';

import {
  codexCommand,
  configuredEffort,
  effortOf,
  unsafeIn,
  type CodexRequest,
} from '../../hooks/review/codex-command';

const SCRATCH = '/var/folders/x/T/review-cycle.AbC123';
const COPY = '/plugins/review-cycle/scripts/copy-tree.sh';
const request = (part: Partial<CodexRequest> = {}): CodexRequest => ({
  scope: { uncommitted: true },
  tier: 'full',
  pass: 'review',
  effort: null,
  brief: "Intent: it's a fix. Settle this first: does x hold?",
  checks: 'node_modules/.bin/vitest run',
  ...part,
});

describe('configuredEffort', () => {
  test('reads the root table only', () => {
    expect(configuredEffort('model = "x"\nmodel_reasoning_effort = "high"\n')).toBe('high');
    expect(configuredEffort("model_reasoning_effort = 'xhigh'")).toBe('xhigh');
    expect(configuredEffort('[profiles.deep]\nmodel_reasoning_effort = "max"')).toBeNull();
  });
  test('an unknown value, no key or no file is unset', () => {
    expect(configuredEffort('model_reasoning_effort = "turbo"')).toBeNull();
    expect(configuredEffort('model = "x"')).toBeNull();
    expect(configuredEffort(null)).toBeNull();
  });
});

describe('effortOf', () => {
  test('an explicit effort wins on any tier and pass, raising included', () => {
    expect(effortOf('light', 'review', 'high', 'low')).toEqual({
      override: 'high',
      label: 'high (explicit)',
    });
    expect(effortOf('full', 'confirmation', 'max', null).override).toBe('max');
  });
  test('the full tier keeps the configured effort', () => {
    expect(effortOf('full', 'review', null, 'xhigh')).toEqual({
      override: null,
      label: 'inherited',
    });
  });
  test.each([
    ['light', 'review'],
    ['full', 'confirmation'],
  ] as const)('the %s tier on a %s pass lowers to low, never raising', (tier, pass) => {
    expect(effortOf(tier, pass, null, 'high')).toEqual({ override: 'low', label: 'low' });
    expect(effortOf(tier, pass, null, null)).toEqual({ override: 'low', label: 'low' });
    expect(effortOf(tier, pass, null, 'low').override).toBeNull();
    expect(effortOf(tier, pass, null, 'minimal').override).toBeNull();
    expect(effortOf(tier, pass, null, 'none').override).toBeNull();
  });
});

describe('unsafeIn', () => {
  test.each([
    ['say "x"', 'a double quote'],
    [String.raw`a\b`, 'a backslash'],
    ['run `x`', 'a backtick'],
    ['$HOME', 'a dollar sign'],
    ['one\ntwo', 'a line break'],
  ])('%s', (brief, name) => {
    expect(unsafeIn(brief)).toEqual([name]);
  });
  test('an apostrophe is fine', () => {
    expect(unsafeIn("it's fine")).toEqual([]);
  });
});

describe('codexCommand', () => {
  test('the full tier on the working tree', () => {
    const r = codexCommand(request(), SCRATCH, COPY, 'high');
    expect(r).toMatchObject({ effort: 'inherited' });
    if (!('command' in r)) throw new Error('refused');
    expect(r.command).toMatch(
      /^cd "\$\(git rev-parse --show-toplevel\)" && FORCE_COLOR=1 codex review --uncommitted /,
    );
    expect(r.command).toContain(`-c 'default_permissions="review-cycle"'`);
    expect(r.command).toContain(
      `-c 'permissions.review-cycle.filesystem={":root"="read", ":workspace_roots"="read", "${SCRATCH}"="write"}'`,
    );
    expect(r.command).toContain(`-c 'permissions.review-cycle.network.enabled=false'`);
    expect(r.command).not.toContain('model_reasoning_effort');
    expect(r.command).toMatch(/-c "developer_instructions=\\"Intent: it's a fix\. .*\\""$/);
    expect(r.command).toContain(`write only inside ${SCRATCH}`);
    expect(r.command).toContain(`${COPY} <the repository root> <your directory>/tree`);
    expect(r.command).toContain("using the project's own checks: node_modules/.bin/vitest run.");
  });
  test('a base scope and a light tier', () => {
    const r = codexCommand(
      request({ scope: { base: 'origin/main' }, tier: 'light' }),
      SCRATCH,
      COPY,
      null,
    );
    if (!('command' in r)) throw new Error('refused');
    expect(r.command).toContain("codex review --base 'origin/main' ");
    expect(r.command).toContain(`-c 'model_reasoning_effort="low"'`);
    expect(r.effort).toBe('low');
  });
  test("a pull request's worktree runs there and copies with the root's node_modules", () => {
    const req = request({
      scope: { base: 'origin/main' },
      dir: '/tmp/wt/pr-42',
      modules: '/repo',
    });
    const r = codexCommand(req, SCRATCH, COPY, null);
    if (!('command' in r)) throw new Error('refused');
    expect(r.command).toMatch(/^cd '\/tmp\/wt\/pr-42' && FORCE_COLOR=1 codex review --base '/);
    expect(r.command).toContain(`${COPY} /tmp/wt/pr-42 <your directory>/tree /repo,`);
    expect(codexCommand(request({ dir: 'wt' }), SCRATCH, COPY, null)).toHaveProperty('refused');
  });
  test('no checks ends the copy at the tree', () => {
    const r = codexCommand(request({ checks: '' }), SCRATCH, COPY, null);
    if (!('command' in r)) throw new Error('refused');
    expect(r.command).toContain('<your directory>/tree, ending at tree.');
  });
  test('refuses a brief or checks that break the quoting, naming what', () => {
    expect(codexCommand(request({ brief: 'use $HOME' }), SCRATCH, COPY, null)).toEqual({
      refused: expect.stringContaining('a dollar sign'),
    });
    expect(codexCommand(request({ checks: 'pnpm "test"' }), SCRATCH, COPY, null)).toEqual({
      refused: expect.stringContaining('a double quote'),
    });
  });
  test.each(['HEAD~2', 'main@{u}', 'origin/feature+fix', 'origin/équipe'])(
    'takes any revision git does as the base: %s',
    (base) => {
      const r = codexCommand(request({ scope: { base } }), SCRATCH, COPY, null);
      if (!('command' in r)) throw new Error(r.refused);
      expect(r.command).toContain(`--base '${base}' `);
    },
  );
  test('refuses a base or path it cannot quote', () => {
    const base = request({ scope: { base: "it's" } });
    expect(codexCommand(base, SCRATCH, COPY, null)).toHaveProperty('refused');
    expect(codexCommand(request(), "/tmp/o'k", COPY, null)).toHaveProperty('refused');
  });
});
