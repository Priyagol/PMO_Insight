const KEY = 'aw:tab';
let memo: string | null = null;

const randomId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;

/**
 * This tab's session id. Kept in sessionStorage, which belongs to one tab: it survives a
 * reload but a new tab or window gets a new id, so it starts signed out. The server keeps
 * one sign-in per id.
 */
export function sessionTabId(): string {
  if (memo) return memo;
  try {
    memo = sessionStorage.getItem(KEY);
    if (!memo) {
      memo = randomId();
      sessionStorage.setItem(KEY, memo);
    }
  } catch {
    memo = randomId();
  }
  return memo;
}
