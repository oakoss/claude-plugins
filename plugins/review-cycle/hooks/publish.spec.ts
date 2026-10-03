import { describe, expect, test } from 'vitest';

import { ghActions } from './command';

const kinds = (command: string) => ghActions(command).map((a) => a.kind);

describe('package publishes are the release step', () => {
  test.each([
    ['npm publish', ['release']],
    ['npm publish --access public', ['release']],
    ['npm -w packages/x publish', ['release']],
    ['npm --workspace=x publish', ['release']],
    ['pnpm publish', ['release']],
    ['pnpm -r publish --no-git-checks', ['release']],
    ['pnpm --filter ./packages/x publish', ['release']],
    ['pnpm -C packages/x publish', ['release']],
    ['yarn npm publish', ['release']],
    ['yarn publish', ['release']],
    ['yarn workspaces foreach -A npm publish', ['release']],
    ['bun publish', ['release']],
    ['cargo publish', ['release']],
    ['cargo +nightly publish -p x', ['release']],
    ['oakum release', ['release']],
    ['pnpm exec oakum release', ['release']],
    ['npx oakum@0.4.0 release', ['release']],
    ['./node_modules/.bin/oakum release', ['release']],
    ['echo 1 | xargs npm publish', ['release']],
    ['timeout 60 npm publish', ['release']],
    ['npm pub', ['release']],
    ['npm publi --access public', ['release']],
    ['npm --tag beta publish', ['release']],
    ['npm --otp 123456 publish', ['release']],
    ['pnpm --tag beta publish', ['release']],
    ['npm --tag beta --access public publish', ['release']],
    ['pnpm --tag beta recursive publish', ['release']],
    ['pnpm recursive publish', ['release']],
    ['~/.cargo/bin/cargo publish', ['release']],
    ['$HOME/.cargo/bin/cargo publish', ['release']],
    ['npm publish --dry-run=false', ['release']],
    ['npm publish --dry-run false', ['release']],
    ['npm publish --dry-run --no-dry-run', ['release']],
    ['pnpm publish --dry-run=0', ['release']],
    ['yarn publish --dry-run', ['release']],
    ['yarn npm publish --dry-run', ['release']],
    ['oakum release --dry-run', ['release']],
    ['cargo publish -p n', ['release']],
    ['cargo publish -pn', ['release']],
    ['cargo publish -qpn', ['release']],
    ['cargo -Cn publish', ['release']],
    ['yarn --cwd packages/x npm publish --dry-run', ['release']],
    ['yarn workspaces foreach -A npm publish --dry-run', ['release']],
  ])('%s', (command, expected) => {
    expect(kinds(command)).toEqual(expected);
  });

  test.each([
    'npm publish --dry-run',
    'npm publish --dry-run=true',
    'pnpm -r publish --dry-run',
    'bun publish --dry-run',
    'cargo publish --dry-run',
    'cargo publish -n',
    'cargo publish -qn',
    'cargo publish -npn',
    'cargo publish -n -q',
    'npm --dry-run publish',
    'npm --json view publish',
    'npm -g i pub',
    'npm public',
    'npm run-script oakum release',
    'npm run publish',
    'pnpm run oakum release',
    'npm run-script publish -- --tag x',
    'npm "$CMD" install',
    'cargo "$sub" build',
    'npm run release',
    'pnpm release',
    'pnpm run publish',
    'npm view x versions',
    'npm pack',
    'cargo build --release',
    'oakum status',
    'oakum version',
    'pnpm exec oakum check --strict',
    'echo npm publish',
    'grep -r "npm publish" docs',
    'git log --grep "oakum release"',
  ])('%s is no release', (command) => {
    expect(kinds(command)).toEqual([]);
  });

  test('a publisher command built at run time before a publish word is unread', () => {
    expect(kinds('npm "$CMD" publish')).toEqual(['unread']);
  });
  test('a command that does not parse is refused when it publishes', () => {
    expect(kinds('npm publish "')).toEqual(['unread']);
    expect(kinds('oakum release "')).toEqual(['unread']);
    expect(kinds('npm test "')).toEqual([]);
  });
});

describe('marking a pull request ready is the pull request step', () => {
  test.each([
    ['gh pr ready', ['pr']],
    ['gh pr ready 119', ['pr']],
    ['gh pr ready 119 --undo', []],
    ['gh pr ready 119 --undo="$UNDO"', ['pr']],
    ['gh pr ready "', ['pr']],
  ])('%s', (command, expected) => {
    expect(kinds(command)).toEqual(expected);
  });
});
