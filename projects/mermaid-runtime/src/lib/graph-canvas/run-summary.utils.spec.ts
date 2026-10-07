import type { MermaidRuntime } from '../task-graph-model';
import { formatDurationMs, getLiveNodeTimeMs, getNodeDurationMs, measureGroupTimeMs, measureSpanMs, summariseRun } from './run-summary.utils';

const node = (status: string, extra: Partial<MermaidRuntime.Node> = {}): MermaidRuntime.Node => ({ id: Math.random().toString(36), title: 't', status, ...extra });

describe('summariseRun', () => {
  it('is idle until a step starts', () => {
    expect(summariseRun([]).state).toBe('idle');
    expect(summariseRun([node('undone'), node('undone')]).state).toBe('idle');
  });

  it('is running while a step runs or steps are waiting', () => {
    expect(summariseRun([node('complete'), node('running'), node('undone')]).state).toBe('running');
    expect(summariseRun([node('complete'), node('undone')]).state).toBe('running');
  });

  it('is complete when everything is complete or skipped', () => {
    const summary = summariseRun([node('complete'), node('complete'), node('skipped')]);
    expect(summary).toEqual(jasmine.objectContaining({ state: 'complete', total: 3, complete: 2, skipped: 1, failed: 0 }));
  });

  it('is failed when a step failed and none is running, and running while one still is', () => {
    expect(summariseRun([node('complete'), node('failed'), node('undone')]).state).toBe('failed');
    expect(summariseRun([node('failed'), node('running')]).state).toBe('running');
  });

  it('does not read an unknown status as finished', () => {
    expect(summariseRun([node('complete'), node('queued')]).state).toBe('running');
  });

  it('reports no time when the steps carry none', () => {
    expect(summariseRun([node('complete')]).durationMs).toBeNull();
  });
});

describe('step timing', () => {
  const T0 = '2026-10-07T10:00:00.000Z';
  const T1 = '2026-10-07T10:00:02.000Z';
  const T2 = '2026-10-07T10:00:05.000Z';

  it('prefers durationMs and falls back to the timestamps', () => {
    expect(getNodeDurationMs({ durationMs: 1200 })).toBe(1200);
    expect(getNodeDurationMs({ startedAt: T0, endedAt: T1 })).toBe(2000);
    expect(getNodeDurationMs({ startedAt: T0 })).toBeNull();
    expect(getNodeDurationMs({ durationMs: -1 })).toBeNull();
  });

  it('measures the wall clock across overlapping steps, not the sum', () => {
    expect(measureSpanMs([{ startedAt: T0, endedAt: T2 }, { startedAt: T1, endedAt: T2 }])).toBe(5000);
  });

  it('sums durations when there are no timestamps', () => {
    expect(measureSpanMs([{ durationMs: 1000 }, { durationMs: 500 }])).toBe(1500);
    expect(measureSpanMs([{}])).toBeNull();
  });
});

describe('live step and group time', () => {
  const START = '2026-10-07T10:00:00.000Z';
  const START_MS = Date.parse(START);

  it('shows a finished step its recorded time and a waiting step nothing', () => {
    expect(getLiveNodeTimeMs({ status: 'complete', durationMs: 900 }, START_MS)).toBe(900);
    expect(getLiveNodeTimeMs({ status: 'failed', durationMs: 400 }, START_MS)).toBe(400);
    expect(getLiveNodeTimeMs({ status: 'undone', durationMs: 900 }, START_MS)).toBeNull();
    expect(getLiveNodeTimeMs({ status: 'skipped', durationMs: 900 }, START_MS)).toBeNull();
  });

  it('counts a running step up from its start, or shows nothing without one', () => {
    expect(getLiveNodeTimeMs({ status: 'running', startedAt: START }, START_MS + 3000)).toBe(3000);
    expect(getLiveNodeTimeMs({ status: 'running' }, START_MS)).toBeNull();
  });

  it('measures a finished group as the span of its steps', () => {
    const members = [
      { status: 'complete', startedAt: START, endedAt: '2026-10-07T10:00:03.000Z' },
      { status: 'complete', startedAt: '2026-10-07T10:00:01.000Z', endedAt: '2026-10-07T10:00:06.000Z' },
    ];
    expect(measureGroupTimeMs(members, START_MS + 60000)).toBe(6000);
  });

  it('counts a group with a running step up from its first start', () => {
    const members = [{ status: 'complete', startedAt: START, endedAt: '2026-10-07T10:00:02.000Z' }, { status: 'running', startedAt: '2026-10-07T10:00:02.000Z' }];
    expect(measureGroupTimeMs(members, START_MS + 5000)).toBe(5000);
  });

  it('has no group time when nothing has timing', () => {
    expect(measureGroupTimeMs([{ status: 'undone' }, { status: 'complete' }], START_MS)).toBeNull();
  });
});

describe('formatDurationMs', () => {
  it('formats short, medium and long times', () => {
    expect(formatDurationMs(850)).toBe('850 ms');
    expect(formatDurationMs(2340)).toBe('2.3 s');
    expect(formatDurationMs(48000)).toBe('48 s');
    expect(formatDurationMs(65000)).toBe('1m 05s');
    expect(formatDurationMs(3720000)).toBe('1h 02m');
  });

  it('gives an empty string for missing or invalid values', () => {
    expect(formatDurationMs(null)).toBe('');
    expect(formatDurationMs(undefined)).toBe('');
    expect(formatDurationMs(-5)).toBe('');
    expect(formatDurationMs(Number.NaN)).toBe('');
  });
});
