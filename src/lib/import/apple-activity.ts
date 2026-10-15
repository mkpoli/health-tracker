import { activityMetricByKey, type ActivityMetricKey, type DailySummary } from '$lib/metrics/activity';
import { normalizeTimeZone } from '$lib/time-zone';

const TYPES: Record<string, ActivityMetricKey> = {
  StepCount: 'daily-steps', DistanceWalkingRunning: 'walking-running-distance',
  ActiveEnergyBurned: 'active-energy', BasalEnergyBurned: 'resting-energy',
  WalkingSpeed: 'walking-speed', WalkingStepLength: 'walking-step-length',
  WalkingDoubleSupportPercentage: 'walking-double-support', WalkingAsymmetryPercentage: 'walking-asymmetry',
};
export const APPLE_ACTIVITY_TYPES = Object.fromEntries(Object.entries(TYPES).map(([name, key]) => [`HKQuantityTypeIdentifier${name}`, key]));

function convert(key: ActivityMetricKey, value: number, unit: string) {
  const factors: Record<string, Record<string, number>> = {
    'daily-steps': { count: 1 },
    'walking-running-distance': { km: 1, m: 0.001, mi: 1.609344, ft: 0.0003048 },
    'active-energy': { kcal: 1, kj: 1 / 4.184, j: 1 / 4184, cal: 0.001 },
    'resting-energy': { kcal: 1, kj: 1 / 4.184, j: 1 / 4184, cal: 0.001 },
    'walking-speed': { 'km/hr': 1, 'km/h': 1, 'm/s': 3.6, 'mi/hr': 1.609344, mph: 1.609344 },
    'walking-step-length': { cm: 1, m: 100, in: 2.54, ft: 30.48 },
    'walking-double-support': { '%': 100 }, 'walking-asymmetry': { '%': 100 },
  };
  const factor = factors[key][unit.trim().toLowerCase()];
  if (factor === undefined || !Number.isFinite(value) || value < 0) return null;
  if ((key === 'walking-double-support' || key === 'walking-asymmetry') && value > 1) return null;
  const converted = value * factor;
  return Number.isFinite(converted) ? converted : null;
}

// HKDevice descriptions contain a transient memory address and software versions.
// Use stable properties so a watch restart or update does not split its history.
function deviceIdentity(device: string) {
  const fields = new Map([...device.matchAll(/(?:^|[,>])\s*([A-Za-z]+):\s*(.*?)(?=,\s*[A-Za-z]+:|>|$)/g)]
    .map((match) => [match[1].toLowerCase(), match[2].trim()]));
  return ['localidentifier', 'udideviceidentifier', 'name', 'manufacturer', 'model', 'hardware']
    .map((key) => `${key}:${fields.get(key) ?? ''}`).join('|');
}

type Sample = { start: number; end: number; value: number; created: number; split: boolean };
type Source = { name: string; samples: Sample[] };
type Bucket = { date: string; key: ActivityMetricKey; sources: Map<string, Source> };
export type ActivityEntry = { key: string; value: string; unit: string; dailySummary: DailySummary };

function uniqueSamples(samples: Sample[]) {
  const unique = new Map<string, Sample>();
  for (const sample of samples) {
    const key = `${sample.start}/${sample.end}/${sample.value}`;
    const previous = unique.get(key);
    if (!previous || previous.created < sample.created) unique.set(key, sample);
  }
  return [...unique.values()];
}

function coverage(samples: Sample[]) {
  let end = -Infinity;
  let duration = 0;
  for (const sample of [...samples].sort((a, b) => a.start - b.start || a.end - b.end)) {
    duration += Math.max(0, sample.end - Math.max(end, sample.start));
    end = Math.max(end, sample.end);
  }
  return duration;
}

/** Integrate one source without counting overlapping intervals twice. Newer samples win. */
function summarize(samples: Sample[], mean: boolean) {
  const ranked = samples.sort((a, b) => b.created - a.created || b.start - a.start || b.end - a.end || b.value - a.value);
  const events = ranked.flatMap((sample, rank) => sample.end > sample.start
    ? [{ time: sample.start, rank, start: true }, { time: sample.end, rank, start: false }]
    : []);
  events.sort((a, b) => a.time - b.time);
  const active = new Set<number>();
  const heap: number[] = [];
  const used = new Map<number, number>();
  function push(rank: number) {
    let index = heap.length;
    heap.push(rank);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (heap[parent] <= rank) break;
      heap[index] = heap[parent]; index = parent;
    }
    heap[index] = rank;
  }
  function top() {
    while (heap.length && !active.has(heap[0])) {
      const tail = heap.pop()!;
      if (!heap.length) break;
      let index = 0;
      while (index * 2 + 1 < heap.length) {
        let child = index * 2 + 1;
        if (child + 1 < heap.length && heap[child + 1] < heap[child]) child += 1;
        if (heap[child] >= tail) break;
        heap[index] = heap[child]; index = child;
      }
      heap[index] = tail;
    }
    return heap[0];
  }
  let total = 0;
  let duration = 0;
  let previous = events[0]?.time ?? 0;
  for (let index = 0; index < events.length;) {
    const time = events[index].time;
    const rank = top();
    if (rank !== undefined && time > previous) {
      const sample = ranked[rank];
      const elapsed = time - previous;
      total += mean ? sample.value * elapsed : sample.value * elapsed / (sample.end - sample.start);
      duration += elapsed;
      used.set(rank, (used.get(rank) ?? 0) + elapsed);
    }
    while (index < events.length && events[index].time === time) {
      const event = events[index++];
      if (event.start) { active.add(event.rank); push(event.rank); }
      else active.delete(event.rank);
    }
    previous = time;
  }
  // Instantaneous cumulative entries have no duration; keep one per timestamp.
  const points = new Set<number>();
  if (!mean) for (const [rank, sample] of ranked.entries()) {
    if (sample.start !== sample.end || points.has(sample.start)) continue;
    points.add(sample.start);
    total += sample.value;
    used.set(rank, 0);
  }
  return {
    value: mean ? total / duration : total,
    coverageSeconds: duration / 1000,
    sampleCount: used.size,
    estimated: [...used].some(([rank, duration]) => ranked[rank].split || duration < ranked[rank].end - ranked[rank].start),
  };
}

