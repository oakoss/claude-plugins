import type { HookFor, MatchedHook } from 'claude-code';

import type { $, Input, NextOf, Output } from '../state/engine';
import { state } from '../state/gate-state';
import { keep } from '../state/keep';
import { isReviewSkill, resumed } from '../state/resume';
import { reviewPr } from './scratch';

type SkillHook = MatchedHook<'tool.call', { tool: 'Skill' }>;

export function onSkill($: $, e: Input<SkillHook>, next: NextOf<SkillHook>): ReturnType<SkillHook> {
  if (!e.agentId && e.skill === 'review-cycle:review-pr') state.message.prWindow = true;
  if (!e.agentId && e.skill === 'review-cycle:review') {
    state.message.prWindow = false;
    // A review already under way needs no reminder to start one.
    state.message.nudged = true;
    state.owed = null;
  }
  return next(e);
}

// Review skill calls a subagent has running. `skill.prompt` names no loop but
// fires inside its Skill call (measured on 2.1.308), and a subagent's review
// is not the main conversation's.
let subagentSkills = 0;

export async function onSubagentSkill(
  _$: $,
  e: Input<SkillHook>,
  next: NextOf<SkillHook>,
): Promise<Output<SkillHook>> {
  if (!e.agentId || !isReviewSkill(e.skill)) return next(e);
  subagentSkills += 1;
  try {
    return await next(e);
  } finally {
    subagentSkills -= 1;
  }
}

export async function onReviewSkill(
  $: $,
  e: Input<HookFor<'skill.prompt'>>,
  next: NextOf<HookFor<'skill.prompt'>>,
): Promise<Output<HookFor<'skill.prompt'>>> {
  const r = await next(e);
  if (e.pluginName === 'review-cycle' && subagentSkills === 0) {
    // The text the model reads, which is what the engine re-attaches and cuts.
    state.reviewing = r.text;
    reviewPr.open = e.skill === 'review-cycle:review-pr';
    void keep($);
  }
  return r;
}

export async function onCompact(
  _$: $,
  e: Input<HookFor<'session.compact'>>,
  next: NextOf<HookFor<'session.compact'>>,
): Promise<Output<HookFor<'session.compact'>>> {
  const r = await next(e);
  if (e.agentId !== undefined || r.messages === undefined) return r;
  const messages = resumed(r.messages, state.reviewing, (text) => ({
    role: 'user' as const,
    text,
    toolUses: [],
  }));
  return { ...r, messages };
}
