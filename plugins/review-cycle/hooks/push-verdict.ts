// Whether the user's request covers a push the gate is judging. Pure.

import type { PushSpec } from './command';
import { covers, type Grant, type PushLevel } from './consent';

export type Needed = Exclude<PushLevel, 'none'>;

// A bare force needs a bare-force request, a lease a force request, and any
// other push a push request.
export function neededFor(spec: PushSpec): Needed {
  return spec.force === 'none' ? 'push' : spec.force;
}

// The level the push needs and the grant falls short of; null when covered.
export function unasked(spec: PushSpec, grant: Grant): Needed | null {
  const needed = neededFor(spec);
  return covers(grant, needed) ? null : needed;
}
