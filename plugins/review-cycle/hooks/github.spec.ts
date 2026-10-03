import { describe, expect, test } from 'vitest';

import { ghActions } from './command';
import { MCP_GITHUB, mcpAction, shownCall, type GhAction } from './github';

const kinds = (command: string) => ghActions(command).map((a) => a.kind);
const one = (command: string): GhAction | undefined => ghActions(command)[0];
const q = (query: string, extra = '') => kinds(`gh api graphql -f query='${query}' ${extra}`);
const update = (method: string, extra = '') =>
  one(
    `gh api graphql -f query='mutation { updatePullRequestBranch(input:{pullRequestId: "x", updateMethod: ${method}}) { x } }' ${extra}`,
  );

describe('gh api', () => {
  test.each([
    ['gh api repos/{owner}/{repo}/pulls/116', []],
    ['gh api -X GET repos/{owner}/{repo}/pulls -f state=open', []],
    ['gh api "repos/{owner}/{repo}/pulls/$PR"', []],
    ['gh api repos/{owner}/{repo}/pulls/$PR/files --paginate', []],
    ['gh api -X GET "$URL"', []],
    ['gh api --method get $URL', []],
    ['gh api -X GET repos/{owner}/{repo}/issues -f state=$S', []],
    ["gh api graphql -F n=$N -f query='{ viewer { login } }'", []],
    ['gh api --method=HEAD repos/{owner}/{repo}/releases', []],
    ['gh api repos/{owner}/{repo}/pulls -f title=x -f head=fix/x -f base=main', ['pr']],
    ['gh api repos/{owner}/{repo}/pulls -f "$K=v"', ['pr']],
    ['gh api -X PATCH repos/{owner}/{repo}/pulls -f x=y', []],
    ['gh api /repos/{owner}/{repo}/pulls --input pr.json', ['pr']],
    ['gh api -XPUT repos/{owner}/{repo}/pulls/116/merge', ['merge']],
    ['gh api -X PUT https://api.github.com/repos/o/r/pulls/1/merge', ['merge']],
    ['gh api repos/{owner}/{repo}/pulls/116/reviews -f event=APPROVE', ['approve']],
    ['gh api repos/{owner}/{repo}/pulls/116/reviews -fevent=approve', ['approve']],
    ['gh api repos/{owner}/{repo}/pulls/116/reviews -f event=COMMENT -f body=x', ['comment']],
    ['gh api repos/{owner}/{repo}/pulls/116/reviews/9/events -f event=APPROVE', ['approve']],
    ['gh api repos/{owner}/{repo}/issues/9/comments -f body=x', ['comment']],
    ['gh api -X PATCH repos/{owner}/{repo}/issues/comments/5 -f body=x', ['comment']],
    ['gh api repos/{owner}/{repo}/pulls/116/comments/5/replies -f body=x', ['comment']],
    ['gh api repos/{owner}/{repo}/releases -f tag_name=v1', ['release']],
    ['gh api -X DELETE repos/{owner}/{repo}/releases/7', ['release']],
    ['gh api repos/{owner}/{repo}/issues -f title=x', []],
    ['gh api -X POST repos/{owner}/{repo}/git/blobs -f content=x', []],
  ])('%s', (command, expected) => {
    expect(kinds(command)).toEqual(expected);
  });

  test('a merge names its pull request and a named repository to the lookup', () => {
    expect(one('gh api -X PUT repos/{owner}/{repo}/pulls/116/merge')).toEqual({
      kind: 'merge',
      admin: false,
      lookup: ['116'],
    });
    expect(one('gh api -X PUT /repos/o/r/pulls/116/merge?x=1')).toEqual({
      kind: 'merge',
      admin: false,
      lookup: ['116', '--repo', 'o/r'],
    });
  });
  test.each([
    ['GH_REPO=o/r gh api -X PUT repos/{owner}/{repo}/pulls/1/merge', 'elsewhere'],
    ['gh api --hostname h -X PUT repos/o/r/pulls/1/merge', 'elsewhere'],
    ['gh --hostname h api -X PUT repos/o/r/pulls/1/merge', 'elsewhere'],
    ['gh api -X PUT https://ghe.example.com/api/v3/repos/o/r/pulls/1/merge', 'elsewhere'],
    ['gh api -X PUT repos/{owner}/r/pulls/1/merge', 'elsewhere'],
    ['gh api -X PUT repos/{owner}/{repo}/pulls/1/merge && echo ok', 'beside'],
    ['gh api -X PUT repos/{owner}/{repo}/pulls/{number}/merge', 'unnamed'],
    ['gh api -X PUT repos/{owner}/{repo}/pulls/abc/merge', 'unnamed'],
  ])('%s cannot be looked up', (command, cannot) => {
    expect(one(command)).toMatchObject({ kind: 'merge', lookup: { cannot } });
  });

  const DEFAULT = { asks: 'it names no branch, so it commits to the default branch' };
  const BUILT = { asks: 'the branch it names is built at run time or read from a file' };
  test.each([
    ['gh api -X PUT repos/o/r/contents/a.md -f branch=fix/x', { branch: 'fix/x', repo: 'o/r' }],
    [
      'gh api -X PUT repos/o/r/contents/a.md -f branch=refs/heads/main',
      { branch: 'main', repo: 'o/r' },
    ],
    ['gh api -X PUT repos/{owner}/{repo}/contents/a.md', DEFAULT],
    ['gh api -X PUT repos/{owner}/{repo}/contents/a.md -f branch=', DEFAULT],
    ['gh api -X PUT repos/{owner}/{repo}/contents/a.md -f branch=refs/heads/', DEFAULT],
    [
      'gh api repos/{owner}/{repo}/git/refs -f ref=refs/notes/x -f sha=abc',
      { asks: 'it writes `refs/notes/x`, which is no branch' },
    ],
    ['gh api -X PUT repos/{owner}/{repo}/contents/a.md -f branch="$B"', BUILT],
    ['gh api -X PUT repos/{owner}/{repo}/contents/a.md -F branch={branch}', BUILT],
    ['gh api -X PUT repos/{owner}/{repo}/contents/a.md -F branch=@b.txt', BUILT],
    ['gh api -X PUT repos/{owner}/{repo}/contents/a.md -f "$K=main"', BUILT],
    [
      'gh api -X PUT repos/o/r/contents/a.md -f branch=refs/heads/refs/topic',
      { branch: 'refs/topic', repo: 'o/r' },
    ],
    [
      'gh api repos/{owner}/{repo}/merges -f base=fix/x -f head=main',
      { branch: 'fix/x', repo: null },
    ],
    ['gh api repos/o/r/merge-upstream -f branch=main', { branch: 'main', repo: 'o/r' }],
    ['gh api -X POST repos/o/r/branches/x/rename -f new_name=y', { asks: 'it renames a branch' }],
    [
      'gh api repos/{owner}/{repo}/git/refs -f ref=refs/heads/new -f sha=abc',
      { branch: 'new', repo: null },
    ],
    [
      'gh api repos/{owner}/{repo}/git/refs -f ref=refs/tags/v1 -f sha=abc',
      { asks: 'it pushes a tag' },
    ],
    [
      'gh api -X PATCH repos/{owner}/{repo}/git/refs/heads/fix/x -f sha=abc',
      { branch: 'fix/x', repo: null },
    ],
    [
      'gh api -X PATCH repos/{owner}/{repo}/git/refs/heads/x -f sha=a -F force=true',
      { asks: 'it force-updates `x`', force: true },
    ],
    ['gh api -X DELETE repos/{owner}/{repo}/git/refs/heads/old', { asks: 'it deletes `old`' }],
    ['gh api -X PUT repos/{owner}/{repo}/pulls/116/update-branch', { head: ['116'] }],
    ['gh api -X PUT repos/o/r/pulls/116/update-branch', { head: ['116', '--repo', 'o/r'] }],
    [
      'GH_REPO=o/r gh api -X PUT repos/{owner}/{repo}/pulls/116/update-branch',
      { asks: 'the pull request it updates cannot be looked up' },
    ],
    [
      'cd ../x && gh api -X PUT repos/{owner}/{repo}/pulls/7/update-branch',
      { asks: 'the pull request it updates cannot be looked up' },
    ],
    [
      'gh api -X PUT repos/o/r/pulls/main/update-branch',
      { asks: 'the pull request it updates cannot be looked up' },
    ],
    [
      'gh api repos/{owner}/{repo}/git/refs -f ref="$R" -f sha=abc',
      { asks: 'the branch it names is built at run time or read from a file' },
    ],
    [
      'GH_REPO=o/r gh api -X PUT repos/{owner}/{repo}/contents/a -f branch=x',
      { asks: 'where it pushes is picked outside its words' },
    ],
    [
      'gh api -X PUT repos/o/r/contents/a -f branch=x | jq -r .commit.sha',
      { branch: 'x', repo: 'o/r' },
    ],
    [
      'cd ../other && gh api -X PUT repos/{owner}/{repo}/contents/a -f branch=x',
      { asks: 'another step in the command can change which repository it reaches' },
    ],
  ])('%s pushes', (command, ref) => {
    expect(one(command)).toEqual({ kind: 'push', ref });
  });

  test.each([
    ['gh api "$ENDPOINT" -X POST', 'built at run time'],
    ['gh api -X "$M" repos/{owner}/{repo}/pulls/1/merge', 'built at run time'],
    ['gh api repos/{owner}/{repo}/pulls/1/reviews $ARGS', 'built at run time'],
    ['gh api "$E"', 'built at run time'],
    ['gh api -X PUT "repos/{owner}/{repo}/pulls/$PR/merge"', 'endpoint of this `gh api` write'],
    ['gh api repos/{owner}/{repo}/pulls/1/reviews -f event="$E"', 'review event'],
    ['gh api repos/{owner}/{repo}/pulls/1/reviews -F event=@e.txt', 'review event'],
    ['gh api repos/{owner}/{repo}/pulls/1/reviews --input review.json', 'review event'],
    ['gh api repos/{owner}/{repo}/pulls/1/reviews -f "$K=APPROVE"', 'review event'],
    ['gh api repos/{owner}/{repo}/pulls/1/reviews -f event=COMMENT -f "$K=x"', 'review event'],
    ['echo x | xargs gh api -X POST', 'endpoint comes from its input'],
    ['echo 1 | xargs gh api -X POST repos/{owner}/{repo}/pulls', 'arguments of `gh api` come'],
  ])('%s is unread', (command, why) => {
    const action = one(command);
    expect(action?.kind).toBe('unread');
    expect(action?.kind === 'unread' && action.why).toContain(why);
  });

  test('a review body built at run time is still read', () => {
    expect(
      kinds('gh api repos/{owner}/{repo}/pulls/1/reviews -f event=COMMENT -f body="$B"'),
    ).toEqual(['comment']);
  });
  test('a command that does not parse is refused when it writes through gh api', () => {
    expect(kinds('gh api -X PUT repos/x/merge "')).toEqual(['unread']);
    expect(kinds('gh api -XPUT repos/o/r/pulls/1/merge "')).toEqual(['unread']);
    expect(kinds('gh api -Fquery=@q.graphql graphql "')).toEqual(['unread']);
    expect(kinds('gh api repos/x "')).toEqual([]);
  });
});