/** Activity summaries use the patient's zone, independent of the importing browser. */
export function createAppleActivityParser(zone: string) {
  const timeZone = normalizeTimeZone(zone);
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const dateOf = (time: number) => formatter.format(new Date(time));
  const boundaries = new Map<string, number>();
  const buckets = new Map<string, Bucket>();
  function nextDay(time: number, date: string) {
    const cached = boundaries.get(date);
    if (cached !== undefined) return cached;
    // Find the first instant in the next local day, including DST and midnight transitions.
    let low = time, high = time + 36 * 3600_000;
    while (low + 1 < high) {
      const middle = Math.floor((low + high) / 2);
      if (dateOf(middle) === date) low = middle; else high = middle;
    }
    boundaries.set(date, high);
    return high;
  }
  return {
    consume(attributes: Record<string, string>, start: number, end: number, created: number) {
      const key = Object.hasOwn(APPLE_ACTIVITY_TYPES, attributes.type) ? APPLE_ACTIVITY_TYPES[attributes.type] : undefined;
      if (!key || !attributes.value?.trim()) return false;
      const value = convert(key, Number(attributes.value), attributes.unit ?? '');
      const duration = end - start;
      if (value === null || !Number.isFinite(start) || !Number.isFinite(end) || duration < 0 || duration > 7 * 86400_000) return false;
      if (activityMetricByKey.get(key)!.aggregation === 'mean' && duration === 0) return false;
      const name = attributes.sourceName?.trim() || 'Apple Health';
      const sourceId = `${name}\0${deviceIdentity(attributes.device ?? '')}`;
      let cursor = start;
      do {
        const date = dateOf(cursor);
        const until = Math.min(end, nextDay(cursor, date));
        const id = `${date}:${key}`;
        const bucket = buckets.get(id) ?? { date, key, sources: new Map<string, Source>() };
        const source = bucket.sources.get(sourceId) ?? { name, samples: [] };
        const split = cursor !== start || until !== end;
        source.samples.push({ start: cursor, end: until, created, split,
          value: activityMetricByKey.get(key)!.aggregation === 'sum' && duration > 0 ? value * (until - cursor) / duration : value });
        bucket.sources.set(sourceId, source); buckets.set(id, bucket);
        cursor = until;
      } while (cursor < end);
      return true;
    },
    finish() {
      const days = new Map<string, ActivityEntry[]>();
      for (const bucket of buckets.values()) {
        const candidates = [...bucket.sources].map(([id, source]) => {
          const samples = uniqueSamples(source.samples);
          return { id, name: source.name, samples, coverage: coverage(samples) };
        }).sort((a, b) => b.coverage - a.coverage || b.samples.length - a.samples.length || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        const chosen = candidates[0];
        const metric = activityMetricByKey.get(bucket.key)!;
        const result = summarize(chosen.samples, metric.aggregation === 'mean');
        if (!Number.isFinite(result.value)) continue;
        const entries = days.get(bucket.date) ?? [];
        entries.push({ key: bucket.key, value: String(Number(result.value.toFixed(4))), unit: metric.unit,
          dailySummary: { date: bucket.date, timeZone, aggregation: metric.aggregation, source: chosen.name,
            sampleCount: result.sampleCount, coverageSeconds: result.coverageSeconds,
            excludedSamples: [...bucket.sources.values()].reduce((sum, source) => sum + source.samples.length, 0) - result.sampleCount,
            estimated: result.estimated } });
        days.set(bucket.date, entries);
      }
      return [...days].map(([date, entries]) => ({ kind: 'activity' as const, sourceKey: `activity:${date}`, measuredAt: `${date}T12:00:00.000Z`, entries: entries.sort((a, b) => a.key.localeCompare(b.key)) }));
    },
  };
}
