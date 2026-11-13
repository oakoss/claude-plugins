import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

const SCRIPT = join(import.meta.dirname, '../../scripts/copy-tree.sh');
const hasMise = spawnSync('mise', ['--version']).status === 0;

let dir = '';
let env: NodeJS.ProcessEnv = {};

function run(cmd: string, args: string[], cwd = dir): string {
  const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

// A repository whose mise.toml sets an env var, which mise refuses untrusted.
function repoAt(path: string, trusted: boolean): string {
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'mise.toml'), '[env]\nFIXTURE = "1"\n');
  run('git', ['init', '-q', '-b', 'main'], path);
  run('git', ['add', '-A'], path);
  run('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init'], path);
  if (trusted) run('mise', ['-C', path, 'trust', '--yes', '--quiet']);
  return path;
}

function copyTrust(src: string): string {
  const dest = join(dir, 'copy');
  run('bash', [SCRIPT, src, dest]);
  return run('mise', ['-C', dest, 'trust', '--show']).split('\n').at(-1) ?? '';
}

// mise keeps its trust store under these directories, so the user's is never touched.
describe.skipIf(!hasMise)('copy-tree carries mise trust from the checkout to the copy', () => {
  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'copy-tree-trust-')));
    const { MISE_TRUSTED_CONFIG_PATHS: _t, MISE_PARANOID: _p, ...rest } = process.env;
    env = {
      ...rest,
      HOME: join(dir, 'home'),
      MISE_STATE_DIR: join(dir, 'state'),
      MISE_CONFIG_DIR: join(dir, 'config'),
      MISE_CACHE_DIR: join(dir, 'cache'),
      MISE_DATA_DIR: join(dir, 'data'),
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
    };
    mkdirSync(join(dir, 'home'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test('a trusted checkout under HOME, which mise names with ~, gives a trusted copy', () => {
    expect(copyTrust(repoAt(join(dir, 'home', 'src'), true))).toMatch(/: trusted$/);
  });

  test('a trusted checkout outside HOME gives a trusted copy', () => {
    expect(copyTrust(repoAt(join(dir, 'src'), true))).toMatch(/: trusted$/);
  });

  test('an untrusted checkout gives an untrusted copy', () => {
    expect(copyTrust(repoAt(join(dir, 'home', 'src'), false))).toMatch(/: untrusted$/);
  });
});
