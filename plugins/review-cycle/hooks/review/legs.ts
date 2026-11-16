import type { $ } from '../state/engine';
import { LEG_BUDGET_MS, state, type Leg } from '../state/gate-state';

// The orchestrator waits on notifications, and a leg that keeps working sends
// none, so the gate keeps the clock and asks the session to stop the leg.
export function overBudget($: $, agentId: string, leg: Leg): void {
  if (leg.done || leg.capped) return;
  leg.capped = true;
  const minutes = LEG_BUDGET_MS / 60_000;
  state.capped.push(`${leg.type} (agent ${agentId}): still running after ${minutes} minutes`);
  // The user sees the prompt whole; what to do with it is in both review skills.
  const text = `review-cycle: reviewer leg ${leg.type} (agent ${agentId}) has run past its ${minutes}-minute budget.`;
  Promise.resolve()
    .then(() => $.prompt.submit({ text }))
    .then(
      (r) => {
        if (r.drop !== undefined)
          state.capped.push(
            `${leg.type} (agent ${agentId}): the request to stop it was refused (${r.drop})`,
          );
      },
      (error: unknown) => {
        state.capped.push(
          `${leg.type} (agent ${agentId}): the request to stop it failed (${error instanceof Error ? error.message : String(error)})`,
        );
      },
    );
}
