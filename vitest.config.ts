import { defineConfig } from 'vitest/config';

// The hooks modules' pure logic. register.ts is tested by `claude plugin test`,
// whose kit can raise engine events and vitest cannot.
export default defineConfig({
  test: {
    include: ['plugins/**/*.spec.ts'],
  },
});
