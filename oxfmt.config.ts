import { defineConfig } from 'oxfmt';

export default defineConfig({
  ignorePatterns: ['node_modules/**', 'types/**'],
  printWidth: 100,
  // Markdown here is hand-wrapped; reflowing it would churn every doc.
  proseWrap: 'preserve',
  singleQuote: true,
  sortImports: true,
  sortPackageJson: true,
});
