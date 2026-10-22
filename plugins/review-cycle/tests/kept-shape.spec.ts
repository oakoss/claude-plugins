// A change to the kept record's types needs a new shape tag, or a reload into
// the new code takes back a record the old code wrote. On a failure here, bump
// the tag in register.ts and pin both new values.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from 'vitest';

import { REPO_ROOT } from './agents';

const PINNED = { shape: 'gate-5', contract: '44baadb04b61519d' };

const read = (file: string) =>
  readFileSync(path.join(REPO_ROOT, 'plugins/review-cycle', file), 'utf8');

test('the kept record changes its shape tag whenever its types change', () => {
  const contract = read('types/index.d.ts')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
    .replaceAll(/\s+/g, ' ')
    .trim();
  const shape = /shape: '(gate-\d+)'/.exec(read('hooks/register.ts'))?.[1];
  expect({
    shape,
    contract: createHash('sha256').update(contract).digest('hex').slice(0, 16),
  }).toEqual(PINNED);
});
