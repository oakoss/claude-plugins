import { describe, expect, test } from 'claude-code/testing';

import {
  answered,
  bash,
  countSpawn,
  denied,
  endTurn,
  fakeWorld,
  finishLeg,
  legUnderWay,
  queue,
  ran,
  RECEIPT,
  review,
  say,
  settle,
  skill,
  statusOf,
  step,
  USAGE,
  type World,
} from '../fixtures';

describe('reviews that do not count, and say so', () => {
  test('an aborted leg is named in the refusal', async ($, on) => {
    fakeWorld(on);
    countSpawn();
    const r = await ($ as any).agent.spawn({
      tool_use_id: 'ab',
      subagentType: 'review-cycle:code-reviewer',
      prompt: 'review',
      description: 'review',
      background: true,
    });
    await ($ as any).turn.complete({
      answer: RECEIPT,
      durationMs: 1,
      isAborted: true,
      turnId: 'turn-ab',
      agentId: r.agentId,
      reason: 'aborted',
    });
    await say($, 'commit it');
    expect(denied(await bash($, 'git commit -am x'), 'did not finish')).toBe(true);
  });
  test('a later valid review clears older failures from the refusal', async ($, on) => {
    const w = fakeWorld(on);
    await review($, { answer: 'Looks fine.' });
    await review($);
    w.work = { 'a.ts': 'two' };
    await say($, 'commit it');
    const r = await bash($, 'git commit -am x');
    expect(denied(r, 'edited after the last review')).toBe(true);
    expect(denied(r, 'execution receipt')).toBe(false);
  });
  test('shell aliases that could not be read are reported once', async ($, on) => {
    fakeWorld(on);
    const first = (await bash($, 'ls')) as { context?: string[] };
    const second = (await bash($, 'ls')) as { context?: string[] };
    expect((first.context ?? []).some((c) => c.includes('could not read the user'))).toBe(true);
    expect(second.context ?? []).toEqual([]);
  });
});

function nudge(value: boolean) {
  return { pluginConfigs: { 'review-cycle': { options: { nudge: value } } } };
}

function reminders(w: World): string[] {
  return (w.contexts ?? []).filter((c) => c.startsWith('review-cycle: your last turn left'));
}

async function nudges($: any, w: World): Promise<string[]> {
  const before = reminders(w).length;
  await say($, 'thanks');
  return reminders(w).slice(before);
}

async function startLeg($: any) {
  await $.agent.spawn({
    tool_use_id: 'running',
    subagentType: 'review-cycle:code-reviewer',
    prompt: 'review',
    description: 'review',
    background: true,
  });
}

