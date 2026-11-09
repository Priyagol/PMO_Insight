import { render, screen } from '@testing-library/react';
import { Component, Suspense, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isStaleChunkError, lazyFresh } from './lazy-fresh';

class Boundary extends Component<{ children: ReactNode }, { error: string | null }> {
  override state = { error: null as string | null };
  static getDerivedStateFromError(e: Error) {
    return { error: e.message };
  }
  override render() {
    return this.state.error ? <p>failed: {this.state.error}</p> : this.props.children;
  }
}

const stale = () =>
  Promise.reject(new TypeError('Failed to fetch dynamically imported module: /assets/Timer-x.js'));

describe('lazyFresh', () => {
  const reload = vi.fn();
  beforeEach(() => {
    sessionStorage.clear();
    vi.stubGlobal('location', { ...window.location, reload });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    reload.mockReset();
  });

  it('recognises the error a browser gives for a removed code file', () => {
    expect(isStaleChunkError(new TypeError('Failed to fetch dynamically imported module: x'))).toBe(
      true,
    );
    expect(isStaleChunkError(new Error('Request failed (500)'))).toBe(false);
  });

  it('reloads once after a new deployment, and shows the error if it happens again', async () => {
    const Page = lazyFresh(stale);
    const view = render(
      <Boundary>
        <Suspense fallback={<p>loading</p>}>
          <Page />
        </Suspense>
      </Boundary>,
    );
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(screen.getByText('loading')).toBeInTheDocument();
    view.unmount();

    const Again = lazyFresh(stale);
    render(
      <Boundary>
        <Suspense fallback={<p>loading</p>}>
          <Again />
        </Suspense>
      </Boundary>,
    );
    expect(
      await screen.findByText(/failed: Failed to fetch dynamically imported module/),
    ).toBeInTheDocument();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
