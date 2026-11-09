import { lazy, type ComponentType } from 'react';

const KEY = 'aw:chunk-reload-at';

/** True for the browser error raised when a code-split file no longer exists on the server. */
export function isStaleChunkError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /dynamically imported module|Importing a module script failed|Loading chunk|error loading dynamically/i.test(
    msg,
  );
}

/**
 * React.lazy that survives a new deployment. A tab opened before a deploy still asks for the
 * old file names; when that fails, the page reloads once to pick up the new version. A second
 * failure within a minute is shown as a normal error, so a real outage cannot loop.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- same constraint as React.lazy
export function lazyFresh<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): ReturnType<typeof lazy<T>> {
  return lazy(() =>
    factory().catch((err: unknown) => {
      if (!isStaleChunkError(err)) throw err;
      let last = 0;
      try {
        last = Number(sessionStorage.getItem(KEY) ?? 0);
      } catch {
        /* storage blocked */
      }
      if (Date.now() - last < 60_000) throw err;
      try {
        sessionStorage.setItem(KEY, String(Date.now()));
      } catch {
        /* storage blocked */
      }
      window.location.reload();
      // Keep the fallback on screen while the page reloads.
      return new Promise<{ default: T }>(() => {});
    }),
  );
}