describe('the review nudge', () => {
  test('a turn that left unreviewed changes is told to review, once', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    w.work = { 'a.ts': 'three' };
    await endTurn($);
    expect(w.prompts).toEqual(['fix it']);
    await say($, 'thanks');
    expect(reminders(w)).toHaveLength(1);
    expect(reminders(w)[0]).toContain('/review-cycle:review');
    // The reminder is the agent's alone: nothing shows on the user's screen.
    expect(w.statuses ?? []).toEqual([]);
  });
  test('the reminder is built when the prompt is sent', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    await review($);
    await say($, 'thanks');
    expect(reminders(w)).toEqual([]);
  });
  test('the nudge turned off before the next prompt sends no reminder', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    w.settings = { local: nudge(false) };
    await say($, 'thanks');
    expect(reminders(w)).toEqual([]);
  });
  test('a slash command leaves the reminder for the next message', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    await $.prompt.submit({
      text: '/config',
      origin: { kind: 'composer' },
      wait: false,
      command: { name: 'config', args: '' },
    });
    expect(reminders(w)).toEqual([]);
    await endTurn($);
    await say($, 'thanks');
    expect(reminders(w)).toHaveLength(1);
  });
  test('typing the review skill clears the reminder', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    await $.prompt.submit({
      text: '/review-cycle:review',
      origin: { kind: 'composer' },
      wait: false,
      command: { name: 'review-cycle:review', args: '' },
    });
    await say($, 'thanks');
    expect(reminders(w)).toEqual([]);
  });
  test('a refused prompt leaves the reminder for the next one', async ($, on) => {
    const w = fakeWorld(on, { dropText: 'refuse me' });
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    await say($, 'refuse me');
    expect(reminders(w)).toEqual([]);
    await say($, 'thanks');
    expect(reminders(w)).toHaveLength(1);
  });
  test('the reminder keeps context other hooks attached', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    await $.prompt.submit({
      text: 'thanks',
      origin: { kind: 'composer' },
      wait: false,
      context: ['other'],
    });
    expect(w.contexts).toContain('other');
    expect(reminders(w)).toHaveLength(1);
  });
  test('a reminder git cannot build says so', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    w.fail = (a) => a.includes('diff-tree');
    await say($, 'thanks');
    expect(w.contexts).toEqual([expect.stringContaining('could not check whether your last turn')]);
  });
  test('a slash command does not move the reminder past changes made after it', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    await $.prompt.submit({
      text: '/foo',
      origin: { kind: 'composer' },
      wait: false,
      command: { name: 'foo', args: '' },
    });
    w.work = { 'a.ts': 'two', 'b.ts': 'x' };
    await endTurn($);
    await say($, 'thanks');
    expect(reminders(w)).toEqual([expect.stringContaining('a.ts')]);
    expect(reminders(w)[0]).toContain('b.ts');
  });
  test('a prompt queued into a running turn does not nudge again', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    await queue($, 'also this');
    w.work = { 'a.ts': 'three' };
    await endTurn($);
    expect(await nudges($, w)).toHaveLength(1);
  });
  test('a nudge turned off sends nothing even when the tree cannot be read', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    w.settings = { local: nudge(false) };
    w.fail = (a) => a === 'git add -A';
    await say($, 'thanks');
    expect(w.contexts ?? []).toEqual([]);
  });
  test('a refused review command leaves the reminder owed', async ($, on) => {
    const w = fakeWorld(on, { dropText: '/review-cycle:review' });
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    await $.prompt.submit({
      text: '/review-cycle:review',
      origin: { kind: 'composer' },
      wait: false,
      command: { name: 'review-cycle:review', args: '' },
    });
    await say($, 'thanks');
    expect(reminders(w)).toHaveLength(1);
  });
  test('a turn git cannot check still owes a reminder', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    w.fail = (a) => a.includes('diff-tree');
    await endTurn($);
    w.fail = () => false;
    await say($, 'thanks');
    expect(reminders(w)).toHaveLength(1);
  });
  test('a turn whose tree git cannot read still owes a reminder', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    w.fail = (a) => a === 'git add -A';
    await endTurn($);
    w.fail = () => false;
    expect(await nudges($, w)).toEqual([expect.stringContaining('a.ts')]);
  });
  test('a turn git still cannot check at the next prompt says so', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    w.fail = (a) => a.includes('diff-tree');
    await endTurn($);
    await say($, 'thanks');
    expect(w.contexts).toEqual([expect.stringContaining('could not check whether your last turn')]);
  });
  test('reviewed changes owe nothing even when the next prompt cannot check', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await review($);
    await endTurn($);
    w.fail = (a) => a.includes('diff-tree');
    await say($, 'thanks');
    expect(w.contexts ?? []).toEqual([]);
  });
  test('a nudge off when the turn ends owes nothing once it is back on', async ($, on) => {
    const w = fakeWorld(on, { settings: { local: nudge(false) } });
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    w.settings = { local: nudge(true) };
    expect(await nudges($, w)).toEqual([]);
  });
  test('a message is nudged once, even after the nudge is turned off and on', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    const change = {
      key: 'review-cycle.nudge',
      provider: { plugin: 'review-cycle', tier: 'user' as const },
      origin: { kind: 'composer' as const },
    };
    await $.config.set({ ...change, value: false, previous: true });
    await $.config.set({ ...change, value: true, previous: false });
    w.work = { 'a.ts': 'three' };
    await endTurn($);
    expect(await nudges($, w)).toEqual([]);
  });
  test('a prompt queued while the nudge is decided is nudged once', async ($, on) => {
    let armed = false;
    const w = fakeWorld(on, {
      settingsRead: async () => {
        if (!armed) return;
        armed = false;
        await queue($, 'also this');
      },
    });
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    armed = true;
    await endTurn($);
    expect(armed).toBe(false);
    const change = {
      key: 'review-cycle.nudge',
      provider: { plugin: 'review-cycle', tier: 'user' as const },
      origin: { kind: 'composer' as const },
    };
    await $.config.set({ ...change, value: false, previous: true });
    await $.config.set({ ...change, value: true, previous: false });
    w.work = { 'a.ts': 'three' };
    await endTurn($);
    expect(await nudges($, w)).toEqual([]);
  });
  test('a prompt sent while the nudge is being decided still carries it', async ($, on) => {
    let sent = false;
    const w = fakeWorld(on, {
      settingsRead: () => {
        if (sent) return;
        sent = true;
        void say($, 'next');
      },
    });
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    await say($, 'thanks');
    // The two prompts overlap, so either may carry it, or both.
    expect(reminders(w).length).toBeGreaterThan(0);
  });
  test('a prompt that overtakes the nudge leaves the reminder to the next one', async ($, on) => {
    let overtaken = false;
    const w = fakeWorld(on, {
      settingsRead: async () => {
        if (overtaken) return;
        overtaken = true;
        await say($, 'next');
      },
    });
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    await say($, 'thanks');
    expect(reminders(w)).toEqual([expect.stringContaining('a.ts')]);
  });
  test('a review that overtakes the nudge owes no reminder', async ($, on) => {
    let overtaken = false;
    const w = fakeWorld(on, {
      settingsRead: async () => {
        if (overtaken) return;
        overtaken = true;
        await $.prompt.submit({
          text: '/review-cycle:review',
          origin: { kind: 'composer' },
          wait: false,
          command: { name: 'review-cycle:review', args: '' },
        });
      },
    });
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    expect(await nudges($, w)).toEqual([]);
  });
  test('a prompt that overtakes and consumes the older reminder arms no second one', async ($, on) => {
    let armed = false;
    let overtaken = false;
    const w = fakeWorld(on, {
      dropText: 'refuse me',
      settingsRead: async () => {
        if (!armed || overtaken) return;
        overtaken = true;
        await say($, 'next');
      },
    });
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    await say($, 'refuse me');
    armed = true;
    w.work = { 'a.ts': 'two', 'b.ts': 'x' };
    await endTurn($);
    await say($, 'thanks');
    expect(reminders(w)).toHaveLength(1);
  });
  test('the reminder measures from where an older owed one began', async ($, on) => {
    const w = fakeWorld(on, { dropText: 'refuse me' });
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    await say($, 'refuse me');
    w.work = { 'a.ts': 'two', 'b.ts': 'x' };
    await endTurn($);
    const sent = await nudges($, w);
    expect(sent).toEqual([expect.stringContaining('a.ts')]);
    expect(sent[0]).toContain('b.ts');
  });
  test('a new session forgets the reminder the last one owed', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false });
    await say($, 'thanks');
    expect(w.contexts ?? []).toEqual([]);
  });
  test('turning the nudge off where the local file keeps it on keeps the reminder', async ($, on) => {
    const w = fakeWorld(on, { settings: { local: nudge(true) } });
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    await $.config.set({
      key: 'review-cycle.nudge',
      value: false,
      previous: true,
      provider: { plugin: 'review-cycle', tier: 'user' as const },
      origin: { kind: 'composer' },
    });
    await say($, 'thanks');
    expect(reminders(w)).toHaveLength(1);
  });
  test('turning the nudge off and on again does not bring the old reminder back', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    const change = {
      key: 'review-cycle.nudge',
      provider: { plugin: 'review-cycle', tier: 'user' as const },
      origin: { kind: 'composer' as const },
    };
    await $.config.set({ ...change, value: false, previous: true });
    await $.config.set({ ...change, value: true, previous: false });
    await say($, 'thanks');
    expect(w.contexts ?? []).toEqual([]);
  });
  test('a prompt queued into a running turn carries no reminder', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    await queue($, 'also this');
    expect(reminders(w)).toEqual([]);
    await say($, 'thanks');
    expect(reminders(w)).toHaveLength(1);
  });
  test('a review started before the next prompt clears the reminder', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    await skill($, 'review-cycle:review');
    await say($, 'thanks');
    expect(reminders(w)).toEqual([]);
  });
  test('a turn that ends by asking the user something is not nudged', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($, 'answer', 'Fixed. Commit the changes to `fix/x`?');
    expect(await nudges($, w)).toEqual([]);
    w.work = { 'a.ts': 'three' };
    await endTurn($);
    expect(await nudges($, w)).toHaveLength(1);
  });
  test("a project's settings turn the nudge off; the local file decides", async ($, on) => {
    const w = fakeWorld(on, { settings: { project: nudge(false) } });
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    expect(await nudges($, w)).toEqual([]);
    w.settings = { project: nudge(false), local: nudge(true) };
    w.work = { 'a.ts': 'three' };
    await endTurn($);
    expect(await nudges($, w)).toHaveLength(1);
  });
  test('a settings file that cannot be read sets nothing', async ($, on) => {
    const w = fakeWorld(on, { settings: { project: 'throw' } });
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    expect(await nudges($, w)).toHaveLength(1);
  });
  test('one unreadable file leaves the other one in force', async ($, on) => {
    const w = fakeWorld(on, { settings: { project: 'throw', local: nudge(false) } });
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    expect(await nudges($, w)).toEqual([]);
    w.settings = { project: nudge(false), local: 'throw' };
    w.work = { 'a.ts': 'three' };
    await endTurn($);
    expect(await nudges($, w)).toEqual([]);
  });
  test('a nudge value that is not a boolean sets nothing', async ($, on) => {
    const w = fakeWorld(on, {
      settings: { project: { pluginConfigs: { 'review-cycle': { options: { nudge: 'false' } } } } },
    });
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    expect(await nudges($, w)).toHaveLength(1);
  });
  test('a turn with nothing to nudge reads no settings', async ($, on) => {
    let reads = 0;
    fakeWorld(on, { settingsRead: () => void reads++ });
    await say($, 'fix it');
    const before = reads;
    await endTurn($);
    expect(reads).toBe(before);
  });
  test('only the user changes the nudge setting', async ($, on) => {
    fakeWorld(on);
    const change = {
      key: 'review-cycle.nudge',
      value: false,
      previous: true,
      provider: { plugin: 'review-cycle', tier: 'user' as const },
    };
    const byPlugin = await $.config.set({ ...change, origin: { kind: 'plugin', name: 'other' } });
    expect(byPlugin).toEqual({ deny: expect.stringContaining('only by the user') });
  });
  test('a turn that changed nothing is not nudged, whatever was unreviewed before', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'what is next?');
    await endTurn($);
    expect(await nudges($, w)).toEqual([]);
  });
  test('reviewed changes are not nudged', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await review($);
    await endTurn($);
    expect(await nudges($, w)).toEqual([]);
  });
  test('an edit after a finished review is nudged', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await review($);
    w.work = { 'a.ts': 'three' };
    await endTurn($);
    expect(await nudges($, w)).toHaveLength(1);
  });
  test('no nudge while a reviewer is still running', async ($, on) => {
    const w = fakeWorld(on, { agents: [{ id: 'leg-running', status: 'running' }] });
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await startLeg($);
    await endTurn($);
    expect(await nudges($, w)).toEqual([]);
  });
  test('a reviewer that ended without saying so does not hold the nudge off', async ($, on) => {
    const w = fakeWorld(on, { agents: [{ id: 'leg-running', status: 'killed' }] });
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await startLeg($);
    await endTurn($);
    expect(await nudges($, w)).toHaveLength(1);
  });
  test('a review the agent or user already started is not nudged', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await $.tool.call({ tool: 'Skill', skill: 'review-cycle:review' });
    await endTurn($);
    expect(await nudges($, w)).toEqual([]);
  });
  test("a subagent's review does not stand in for the main loop's", async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await skill($, 'review-cycle:review', 'sub');
    await endTurn($);
    expect(await nudges($, w)).toHaveLength(1);
  });
  test('a prompt queued mid-turn keeps the turn’s starting tree', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await $.prompt.submit({
      text: 'also x',
      origin: { kind: 'composer' },
      wait: false,
      turnId: 'main',
    });
    await endTurn($);
    expect(await nudges($, w)).toHaveLength(1);
  });
  test('a reviewer whose start could not be recorded still holds the nudge off', async ($, on) => {
    let spawning = false;
    const w = fakeWorld(on, {
      agents: [{ id: 'leg-running', status: 'running' }],
      fail: (a) => spawning && a.includes('write-tree'),
    });
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    spawning = true;
    await startLeg($);
    spawning = false;
    await endTurn($);
    expect(await nudges($, w)).toEqual([]);
  });
  test('the reminder names only what the turn changed', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'add b');
    w.work = { 'a.ts': 'one', 'b.ts': 'new' };
    await endTurn($);
    await say($, 'thanks');
    expect(reminders(w)).toHaveLength(1);
    expect(reminders(w)[0]).toContain('b.ts');
    expect(reminders(w)[0]).not.toContain('a.ts');
  });
  test('unreviewed work from before the message is not nudged', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'update the tracker');
    w.work = { 'a.ts': 'one', '.beads/issues.jsonl': 'x' };
    await endTurn($);
    expect(await nudges($, w)).toEqual([]);
  });
  test('each user message is judged from its own starting tree', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    await say($, 'what is next?');
    expect(reminders(w)).toHaveLength(1);
    await endTurn($);
    expect(await nudges($, w)).toEqual([]);
  });
  test('an interrupted turn is not nudged', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($, 'aborted');
    expect(await nudges($, w)).toEqual([]);
  });
  test('the next user message allows another nudge', async ($, on) => {
    const w = fakeWorld(on);
    await say($, 'fix it');
    w.work = { 'a.ts': 'two' };
    await endTurn($);
    await say($, 'and the other one');
    w.work = { 'a.ts': 'three' };
    await endTurn($);
    expect(await nudges($, w)).toHaveLength(1);
    expect(reminders(w)).toHaveLength(2);
  });
});

