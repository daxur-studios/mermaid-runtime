import type { RunSummary } from '../graph-canvas/run-summary.utils';
import { describeRunResult, pickBannerMessage, type BannerInputs } from './banner-message.utils';

const summary = (extra: Partial<RunSummary> = {}): RunSummary => ({ state: 'complete', total: 12, complete: 12, skipped: 0, failed: 0, running: 0, pending: 0, durationMs: 48000, ...extra });
const inputs = (extra: Partial<BannerInputs> = {}): BannerInputs => ({ run: summary({ state: 'running' }), runResultVisible: false, hostMessage: null, outOfView: false, followPaused: false, ...extra });

describe('describeRunResult', () => {
  it('shows steps and time for a clean run', () => {
    expect(describeRunResult(summary())).toBe('Run complete · 12 of 12 steps · 48 s');
  });

  it('notes skipped steps and omits time when there is none', () => {
    expect(describeRunResult(summary({ complete: 10, skipped: 2, durationMs: null }))).toBe('Run complete · 10 of 12 steps · 2 skipped');
  });

  it('says what failed', () => {
    expect(describeRunResult(summary({ state: 'failed', complete: 7, failed: 1, durationMs: 5000 }))).toBe('Run failed · 1 failed · 7 of 12 steps complete · 5.0 s');
  });
});

describe('pickBannerMessage', () => {
  it('shows nothing when there is nothing to say', () => {
    expect(pickBannerMessage(inputs())).toBeNull();
  });

  it('shows the run result only while it is meant to be visible', () => {
    expect(pickBannerMessage(inputs({ run: summary(), runResultVisible: true }))?.id).toBe('run-complete');
    expect(pickBannerMessage(inputs({ run: summary(), runResultVisible: false }))).toBeNull();
  });

  it('ranks failed above complete-style hints, and a result above navigation prompts', () => {
    expect(pickBannerMessage(inputs({ run: summary({ state: 'failed', failed: 1 }), runResultVisible: true, outOfView: true }))?.id).toBe('run-failed');
    expect(pickBannerMessage(inputs({ run: summary(), runResultVisible: true, outOfView: true }))?.id).toBe('run-complete');
  });

  it('ranks the host message above navigation prompts', () => {
    expect(pickBannerMessage(inputs({ hostMessage: { text: 'Deploying' }, outOfView: true }))).toEqual(jasmine.objectContaining({ kind: 'info', text: 'Deploying' }));
  });

  it('offers back-to-graph before re-center-on-running', () => {
    expect(pickBannerMessage(inputs({ outOfView: true, followPaused: true }))).toEqual(jasmine.objectContaining({ id: 'back-to-graph', action: 'fit' }));
    expect(pickBannerMessage(inputs({ followPaused: true }))).toEqual(jasmine.objectContaining({ id: 'recenter-running', action: 'resume-follow' }));
  });
});