describe('gh api graphql', () => {
  test.each([
    ['{ viewer { login } }', []],
    ['query { repository(owner:"o",name:"r"){ id } }', []],
    ['query { search(query:"mutation mergePullRequest(", type:REPOSITORY) { issueCount } }', []],
    ['# mutation { mergePullRequest(input:{}) { x } }\n{ viewer { login } }', []],
    ['mutation { createIssue(input:{}) { clientMutationId } }', []],
    ['mutation { createPullRequest(input:{}) { clientMutationId } }', ['pr']],
    ['mutation { mergePullRequest(input:{}) { clientMutationId } }', ['merge']],
    ['mutation { m: enablePullRequestAutoMerge(input:{}) { clientMutationId } }', ['merge']],
    ['mutation { addPullRequestReview(input:{event: APPROVE}) { clientMutationId } }', ['approve']],
    [
      'mutation { addPullRequestReview(input:{event: COMMENT, body: "APPROVE"}) { x } }',
      ['comment'],
    ],
    [
      'mutation { submitPullRequestReview(input:{event: COMMENT}) { clientMutationId } }',
      ['comment'],
    ],
    ['mutation { addPullRequestReviewComment(input:{}) { x } }', ['comment']],
    ['mutation { addComment(input:{}) { clientMutationId } }', ['comment']],
    ['mutation { resolveReviewThread(input:{}) { clientMutationId } }', ['comment']],
    ['mutation { createCommitOnBranch(input:{}) { clientMutationId } }', ['push']],
    ['mutation { createLinkedBranch(input:{}) { clientMutationId } }', ['push']],
    ['mutation { markPullRequestReadyForReview(input:{}) { clientMutationId } }', ['pr']],
    ['mutation { convertPullRequestToDraft(input:{}) { clientMutationId } }', []],
    ['mutation { updatePullRequestBranch(input:{}) { clientMutationId } }', ['push']],
    ['mutation { updatePullRequestBranch(input:{updateMethod: MERGE}) { x } }', ['push']],
    ['mutation { mergePullRequest (input:{pullRequestId:"x"}) { x } }', ['merge']],
    ['mutation { addComment(input:{subjectId:"x", body:"createRef(x)"}) { x } }', ['comment']],
    [
      String.raw`mutation { addComment(input:{body:"""a \""" mergePullRequest( b"""}) { x } }`,
      ['comment'],
    ],
    ['mutation { addComment(input:{}) { subject { id } } }', ['comment']],
  ])('%s', (query, expected) => {
    expect(q(query)).toEqual(expected);
  });
  test('a GitHub Enterprise GraphQL URL is read as GraphQL', () => {
    const merge = 'mutation { mergePullRequest(input:{}) { x } }';
    expect(kinds(`gh api https://ghe.example.com/api/graphql -f query='${merge}'`)).toEqual([
      'merge',
    ]);
  });
  test('a merge by GraphQL id cannot be looked up', () => {
    expect(
      ghActions("gh api graphql -f query='mutation { mergePullRequest(input:{}) { x } }'")[0],
    ).toMatchObject({ lookup: { cannot: 'unnamed' } });
  });
  test('a pull request branch update that rebases needs a bare force', () => {
    expect(update('REBASE')).toMatchObject({ ref: { force: true } });
    expect(update('MERGE')).not.toMatchObject({ ref: { force: true } });
    expect(update('$m', '-f m=REBASE')).toMatchObject({ ref: { force: true } });
    expect(update('$m', '-f m=MERGE')).not.toMatchObject({ ref: { force: true } });
    expect(update('$m', '-f m="$M"')).toMatchObject({ ref: { force: true } });
  });
  test('a ref mutation that forces needs a bare force', () => {
    const force = 'mutation { updateRef(input:{refId: "x", oid: "y", force: true}) { x } }';
    expect(one(`gh api graphql -f query='${force}'`)).toMatchObject({ ref: { force: true } });
    const plain = 'mutation { updateRef(input:{refId: "x", oid: "y"}) { x } }';
    expect(one(`gh api graphql -f query='${plain}'`)).toEqual({
      kind: 'push',
      ref: { asks: 'the gate does not read which branch a GraphQL mutation writes' },
    });
    const unforced = 'mutation { updateRef(input:{refId: "x", oid: "y", force: false}) { x } }';
    expect(one(`gh api graphql -f query='${unforced}'`)).not.toMatchObject({
      ref: { force: true },
    });
    const input = 'mutation($input: UpdateRefInput!) { updateRef(input: $input) { x } }';
    expect(
      one(`gh api graphql -f query='${input}' -F 'input[force]=true' -f 'input[oid]=y'`),
    ).toMatchObject({ ref: { force: true } });
    const variable = 'mutation($f: Boolean) { updateRef(input:{refId: "x", force: $f}) { x } }';
    expect(one(`gh api graphql -f query='${variable}' -F f=false`)).not.toMatchObject({
      ref: { force: true },
    });
    expect(one(`gh api graphql -f query='${variable}' -F f=true`)).toMatchObject({
      ref: { force: true },
    });
    expect(one(`gh api graphql -f query='${variable}'`)).toMatchObject({ ref: { force: true } });
  });
  test('a review event in a variable is read from its field', () => {
    const query =
      'mutation($e: PullRequestReviewEvent) { addPullRequestReview(input:{event: $e}) { x } }';
    expect(q(query, '-f e=APPROVE')).toEqual(['approve']);
    expect(q(query, '-f e=COMMENT')).toEqual(['comment']);
    expect(q(query, '-f e="$E"')).toEqual(['unread']);
    expect(q(query, '-f e=COMMENT -f note=APPROVE')).toEqual(['comment']);
    // No field and no default send no event: a pending review.
    expect(q(query)).toEqual(['comment']);
    const spaced =
      'mutation($e: PullRequestReviewEvent ! = APPROVE) { addPullRequestReview(input:{event: $e}) { x } }';
    expect(q(spaced)).toEqual(['approve']);
    const undeclared = 'mutation { addPullRequestReview(input:{event: $e}) { x } }';
    expect(q(undeclared)).toEqual(['unread']);
  });
  test('an approving review beside a commenting one approves', () => {
    const two =
      'mutation { a: addPullRequestReview(input:{event: COMMENT}) { x } b: submitPullRequestReview(input:{event: APPROVE}) { x } }';
    expect(q(two)).toEqual(['approve', 'approve']);
    const same =
      'mutation { a: addPullRequestReview(input:{event: COMMENT}) { x } b: addPullRequestReview(input:{event: APPROVE}) { x } }';
    expect(q(same)).toEqual(['approve']);
    const input =
      'mutation($input: SubmitPullRequestReviewInput!) { a: addPullRequestReview(input:{event: COMMENT}) { x } b: submitPullRequestReview(input: $input) { x } }';
    expect(q(input, "-F 'input[event]=APPROVE'")).toEqual(['approve', 'approve']);
    expect(q(input, '-F input=@f.json')).toEqual(['unread', 'unread']);
    expect(q(input, '-f "input[event]=$EV"')).toEqual(['unread', 'unread']);
    expect(q(input, "-F 'input[event]=COMMENT'")).toEqual(['comment', 'comment']);
  });
  test('a written-out comment review with a body read at run time stays a comment', () => {
    const query =
      'mutation($b: String) { addPullRequestReview(input:{event: COMMENT, body: $b}) { x } }';
    expect(q(query, '-F b=@notes.md')).toEqual(['comment']);
    const input =
      'mutation($input: AddPullRequestReviewInput!) { addPullRequestReview(input: $input) { x } }';
    expect(q(input, "-f 'input[event]=COMMENT' -F 'input[body]=@notes.md'")).toEqual(['comment']);
    const literal =
      'mutation($b: String) { addPullRequestReview(input:{pullRequestId: "x", body: $b}) { x } }';
    expect(q(literal, '-F b=@notes.md')).toEqual(['comment']);
  });
  test('a variable named event is read from its field, not its definition', () => {
    const query =
      'mutation($id: ID!, $event: PullRequestReviewEvent!) { addPullRequestReview(input: {pullRequestId: $id, event: $event}) { x } }';
    expect(q(query, '-f id=PR_1 -f event=APPROVE')).toEqual(['approve']);
    expect(q(query, '-f id=PR_1 -f event=COMMENT')).toEqual(['comment']);
  });
  test("a review event variable's default counts when no field sets it", () => {
    const query =
      'mutation($e: PullRequestReviewEvent = APPROVE) { addPullRequestReview(input:{event: $e}) { x } }';
    expect(q(query)).toEqual(['approve']);
    expect(q(query, '-f e=COMMENT')).toEqual(['comment']);
  });
  test('a review event inside an input variable is read from its field', () => {
    const query =
      'mutation($input: AddPullRequestReviewInput!) { addPullRequestReview(input: $input) { x } }';
    expect(q(query, "-f 'input[event]=APPROVE'")).toEqual(['approve']);
    expect(q(query, "-f 'input[event]=COMMENT'")).toEqual(['comment']);
    expect(q(query, '-f "input[event]=$E"')).toEqual(['unread']);
    expect(q(query, '-F input=@review.json')).toEqual(['unread']);
  });
  test('a query built at run time or read from a file is unread', () => {
    expect(kinds('gh api graphql -f query="$Q"')).toEqual(['unread']);
    expect(kinds('gh api graphql -F query=@q.graphql')).toEqual(['unread']);
    expect(kinds('gh api graphql --input q.json')).toEqual(['unread']);
  });
});

