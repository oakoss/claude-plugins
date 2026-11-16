// The review skill hands its summary block to this tool rather than printing
// it: a tool's result folds in the transcript, where the end of a reply does
// not, so whatever the reply asks after it stays on screen.
export const SUMMARY_TOOL = 'mcp__review-cycle__summary';

// The summary as the call carries it; empty when the call carries none.
export function summaryText(input: unknown): string {
  const text = (input as { text?: unknown } | null)?.text;
  return typeof text === 'string' ? text : '';
}

// The call's header draws its input whole, the block's newlines escaped, so it
// shows a line count instead.
export function summaryHeader(input: unknown): { lines: number } {
  const text = summaryText(input);
  return { lines: text === '' ? 0 : text.split('\n').length };
}