describe('the review-pr window', () => {
  test('a prompt queued into the running turn keeps it open', async ($, on) => {
    fakeWorld(on);
    await $.tool.call({ tool: 'Skill', skill: 'review-cycle:review-pr' });
    await ($ as any).prompt.submit({
      text: 'also check x',
      origin: { kind: 'composer' },
      wait: false,
      turnId: 't',
    });
    await review($);
    await say($, 'commit it');
    expect(denied(await bash($, 'git commit -am x'), 'never reviewed')).toBe(true);
  });
  test("a subagent's review-pr does not open it", async ($, on) => {
    fakeWorld(on);
    await ($ as any).tool.call({ tool: 'Skill', skill: 'review-cycle:review-pr', agentId: 'sub' });
    await review($);
    await say($, 'commit it');
    expect(ran(await bash($, 'git commit -am x'))).toBe(true);
  });
  test('/review-cycle:review closes it', async ($, on) => {
    fakeWorld(on);
    await $.tool.call({ tool: 'Skill', skill: 'review-cycle:review-pr' });
    await $.tool.call({ tool: 'Skill', skill: 'review-cycle:review' });
    await review($);
    await say($, 'commit it');
    expect(ran(await bash($, 'git commit -am x'))).toBe(true);
  });
});

describe("a leg's spend", () => {
  test("sums each of a leg's steps, and no one else's", async ($, on) => {
    fakeWorld(on);
    on('turn.step', answered(USAGE));
    const id = await legUnderWay($);
    await step($, id);
    await step($, id);
    await step($);
    await step($, 'not-a-leg');
    const status = statusOf(await $.tool.call({ tool: 'mcp__review-cycle__status' }));
    expect(status.legSpend).toEqual([
      {
        agentId: id,
        type: 'review-cycle:code-reviewer',
        steps: 2,
        input: 4,
        cacheWrite: 10_000,
        cacheRead: 80_000,
        output: 600,
      },
    ]);
  });

  test('a step whose counts are off the API shape counts nothing', async ($, on) => {
    fakeWorld(on);
    on('turn.step', answered({ ...USAGE, input_tokens: -5, output_tokens: 1.5 }));
    const id = await legUnderWay($);
    await step($, id);
    const status = statusOf(await $.tool.call({ tool: 'mcp__review-cycle__status' }));
    expect(status.legSpend).toEqual([]);
  });

  test('a step with no usage counts nothing, and the response passes through', async ($, on) => {
    fakeWorld(on);
    on('turn.step', answered(null));
    const id = await legUnderWay($);
    const answer = await step($, id);
    expect(answer.stopReason).toBe('end_turn');
    const status = statusOf(await $.tool.call({ tool: 'mcp__review-cycle__status' }));
    expect(status.legSpend).toEqual([]);
  });
});