const merge = (lookup: unknown) => ({ kind: 'merge', admin: false, lookup });

describe('GitHub MCP tools', () => {
  test.each([
    ['mcp__github__create_pull_request', {}, { kind: 'pr' }],
    ['mcp__github__create_pull_request_with_copilot', {}, { kind: 'pr' }],
    [
      'mcp__github__merge_pull_request',
      { owner: 'o', repo: 'r', pullNumber: 5 },
      merge(['5', '--repo', 'o/r']),
    ],
    [
      'mcp__github__merge_pull_request',
      { owner: 'o', repo: 'r', pullNumber: '5' },
      merge(['5', '--repo', 'o/r']),
    ],
    ['mcp__github__merge_pull_request', { pullNumber: 5 }, merge({ cannot: 'unnamed' })],
    [
      'mcp__github__merge_pull_request',
      { owner: 'o', repo: 'r', pullNumber: '--web' },
      merge({ cannot: 'unnamed' }),
    ],
    [
      'mcp__github__merge_pull_request',
      { owner: '--json', repo: 'r', pullNumber: 5 },
      merge({ cannot: 'unnamed' }),
    ],
    ['mcp__github__pull_request_review_write', { event: 'APPROVE' }, { kind: 'approve' }],
    ['mcp__github__pull_request_review_write', { event: 'approve' }, { kind: 'approve' }],
    ['mcp__github__pull_request_review_write', { method: 'create' }, { kind: 'comment' }],
    ['mcp__github__add_issue_comment', {}, { kind: 'comment' }],
    ['mcp__github__add_reply_to_pull_request_comment', {}, { kind: 'comment' }],
    ['mcp__github__add_comment_to_pending_review', {}, { kind: 'comment' }],
    ['mcp__github__update_issue_comment', {}, { kind: 'comment' }],
    [
      'mcp__github__push_files',
      { owner: 'o', repo: 'r', branch: 'x' },
      { kind: 'push', ref: { branch: 'x', repo: 'o/r' } },
    ],
    [
      'mcp__github__push_files',
      { owner: 'o', repo: 'r', branch: 'refs/heads/main' },
      { kind: 'push', ref: { branch: 'main', repo: 'o/r' } },
    ],
    [
      'mcp__github__push_files',
      { owner: 'o', repo: 'r', branch: '' },
      { kind: 'push', ref: { asks: 'it names no branch' } },
    ],
    [
      'mcp__github__create_or_update_file',
      { branch: 'x' },
      { kind: 'push', ref: { asks: 'it does not name its repository' } },
    ],
    [
      'mcp__github__create_or_update_file',
      { owner: 'o', branch: 'x' },
      { kind: 'push', ref: { asks: 'it does not name its repository' } },
    ],
    [
      'mcp__github__delete_file',
      { owner: 'o', repo: 'r' },
      { kind: 'push', ref: { asks: 'it names no branch' } },
    ],
    [
      'mcp__github__create_branch',
      { owner: 'o', repo: 'r', branch: 'x' },
      { kind: 'push', ref: { branch: 'x', repo: 'o/r' } },
    ],
    [
      'mcp__github__update_pull_request_branch',
      { owner: 'o', pullNumber: 7 },
      { kind: 'push', ref: { asks: 'the pull request it updates cannot be looked up' } },
    ],
    [
      'mcp__github__update_pull_request_branch',
      { owner: 'o', repo: 'r', pullNumber: 'x' },
      { kind: 'push', ref: { asks: 'the pull request it updates cannot be looked up' } },
    ],
    [
      'mcp__github__update_pull_request_branch',
      {},
      { kind: 'push', ref: { asks: 'the pull request it updates cannot be looked up' } },
    ],
    [
      'mcp__github__update_pull_request_branch',
      { owner: 'o', repo: 'r', pullNumber: 7 },
      { kind: 'push', ref: { head: ['7', '--repo', 'o/r'] } },
    ],
    ['mcp__github__list_pull_requests', {}, null],
    ['mcp__github__update_pull_request', { draft: false }, { kind: 'pr' }],
    ['mcp__github__update_pull_request', { draft: true }, null],
    ['mcp__github__update_pull_request', { draft: 'false' }, { kind: 'pr' }],
    ['mcp__github__update_pull_request', { title: 'x' }, null],
  ])('%s %j', (tool, input, expected) => {
    expect(mcpAction(tool, input)).toEqual(expected);
  });
  test('the matcher takes any server name and only the write tools', () => {
    expect(MCP_GITHUB.test('mcp__github__merge_pull_request')).toBe(true);
    expect(MCP_GITHUB.test('mcp__my__gh__push_files')).toBe(true);
    expect(MCP_GITHUB.test('mcp__github__list_pull_requests')).toBe(false);
    expect(MCP_GITHUB.test('mcp__github__merge_pull_request_status')).toBe(false);
    expect(MCP_GITHUB.test('merge_pull_request')).toBe(false);
  });
  test('a refusal quotes the short arguments, without prose or hidden characters', () => {
    expect(
      shownCall('mcp__github__push_files', {
        tool: 'mcp__github__push_files',
        tool_use_id: 't1',
        owner: 'o',
        branch: 'x‮y',
        path: { x: 1 },
        message: 'long',
        files: [{ path: 'a' }],
      }),
    ).toBe('mcp__github__push_files {"owner":"o","branch":"x\u{FFFD}y"}');
  });
});
