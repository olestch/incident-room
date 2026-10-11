import { expect, it } from 'vitest';
import { ScrollRecorder, scrollDebugEnabled, type GeometrySample } from './scroll-recorder';
const metadata = { commit: null, userAgent: 'test', width: 375, height: 820, devicePixelRatio: 2 };
const sample = (top = 100, anchorTop = 20): GeometrySample => ({
  scrollTop: top,
  scrollHeight: 2000,
  clientHeight: 500,
  clientWidth: 375,
  top: 50,
  bottom: 550,
  distanceFromBottom: 1400,
  offset: top,
  adjustments: 0,
  totalSize: 2000,
  rowCount: 20,
  isScrolling: false,
  direction: null,
  first: null,
  last: null,
  anchor: {
    key: 'row-1',
    index: 1,
    start: 100,
    end: 200,
    size: 100,
    top: anchorTop,
    bottom: anchorTop + 100,
    height: 100,
    transform: 'translateY(100px)',
  },
});
it('requires explicit development activation, including production query attempts', () => {
  for (const environment of ['production', 'test', undefined])
    expect(scrollDebugEnabled(environment, '1')).toBe(false);
  expect(scrollDebugEnabled('development', null)).toBe(false);
  expect(scrollDebugEnabled('development', '0')).toBe(false);
  expect(scrollDebugEnabled('development', '1')).toBe(true);
});
it('records only between start and stop and starts again without losing earlier context', () => {
  const recorder = new ScrollRecorder();
  recorder.record(null, 'ignored', {});
  expect(recorder.count).toBe(0);
  recorder.start();
  recorder.record('Timeline', 'scroll', { scrollTop: 42 });
  recorder.stop();
  const count = recorder.count;
  recorder.record(null, 'ignored', {});
  expect(recorder.count).toBe(count);
  recorder.start();
  expect(recorder.count).toBe(count + 1);
});
it('retains a bounded chronological ring and exact discarded count', () => {
  const recorder = new ScrollRecorder(3);
  recorder.start();
  for (let value = 0; value < 10; value++) recorder.record('Timeline', 'scroll', { value });
  const log = JSON.parse(recorder.export(metadata));
  expect(log.events.map((event: { sequence: number }) => event.sequence)).toEqual([9, 10, 11]);
  expect(log.retainedEventCount).toBe(3);
  expect(log.droppedEventCount).toBe(8);
  expect(log.totalEventCount).toBe(11);
  recorder.clear();
  expect(recorder.count).toBe(1);
  expect(recorder.droppedCount).toBe(0);
});
it('exports monotonic and relative times, metadata, and stable pseudonymous keys', () => {
  let now = 50;
  const recorder = new ScrollRecorder(100, undefined, () => now);
  recorder.start();
  now = 65;
  recorder.record('Timeline', 'measurement', {
    key: recorder.key('local:private-account:mutation'),
    size: 24,
  });
  const log = JSON.parse(recorder.export(metadata));
  expect(log.events[1].time).toBe(65);
  expect(log.events[1].relativeTime).toBe(15);
  expect(log.schemaVersion).toBe(1);
  expect(log.sessionId).toBeTruthy();
  expect(log.width).toBe(375);
  expect(recorder.key('local:private-account:mutation')).toBe(
    recorder.key('local:private-account:mutation'),
  );
  expect(recorder.export(metadata)).not.toContain('private-account');
});
it('distinguishes anchor movement with stable scrollTop from scroll reversal', () => {
  const recorder = new ScrollRecorder();
  recorder.start();
  recorder.sample('Timeline', sample(), 'baseline');
  recorder.sample('Timeline', sample(100, 40), 'frame');
  let log = JSON.parse(recorder.export(metadata));
  expect(
    log.anomalies.some(
      (event: { data: { signal: string } }) => event.data.signal === 'geometry-mismatch',
    ),
  ).toBe(true);
  recorder.userInput('Timeline', 'wheel', 1, false);
  recorder.sample('Timeline', sample(80, 60), 'frame');
  log = JSON.parse(recorder.export(metadata));
  expect(
    log.anomalies.some(
      (event: { data: { signal: string } }) => event.data.signal === 'scroll-reversal',
    ),
  ).toBe(true);
});
it('does not flood unchanged frames or confuse replacement anchors with jumps', () => {
  const recorder = new ScrollRecorder();
  recorder.start();
  recorder.sample('Timeline', sample(), 'frame');
  const count = recorder.count;
  for (let frame = 0; frame < 100; frame++) recorder.sample('Timeline', sample(), 'frame');
  expect(recorder.count).toBe(count);
  const changed = sample(100, 80);
  changed.anchor!.key = 'row-other';
  recorder.sample('Timeline', changed, 'frame');
  expect(JSON.parse(recorder.export(metadata)).anomalies).toEqual([]);
});
it('labels post-touch movement as a signal even when Virtual still reports momentum scrolling', () => {
  let now = 0;
  const recorder = new ScrollRecorder(100, undefined, () => now);
  recorder.start();
  recorder.sample('Timeline', sample(), 'initial');
  recorder.userInput('Timeline', 'touchend', 1, false);
  now = 200;
  const moved = sample(120, 0);
  moved.isScrolling = true;
  recorder.sample('Timeline', moved, 'frame');
  expect(
    JSON.parse(recorder.export(metadata)).anomalies.some(
      (event: { data: { signal: string; virtualScrolling: boolean } }) =>
        event.data.signal === 'post-gesture-correction' && event.data.virtualScrolling,
    ),
  ).toBe(true);
});