describe('the leg time budget', () => {
  test('a leg past its budget is named to the session in one line, and is capped, not dropped', async ($, on) => {
    const w = fakeWorld(on);
    const id = await legUnderWay($);
    expect(w.timers?.map((t) => t.ms)).toEqual([30 * 60_000]);
    w.timers?.[0]?.fire();
    await settle();
    const asked = (w.prompts ?? []).filter((p) => p.includes('past its 30-minute budget'));
    expect(asked).toHaveLength(1);
    expect(asked[0]).toBe(
      `review-cycle: reviewer leg review-cycle:code-reviewer (agent ${id}) has run past its 30-minute budget.`,
    );
    await finishLeg($, id, true);
    const status = statusOf(await $.tool.call({ tool: 'mcp__review-cycle__status' }));
    expect(status.cappedReviews).toEqual([
      `review-cycle:code-reviewer (agent ${id}): still running after 30 minutes`,
    ]);
    expect(status.droppedReviews).toEqual([]);
  });
  test('a review-pr leg, which counts toward nothing, still gets a budget', async ($, on) => {
    const w = fakeWorld(on);
    await $.tool.call({ tool: 'Skill', skill: 'review-cycle:review-pr' });
    await legUnderWay($);
    expect(w.timers?.map((t) => t.ms)).toEqual([30 * 60_000]);
  });
  test('a leg that finished in time is not capped when its timer fires', async ($, on) => {
    const w = fakeWorld(on);
    const id = await legUnderWay($);
    await finishLeg($, id, false);
    w.timers?.[0]?.fire();
    await settle();
    expect((w.prompts ?? []).filter((p) => p.includes('budget'))).toEqual([]);
    const status = statusOf(await $.tool.call({ tool: 'mcp__review-cycle__status' }));
    expect(status.cappedReviews).toEqual([]);
  });
  test('a refused request to stop the leg is recorded', async ($, on) => {
    const w = fakeWorld(on, { submitFails: true });
    const id = await legUnderWay($);
    w.timers?.[0]?.fire();
    await settle();
    const status = statusOf(await $.tool.call({ tool: 'mcp__review-cycle__status' }));
    expect(status.cappedReviews).toContain(
      `review-cycle:code-reviewer (agent ${id}): the request to stop it was refused (refused)`,
    );
  });
  test("a new cycle's scratch call clears the last cycle's capped legs even when it fails", async ($, on) => {
    const w = fakeWorld(on, { fail: (a) => a.startsWith('mktemp -d') });
    await ($ as any).session.start({ source: 'startup' });
    await legUnderWay($);
    w.timers?.[0]?.fire();
    await settle();
    await $.tool.call({ tool: 'mcp__review-cycle__scratch' });
    const status = statusOf(await $.tool.call({ tool: 'mcp__review-cycle__status' }));
    expect(status.cappedReviews).toEqual([]);
  });
  test("a new cycle's scratch directory clears the last cycle's capped legs", async ($, on) => {
    const w = fakeWorld(on, {
      git: (a) => (a.startsWith('mktemp -d') ? { stdout: '/tmp/review-cycle.abc123\n' } : null),
    });
    await ($ as any).session.start({ source: 'startup' });
    await legUnderWay($);
    w.timers?.[0]?.fire();
    await settle();
    await $.tool.call({ tool: 'mcp__review-cycle__scratch' });
    const status = statusOf(await $.tool.call({ tool: 'mcp__review-cycle__status' }));
    expect(status.cappedReviews).toEqual([]);
  });
});
