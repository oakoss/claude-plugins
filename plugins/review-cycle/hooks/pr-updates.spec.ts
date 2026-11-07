import { describe, expect, test } from 'vitest';

import type { Lookup } from './gh-verdict';
import {
  configuredPrUpdates,
  effectivePrUpdates,
  prUpdateOf,
  prUpdatesOf,
  type PrReads,
} from './pr-updates';
import type { DryRunRef } from './push-verdict';

const URL = 'git@github.com:oakoss/oakterm.git';
const ref = (branch: string, url = URL): DryRunRef => ({
  flag: ' ',
  to: `refs/heads/${branch}`,
  url,
});
const pull = (over: Record<string, unknown> = {}) => ({
  number: 106,
  author: { login: 'jbabin91' },
  isCrossRepository: false,
  url: 'https://github.com/oakoss/oakterm/pull/106',
  reviewDecision: '',
  ...over,
});
const ME: Lookup = { out: 'jbabin91\n' };
const reads = (pulls: unknown[] | Lookup, viewer?: Lookup): PrReads => ({
  openPulls: () => Promise.resolve(Array.isArray(pulls) ? { out: JSON.stringify(pulls) } : pulls),
  viewer: () => Promise.resolve(viewer ?? ME),
});
const whyOf = async (r: DryRunRef[], p: unknown[] | Lookup, v?: Lookup) =>
  ((await prUpdateOf(r, reads(p, v))) as { why?: string }).why;

describe('the setting', () => {
  test('reads only its own values, and a typo asks', () => {
    expect(prUpdatesOf('push fixes')).toBe('push fixes');
    expect(prUpdatesOf('push')).toBeNull();
    expect(configuredPrUpdates({ 'review-cycle': { options: { prUpdates: 'push fixes' } } })).toBe(
      'push fixes',
    );
    expect(configuredPrUpdates({ 'review-cycle@oakoss': { options: { prUpdates: 'yes' } } })).toBe(
      'ask',
    );
    expect(configuredPrUpdates({ other: { options: { prUpdates: 'push fixes' } } })).toBeNull();
  });

  test('a committed project file only asks more; the local file sets any value', () => {
    expect(effectivePrUpdates('push fixes', 'ask', null)).toEqual({
      prUpdates: 'ask',
      source: 'project',
    });
    expect(effectivePrUpdates(null, 'push fixes', null)).toEqual({
      prUpdates: 'ask',
      source: 'default',
    });
    expect(effectivePrUpdates(null, 'ask', 'push fixes')).toEqual({
      prUpdates: 'push fixes',
      source: 'local',
    });
    expect(effectivePrUpdates('push fixes', null, null)).toEqual({
      prUpdates: 'push fixes',
      source: 'user',
    });
  });
});

describe('prUpdateOf', () => {
  test("lets a push to the viewer's own open, unapproved pull request's branch through", async () => {
    const ok = { pull: 106, branches: ['fix/resize'] };
    expect(await prUpdateOf([ref('fix/resize')], reads([pull()]))).toEqual(ok);
    for (const url of [
      'https://github.com/oakoss/oakterm',
      'https://x-access-token@github.com/oakoss/oakterm.git',
      'ssh://git@github.com/oakoss/oakterm.git',
    ]) {
      expect(await prUpdateOf([ref('fix/resize', url)], reads([pull()]))).toEqual(ok);
    }
    for (const decision of ['REVIEW_REQUIRED', 'CHANGES_REQUESTED']) {
      expect(
        await prUpdateOf([ref('fix/resize')], reads([pull({ reviewDecision: decision })])),
      ).toEqual(ok);
    }
  });

  test("asks for the user's login on the pull request's own host", async () => {
    const asked: string[] = [];
    const enterprise: PrReads = {
      openPulls: () =>
        Promise.resolve({
          out: JSON.stringify([pull({ url: 'https://ghe.example/oakoss/oakterm/pull/106' })]),
        }),
      viewer: (host) => {
        asked.push(host);
        return Promise.resolve({ out: host === 'ghe.example' ? 'jbabin91\n' : 'someone-else\n' });
      },
    };
    const ghe = ref('fix/x', 'git@ghe.example:oakoss/oakterm.git');
    expect(await prUpdateOf([ghe], enterprise)).toEqual({ pull: 106, branches: ['fix/x'] });
    expect(asked).toEqual(['ghe.example']);
  });

  test("a remote on another host, or no host, is not the pull request's repository", async () => {
    for (const url of [
      'https://gitlab.com/oakoss/oakterm.git',
      'git@ghe.example:oakoss/oakterm.git',
      '/tmp/backup/oakoss/oakterm.git',
      'file:///tmp/oakoss/oakterm.git',
      'https://github.com/fork/oakoss/oakterm',
    ]) {
      expect(await whyOf([ref('fix/x', url)], [pull()])).toContain('remote other than');
    }
  });

  test('a read that is not the shape gh prints asks, saying it could not be read', async () => {
    for (const odd of [
      { out: '{"message":"Not Found"}' },
      { out: 'null' },
      { out: '[null]' },
      [pull({ isCrossRepository: undefined })],
      [pull({ author: undefined })],
      [pull({ reviewDecision: undefined })],
      [pull({ reviewDecision: null })],
      [pull({ url: undefined })],
    ]) {
      expect(await whyOf([ref('fix/x')], odd as unknown[] | Lookup)).toContain('could not be read');
    }
    expect(await whyOf([ref('fix/x')], [pull({ reviewDecision: 'approved' })])).toContain(
      'approved',
    );
    expect(await whyOf([ref('fix/x')], [pull()], { out: '{"message":"Bad credentials"}\n' })).toBe(
      'your GitHub login could not be read',
    );
  });

  test('asks for anything else', async () => {
    expect(await whyOf([ref('fix/x')], [])).toBe('`fix/x` heads no open pull request');
    expect(await whyOf([ref('fix/x')], [pull(), pull({ number: 107 })])).toContain('more than one');
    expect(await whyOf([ref('fix/x')], [pull({ isCrossRepository: true })])).toContain(
      'another repository',
    );
    expect(await whyOf([ref('fix/x')], [pull({ author: { login: 'alice' } })])).toBe(
      '#106 is not one you opened',
    );
    expect(await whyOf([ref('fix/x')], [pull({ reviewDecision: 'APPROVED' })])).toContain(
      'approved',
    );
    expect(await whyOf([ref('fix/x', 'git@github.com:alice/oakterm.git')], [pull()])).toContain(
      'remote other than',
    );
    expect(await whyOf([ref('oakum/version-packages')], [pull()])).toContain('its own tool');
    expect(await whyOf([ref('renovate/x')], [pull()])).toContain('its own tool');
    expect(await whyOf([{ flag: ' ', to: 'refs/tags/v1', url: URL }], [pull()])).toContain(
      'not a branch',
    );
    expect(await whyOf([], [pull()])).toContain('no branch');
    expect(await whyOf([ref('fix/x')], { asks: 'looking up x failed (offline)' })).toBe(
      'looking up x failed (offline)',
    );
    expect(await whyOf([ref('fix/x')], [pull()], { asks: 'looking up you failed' })).toBe(
      'looking up you failed',
    );
    expect(await whyOf([ref('fix/x')], { out: 'not json' })).toContain('could not be read');
  });

  test('one ref that does not qualify holds the whole push', async () => {
    const both = [ref('fix/x'), ref('renovate/y')];
    expect(await prUpdateOf(both, reads([pull()]))).toMatchObject({
      why: expect.stringContaining('tool'),
    });
  });
});
