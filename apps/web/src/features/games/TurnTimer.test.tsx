import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import '@/lib/i18n';
import type { TurnTimerState } from './types';
import { TurnTimer } from './TurnTimer';

function makeState(remainingSec: number, base = Date.now()): TurnTimerState {
  return {
    activeUserId: 'u-me',
    deadlineAt: new Date(base + remainingSec * 1000).toISOString(),
    durationMs: 60_000,
  };
}

describe('TurnTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when state is null', () => {
    const { container } = render(<TurnTimer state={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the remaining seconds with the default tone above 30s', () => {
    render(<TurnTimer state={makeState(45)} />);
    const el = screen.getByTestId('turn-timer');
    expect(el.dataset.remainingSeconds).toBe('45');
    // Default tone: slate (>=30s).
    expect(el.className).toContain('bg-slate-700/80');
    expect(el.className).not.toContain('bg-amber-500');
    expect(el.className).not.toContain('bg-red-600');
  });

  it('switches to amber tone when remaining < 30s', () => {
    render(<TurnTimer state={makeState(20)} />);
    const el = screen.getByTestId('turn-timer');
    expect(el.dataset.remainingSeconds).toBe('20');
    expect(el.className).toContain('bg-amber-500');
    expect(el.className).not.toContain('bg-red-600');
  });

  it('switches to red tone when remaining < 10s', () => {
    render(<TurnTimer state={makeState(7)} />);
    const el = screen.getByTestId('turn-timer');
    expect(el.dataset.remainingSeconds).toBe('7');
    expect(el.className).toContain('bg-red-600');
  });

  it('clamps to 0 when the deadline has already passed', () => {
    render(<TurnTimer state={makeState(-5)} />);
    const el = screen.getByTestId('turn-timer');
    expect(el.dataset.remainingSeconds).toBe('0');
    // 0 < 10 → red tone.
    expect(el.className).toContain('bg-red-600');
    expect(el.textContent).toBe('0');
  });

  it('formats values >=60s as mm:ss', () => {
    render(<TurnTimer state={makeState(75)} />);
    expect(screen.getByTestId('turn-timer').textContent).toBe('1:15');
  });

  it('counts down once a second', () => {
    const state = makeState(15);
    render(<TurnTimer state={state} />);
    expect(screen.getByTestId('turn-timer').dataset.remainingSeconds).toBe('15');
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByTestId('turn-timer').dataset.remainingSeconds).toBe('14');
  });

  it('uses the mini variant for compact seat chips', () => {
    render(<TurnTimer state={makeState(20)} variant="mini" />);
    const el = screen.getByTestId('turn-timer');
    // Mini variant uses ring-1 instead of ring-2 (regression guard).
    expect(el.className).toContain('ring-1');
  });
});
