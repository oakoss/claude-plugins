import { defineConfig } from 'vitest/config';

// The hooks modules' pure logic, register() under a recording `on`, and the
// prose anchors. Engine events are raised only by `claude plugin test`.
export default defineConfig({
  resolve: {
    alias: { 'claude-code': new URL('vitest.claude-code.ts', import.meta.url).pathname },
  },
  test: {
    include: ['plugins/**/*.spec.ts'],
  },
});
