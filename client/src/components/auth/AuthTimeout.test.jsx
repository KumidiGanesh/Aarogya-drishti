import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AuthTimeout from './AuthTimeout.jsx';

const authState = vi.hoisted(() => ({
  user: { id: 'demo-user', role: 'patient' },
  logout: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('../../auth/AuthContext.jsx', () => ({
  useAuth: () => authState,
}));

describe('AuthTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('restarts the inactivity warning and logout timers when the user is active', async () => {
    vi.useFakeTimers();
    render(<AuthTimeout />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(14 * 60 * 1000);
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.pointerDown(window);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(14 * 60 * 1000);
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
