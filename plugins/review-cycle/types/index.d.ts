// What the gate remembers for the session, kept in the host's state so a
// reload of the module (a saved hooks file, a /config change) keeps it. The
// shapes repeat the hooks' own types, since a contract imports nothing;
// register.ts checks each against its own type for exact equality.

export type KeptStep = 'push' | 'pr' | 'merge' | 'approve' | 'release' | 'comment';

// A reviewer leg as kept across a reload: its budget timer is re-armed from
// `spawnedAt`.
export type KeptLeg = {
  type: string;
  counts: boolean;
  spawnTree: string | null;
  done: boolean;
  capped: boolean;
  counted: boolean;
  spawnedAt: number;
};

export type Kept = {
  reviews: { type: string; trees: readonly [string, string]; reviewedPaths: readonly string[] }[];
  legs: [string, KeptLeg][];
  // The latest message, less what it granted: a reload makes the next step ask.
  message: { tree: string | null; nudged: boolean; prWindow: boolean };
  messages: number;
  lastAnswer: string;
  misses: { message: string; offer: string; steps: KeptStep[]; refusal: string }[];
  dropped: { agentId: string; text: string; old: boolean }[];
  capped: string[];
  scratch: string[];
  reviewerChanges: string[];
  held: Readonly<{ step: KeptStep; how: 'mentioned' | 'declined' }> | null;
  // Where in `reviews` the next commit's rounds start counting.
  roundsFrom: number;
};

declare module 'claude-code' {
  interface PluginState {
    'review-cycle': {
      // null until the gate first keeps its record.
      gate: Shaped<Kept | null>;
    };
  }
}
