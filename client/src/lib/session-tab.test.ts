import { describe, expect, it, vi } from 'vitest';

describe('sessionTabId', () => {
  it('stays the same for this tab (survives reload) and is new for a fresh tab', async () => {
    sessionStorage.clear();
    const first = (await import('./session-tab')).sessionTabId();
    expect(first).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    // A reload keeps sessionStorage: same id.
    vi.resetModules();
    expect((await import('./session-tab')).sessionTabId()).toBe(first);
    // A new tab starts with empty sessionStorage: a different id.
    sessionStorage.clear();
    vi.resetModules();
    expect((await import('./session-tab')).sessionTabId()).not.toBe(first);
  });
});
