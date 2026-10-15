// What a hooks module imports from 'claude-code' at run time, for specs that
// load one under vitest: Claude Code provides the module only to a loaded
// plugin. Reading or writing state is engine work, which `claude plugin test`
// covers; here it fails loudly.
export const atom = (ref: unknown, initial: unknown, options?: unknown) => ({
  ref,
  initial,
  options,
});

export function read(): never {
  throw new Error('claude-code state is not available under vitest');
}

export function update(): never {
  throw new Error('claude-code state is not available under vitest');
}
