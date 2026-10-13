import { describe, expect, it } from 'vitest';
import { parseAppleHealthExport, createAppleHealthParser, isSupportedAppleType } from './apple-health';

function sample(type: string, value: number | string, unit: string, start = '2026-10-01T08:00:00Z', end = '2026-10-01T09:00:00Z', source = 'Watch', created = end) {
  return `<Record type="HKQuantityTypeIdentifier${type}" sourceName="${source}" unit="${unit}" value="${value}" startDate="${start}" endDate="${end}" creationDate="${created}"/>`;
}
const parse = (xml: string, zone = 'UTC') => parseAppleHealthExport(`<HealthData>${xml}</HealthData>`, zone);
const values = (xml: string, zone = 'UTC') => parse(xml, zone).sessions.flatMap((session) => session.entries);

describe('Apple activity aggregation', () => {
  it('maps all eight types to separate activity metrics with canonical units', () => {
    const result = parse([
      sample('StepCount', 100, 'count'), sample('DistanceWalkingRunning', 1000, 'm'),
      sample('ActiveEnergyBurned', 418.4, 'kJ'), sample('BasalEnergyBurned', 250, 'kcal'),
      sample('WalkingSpeed', 1, 'm/s'), sample('WalkingStepLength', 0.6, 'm'),
      sample('WalkingDoubleSupportPercentage', 0.25, '%'), sample('WalkingAsymmetryPercentage', 0.02, '%'),
    ].join(''));
    expect(result.mapped).toBe(8); expect(result.skipped).toBe(0);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({ kind: 'activity', sourceKey: 'activity:2026-10-01' });
    expect(Object.fromEntries(result.sessions[0].entries.map((entry) => [entry.key, entry.value]))).toEqual({
      'daily-steps': '100', 'walking-running-distance': '1', 'active-energy': '100', 'resting-energy': '250',
      'walking-speed': '3.6', 'walking-step-length': '60', 'walking-double-support': '25', 'walking-asymmetry': '2',
    });
  });

  it('sums sequential cumulative samples instead of retaining the last sample', () => {
    const [entry] = values(sample('StepCount', 100, 'count') + sample('StepCount', 250, 'count', '2026-10-01T09:00:00Z', '2026-10-01T10:00:00Z'));
    expect(entry.value).toBe('350'); expect(entry.dailySummary).toMatchObject({ sampleCount: 2, coverageSeconds: 7200, estimated: false });
  });

  it('keeps a device together across restarts and software updates', () => {
    const first = sample('StepCount', 100, 'count').replace('/>', ' device="&lt;&lt;HKDevice: 0x123&gt;, name:Apple Watch, manufacturer:Apple Inc., model:Watch, hardware:Watch5, software:12.0&gt;"/>');
    const second = sample('StepCount', 100, 'count', '2026-10-01T09:00:00Z', '2026-10-01T10:00:00Z').replace('/>', ' device="&lt;&lt;HKDevice: 0x456&gt;, name:Apple Watch, manufacturer:Apple Inc., model:Watch, hardware:Watch5, software:12.1&gt;"/>');
    expect(values(first + second)[0]).toMatchObject({ value: '200', dailySummary: { sampleCount: 2, coverageSeconds: 7200, excludedSamples: 0 } });
  });

  it('preserves commas in hardware identifiers when separating devices', () => {
    const first = sample('StepCount', 100, 'count').replace('/>', ' device="&lt;&lt;HKDevice: 0x123&gt;, name:Apple Watch, hardware:Watch6,4, software:12.0&gt;"/>');
    const second = sample('StepCount', 100, 'count', '2026-10-01T09:00:00Z', '2026-10-01T10:00:00Z').replace('/>', ' device="&lt;&lt;HKDevice: 0x456&gt;, name:Apple Watch, hardware:Watch6,8, software:12.0&gt;"/>');
    expect(values(first + second)[0]).toMatchObject({ value: '100', dailySummary: { sampleCount: 1, coverageSeconds: 3600, excludedSamples: 1 } });
    expect(values(first + second)).toEqual(values(second + first));
  });

  it('weights walking averages by duration', () => {
    const [entry] = values(sample('WalkingSpeed', 3, 'km/hr') + sample('WalkingSpeed', 6, 'km/hr', '2026-10-01T09:00:00Z', '2026-10-01T09:30:00Z'));
    expect(entry.value).toBe('4');
  });

  it('counts identical samples once, including repeats with another creation date', () => {
    const [entry] = values(sample('StepCount', 100, 'count') + sample('StepCount', 100, 'count', undefined, undefined, undefined, '2026-10-02T09:00:00Z'));
    expect(entry.value).toBe('100'); expect(entry.dailySummary).toMatchObject({ sampleCount: 1, excludedSamples: 1 });
  });

  it('chooses one source per metric and day using coverage, not the largest value', () => {
    const [entry] = values(sample('StepCount', 100, 'count') + sample('StepCount', 900, 'count', '2026-10-01T08:00:00Z', '2026-10-01T08:30:00Z', 'Phone'));
    expect(entry.value).toBe('100'); expect(entry.dailySummary).toMatchObject({ source: 'Watch', excludedSamples: 1 });
  });

  it('resolves source ties deterministically, regardless of XML ordering', () => {
    const a = sample('StepCount', 100, 'count', undefined, undefined, 'A');
    const b = sample('StepCount', 500, 'count', undefined, undefined, 'B');
    expect(parse(a + b)).toEqual(parse(b + a));
    expect(values(a + b)[0].value).toBe('100');
  });

  it('uses newer recordings for overlapping intervals without counting both', () => {
    const old = sample('StepCount', 100, 'count', '2026-10-01T08:00:00Z', '2026-10-01T10:00:00Z');
    const newer = sample('StepCount', 80, 'count', '2026-10-01T09:00:00Z', '2026-10-01T11:00:00Z');
    const [entry] = values(newer + old);
    expect(entry.value).toBe('130'); expect(entry.dailySummary).toMatchObject({ coverageSeconds: 10800, estimated: true });
    expect(values(old + newer)).toEqual(values(newer + old));
  });

  it('takes a corrected same-interval sample instead of adding it', () => {
    const [entry] = values(sample('StepCount', 100, 'count') + sample('StepCount', 120, 'count', undefined, undefined, undefined, '2026-10-02T00:00:00Z'));
    expect(entry.value).toBe('120'); expect(entry.dailySummary?.excludedSamples).toBe(1);
  });

  it('splits cumulative values across midnight in the patient time zone', () => {
    const result = parse(sample('StepCount', 200, 'count', '2026-10-01T14:00:00Z', '2026-10-01T16:00:00Z'), 'Asia/Tokyo');
    expect(result.sessions.map((session) => session.sourceKey)).toEqual(['activity:2026-10-01', 'activity:2026-10-02']);
    expect(result.sessions.map((session) => session.entries[0].value)).toEqual(['100', '100']);
    expect(result.sessions[0].entries[0].dailySummary?.estimated).toBe(true);
  });

  it.each([
    ['2026-03-08T05:00:00Z', '2026-03-09T04:00:00Z', 23, '2026-03-08'],
    ['2026-11-01T04:00:00Z', '2026-11-02T05:00:00Z', 25, '2026-11-01'],
  ])('keeps an entire DST day in one summary (%s)', (start, end, hours, date) => {
    const result = parse(sample('BasalEnergyBurned', 2000, 'kcal', start, end), 'America/New_York');
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].entries[0]).toMatchObject({ value: '2000', dailySummary: { date, coverageSeconds: Number(hours) * 3600, estimated: false } });
  });

  it('accepts point-in-time cumulative entries and deduplicates their timestamp', () => {
    const [entry] = values(sample('StepCount', 100, 'count', '2026-10-01T08:00:00Z', '2026-10-01T08:00:00Z') + sample('StepCount', 120, 'count', '2026-10-01T08:00:00Z', '2026-10-01T08:00:00Z', 'Watch', '2026-10-02T00:00:00Z'));
    expect(entry.value).toBe('120');
  });

  it('rejects invalid units, values, percentages and intervals', () => {
    const result = parse(sample('StepCount', -1, 'count') + sample('StepCount', '', 'count') + sample('StepCount', 100, 'kg') + sample('WalkingDoubleSupportPercentage', 25, '%') + sample('WalkingSpeed', 3, 'km/hr', '2026-10-01T09:00:00Z', '2026-10-01T08:00:00Z'));
    expect(result.sessions).toHaveLength(0); expect(result.skipped).toBe(5);
  });

  it('keeps supported types out of the unsupported list even without valid samples', () => {
    expect(isSupportedAppleType('HKQuantityTypeIdentifierStepCount')).toBe(true);
    expect(isSupportedAppleType('HKQuantityTypeIdentifierBodyMass')).toBe(true);
    expect(isSupportedAppleType('HKQuantityTypeIdentifierUnknown')).toBe(false);
    expect(isSupportedAppleType('__proto__')).toBe(false);
  });

  it('parses sources and records split across XML chunks', () => {
    const xml = sample('StepCount', 100, 'count', undefined, undefined, 'Phone &amp; Watch');
    const parser = createAppleHealthParser('UTC');
    for (let index = 0; index < xml.length; index += 17) parser.push(xml.slice(index, index + 17));
    expect(parser.finish().sessions[0].entries[0].dailySummary?.source).toBe('Phone & Watch');
  });

  it('keeps resting energy distinct from BMR and existing body measurements', () => {
    const result = parse(sample('BasalEnergyBurned', 1000, 'kcal') + sample('BodyMass', 70, 'kg'));
    expect(result.sessions.map((session) => session.kind).sort()).toEqual(['activity', 'body']);
    expect(result.sessions.flatMap((session) => session.entries).some((entry) => entry.key === 'basal-metabolic-rate')).toBe(false);
  });
});
