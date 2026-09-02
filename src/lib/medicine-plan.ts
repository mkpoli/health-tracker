import { resolveZonedDateTime, toDateTimeLocal } from '$lib/time-zone';

export const courseKinds = ['initial', 'restart'] as const;
export const courseStatuses = ['planned', 'active', 'held', 'ended'] as const;
export const regimenRuleKinds = ['fixed_slots', 'interval', 'as_needed'] as const;
export const doseStatuses = [
  'planned',
  'taken',
  'partial',
  'skipped',
  'missed',
  'delayed',
  'held',
  'unknown',
] as const;

export type CourseKind = (typeof courseKinds)[number];
export type CourseStatus = (typeof courseStatuses)[number];
export type RegimenRuleKind = (typeof regimenRuleKinds)[number];
export type DoseStatus = (typeof doseStatuses)[number];

/** A dose slot with no record keeps the `planned` status; `missed` is a
 * person's own assertion and is never derived from elapsed time. */
export const recordedDoseStatuses = doseStatuses.filter((status) => status !== 'planned');

export function isCourseKind(value: string): value is CourseKind {
  return courseKinds.includes(value as CourseKind);
}

export function isCourseStatus(value: string): value is CourseStatus {
  return courseStatuses.includes(value as CourseStatus);
}

export function isRegimenRuleKind(value: string): value is RegimenRuleKind {
  return regimenRuleKinds.includes(value as RegimenRuleKind);
}

export function isDoseStatus(value: string): value is DoseStatus {
  return doseStatuses.includes(value as DoseStatus);
}

export const doseAnchorKinds = ['clock', 'wake', 'meal', 'bedtime'] as const;
export const doseAnchorMeals = ['breakfast', 'lunch', 'dinner'] as const;

export type DoseAnchorKind = (typeof doseAnchorKinds)[number];
export type DoseAnchorMeal = (typeof doseAnchorMeals)[number];

export function isDoseAnchorKind(value: string): value is DoseAnchorKind {
  return doseAnchorKinds.includes(value as DoseAnchorKind);
}

export function isDoseAnchorMeal(value: string): value is DoseAnchorMeal {
  return doseAnchorMeals.includes(value as DoseAnchorMeal);
}

export interface DoseSlot {
  /** Identity of the slot inside its regimen. Assigned once and kept through
   * edits, so removing or reordering slots never re-aims an existing dose
   * occurrence or a reminder dedup key. */
  key: number | null;
  /** Free wording for when the dose belongs in the day, e.g. 朝食後 or bedtime. */
  label: string | null;
  /** What places the dose in the day. A clock anchor carries `time`; wake and
   * meal anchors carry an offset from an event only the day itself decides, so
   * their occurrences have no planned instant. */
  anchorKind: DoseAnchorKind | null;
  anchorMeal: DoseAnchorMeal | null;
  anchorOffsetMinutes: number | null;
  /** Local wall-clock time `HH:MM`; only meaningful for a clock anchor. */
  time: string | null;
  amountValue: number | null;
  amountUnit: string | null;
}

export interface MedicineCourseRecord {
  id: string;
  patientId: string;
  medicineClaimId: string;
  kind: CourseKind;
  status: CourseStatus;
  previousCourseId: string | null;
  startDate: string;
  endDate: string | null;
  endReason: string | null;
  notes: string | null;
  originKind: string;
  originProvider: string | null;
  originExternalId: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface DoseRegimenRecord {
  id: string;
  patientId: string;
  courseId: string;
  ruleKind: RegimenRuleKind;
  slots: DoseSlot[];
  /** Days the fixed slots apply, 0 = Sunday … 6 = Saturday; null means every day. */
  daysOfWeek: number[] | null;
  intervalHours: number | null;
  anchorAt: string | null;
  doseText: string | null;
  route: string | null;
  site: string | null;
  timezone: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  remindMinutesBefore: number | null;
  notes: string | null;
  originKind: string;
  originProvider: string | null;
  originExternalId: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface DoseOccurrenceRecord {
  id: string;
  patientId: string;
  courseId: string;
  regimenId: string | null;
  regimenRevision: number | null;
  slotKey: number | null;
  localDate: string;
  plannedAt: string | null;
  timezone: string;
  status: DoseStatus;
  actualAt: string | null;
  actualValue: number | null;
  actualUnit: string | null;
  actualText: string | null;
  route: string | null;
  site: string | null;
  reason: string | null;
  reaction: string | null;
  notes: string | null;
  originKind: string;
  originProvider: string | null;
  originExternalId: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface PlannedDose {
  courseId: string;
  regimenId: string;
  regimenRevision: number;
  slotKey: number;
  localDate: string;
  plannedAt: string | null;
  slot: DoseSlot | null;
  timezone: string;
}

/** One row of the dose checklist: the plan, and the stored record when one exists. */
export interface DoseChecklistEntry {
  courseId: string;
  regimenId: string | null;
  slotKey: number | null;
  localDate: string;
  plannedAt: string | null;
  slot: DoseSlot | null;
  timezone: string;
  record: DoseOccurrenceRecord | null;
  status: DoseStatus;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_PLAN_DAYS = 62;
const MAX_INTERVAL_OCCURRENCES = 2000;

export function isDateOnly(value: string) {
  const match = DATE_ONLY.exec(value);
  if (!match) return false;

  const check = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return (
    check.getUTCFullYear() === Number(match[1]) &&
    check.getUTCMonth() + 1 === Number(match[2]) &&
    check.getUTCDate() === Number(match[3])
  );
}

function dateToUtcMidnight(date: string) {
  const match = DATE_ONLY.exec(date);
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function utcMidnightToDate(value: number) {
  return new Date(value).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number) {
  const midnight = dateToUtcMidnight(date);
  if (midnight === null) return date;
  return utcMidnightToDate(midnight + days * 86_400_000);
}

function dayOfWeek(date: string) {
  const midnight = dateToUtcMidnight(date);
  return midnight === null ? null : new Date(midnight).getUTCDay();
}

function clampDate(value: string, lower: string | null, upper: string | null) {
  let clamped = value;
  if (lower && clamped < lower) clamped = lower;
  if (upper && clamped > upper) clamped = upper;
  return clamped;
}

function slotInstant(date: string, time: string, timezone: string) {
  const exact = resolveZonedDateTime(`${date}T${time}`, timezone);
  if (exact) return exact.instant;

  // A daylight-saving gap swallows the wall-clock value. Gaps come in
  // half-hour steps (Lord Howe shifts 30 minutes), so the first later
  // half-hour boundary that exists is the closest real instant.
  const [hour, minute] = time.split(':').map(Number);
  for (const shiftMinutes of [30, 60, 90, 120]) {
    const total = hour * 60 + minute + shiftMinutes;
    if (total >= 24 * 60) break;
    const shifted = resolveZonedDateTime(
      `${date}T${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`,
      timezone,
    );
    if (shifted) return shifted.instant;
  }
  return null;
}

/**
 * Expands one regimen into its planned doses for a local date range, clipped
 * to the course and regimen effective windows. Pure: no clock, no storage.
 */
export function planDoses(
  course: Pick<MedicineCourseRecord, 'id' | 'status' | 'startDate' | 'endDate'>,
  regimen: DoseRegimenRecord,
  fromDate: string,
  toDate: string,
): PlannedDose[] {
  if (regimen.ruleKind === 'as_needed') return [];
  if (course.status === 'planned' || course.status === 'held') return [];
  if (!isDateOnly(fromDate) || !isDateOnly(toDate) || fromDate > toDate) return [];

  const lower = [fromDate, course.startDate, regimen.effectiveFrom].reduce((a, b) =>
    a > b ? a : b,
  );
  const upperCandidates = [toDate, course.endDate, regimen.effectiveTo].filter(
    (value): value is string => Boolean(value),
  );
  const upper = upperCandidates.reduce((a, b) => (a < b ? a : b));
  if (lower > upper) return [];

  const spanStart = dateToUtcMidnight(lower);
  const spanEnd = dateToUtcMidnight(upper);
  if (spanStart === null || spanEnd === null) return [];
  if ((spanEnd - spanStart) / 86_400_000 > MAX_PLAN_DAYS) return [];

  const base = {
    courseId: course.id,
    regimenId: regimen.id,
    regimenRevision: regimen.revision,
    timezone: regimen.timezone,
  };

  if (regimen.ruleKind === 'interval') {
    if (!regimen.anchorAt || !regimen.intervalHours || regimen.intervalHours <= 0) return [];

    const anchor = Date.parse(regimen.anchorAt);
    if (Number.isNaN(anchor)) return [];

    const stepMs = regimen.intervalHours * 3_600_000;
    const planned: PlannedDose[] = [];
    // The range bounds are local dates; widen by a day on each side so zone
    // offsets cannot drop an edge occurrence, then filter on the local date.
    const windowStart = spanStart - 86_400_000;
    const windowEnd = spanEnd + 2 * 86_400_000;
    const firstStep = Math.max(0, Math.ceil((windowStart - anchor) / stepMs));
    const lastStep = firstStep + Math.ceil((windowEnd - windowStart) / stepMs) + 2;

    for (let step = firstStep; step <= lastStep; step += 1) {
      const instantMs = anchor + step * stepMs;
      if (instantMs > windowEnd || planned.length >= MAX_INTERVAL_OCCURRENCES) break;

      const instant = new Date(instantMs).toISOString();
      const localDate = toDateTimeLocal(instant, regimen.timezone).slice(0, 10);
      if (localDate < lower || localDate > upper) continue;

      planned.push({
        ...base,
        slotKey: step,
        localDate,
        plannedAt: instant,
        slot: regimen.slots[0] || null,
      });
    }

    return planned;
  }

  const slots = regimen.slots.length > 0 ? regimen.slots : [null];
  const planned: PlannedDose[] = [];

  for (let midnight = spanStart; midnight <= spanEnd; midnight += 86_400_000) {
    const localDate = utcMidnightToDate(midnight);
    const weekday = dayOfWeek(localDate);
    if (regimen.daysOfWeek && weekday !== null && !regimen.daysOfWeek.includes(weekday)) continue;

    slots.forEach((slot, index) => {
      planned.push({
        ...base,
        slotKey: slot?.key ?? index,
        localDate,
        plannedAt:
          slot?.time && (slot.anchorKind === 'clock' || slot.anchorKind === null)
            ? slotInstant(localDate, slot.time, regimen.timezone)
            : null,
        slot,
      });
    });
  }

  return planned;
}

export function doseSlotIdentity(regimenId: string, localDate: string, slotKey: number) {
  return `${regimenId}:${localDate}:${slotKey}`;
}

/**
 * Joins planned doses with stored occurrence rows. A stored row wins its
 * slot; unplanned rows (as-needed doses, doses kept from an earlier rule)
 * appear on their own local date.
 */
export function buildDoseChecklist(
  planned: PlannedDose[],
  stored: DoseOccurrenceRecord[],
): DoseChecklistEntry[] {
  const byIdentity = new Map<string, DoseOccurrenceRecord>();
  const unplanned: DoseOccurrenceRecord[] = [];

  for (const occurrence of stored) {
    if (occurrence.regimenId && occurrence.slotKey !== null) {
      byIdentity.set(
        doseSlotIdentity(occurrence.regimenId, occurrence.localDate, occurrence.slotKey),
        occurrence,
      );
    } else {
      unplanned.push(occurrence);
    }
  }

  const entries: DoseChecklistEntry[] = [];
  const claimed = new Set<string>();

  for (const dose of planned) {
    const identity = doseSlotIdentity(dose.regimenId, dose.localDate, dose.slotKey);
    const record = byIdentity.get(identity) || null;
    if (record) claimed.add(identity);

    entries.push({
      courseId: dose.courseId,
      regimenId: dose.regimenId,
      slotKey: dose.slotKey,
      localDate: dose.localDate,
      plannedAt: record?.plannedAt ?? dose.plannedAt,
      slot: dose.slot,
      timezone: dose.timezone,
      record,
      status: record?.status ?? 'planned',
    });
  }

  // Stored rows whose slot fell out of the current rule still belong to the
  // record: a dose taken under an earlier regimen revision stays visible.
  for (const [identity, occurrence] of byIdentity) {
    if (claimed.has(identity)) continue;
    entries.push(storedEntry(occurrence));
  }

  for (const occurrence of unplanned) {
    entries.push(storedEntry(occurrence));
  }

  entries.sort((a, b) => {
    if (a.localDate !== b.localDate) return a.localDate < b.localDate ? -1 : 1;
    const left = a.plannedAt || '';
    const right = b.plannedAt || '';
    if (left !== right) return left < right ? -1 : 1;
    return (a.slotKey ?? 0) - (b.slotKey ?? 0);
  });

  return entries;
}

function storedEntry(occurrence: DoseOccurrenceRecord): DoseChecklistEntry {
  return {
    courseId: occurrence.courseId,
    regimenId: occurrence.regimenId,
    slotKey: occurrence.slotKey,
    localDate: occurrence.localDate,
    plannedAt: occurrence.plannedAt,
    slot: null,
    timezone: occurrence.timezone,
    record: occurrence,
    status: occurrence.status,
  };
}

export interface AdherenceCounts {
  due: number;
  taken: number;
  partial: number;
  skipped: number;
  missed: number;
  delayed: number;
  held: number;
  unknown: number;
  unrecorded: number;
}

/** The local calendar date of an instant in a timezone. */
export function localDateOf(instant: string, timezone: string) {
  return toDateTimeLocal(instant, timezone).slice(0, 10);
}

/**
 * Counts dose slots whose planned moment has passed, judging label-only slots
 * against their own regimen's calendar day. `unrecorded` slots have no saved
 * record; the counts never promote them to anything else.
 */
export function countAdherence(entries: DoseChecklistEntry[], now: string): AdherenceCounts {
  const counts: AdherenceCounts = {
    due: 0,
    taken: 0,
    partial: 0,
    skipped: 0,
    missed: 0,
    delayed: 0,
    held: 0,
    unknown: 0,
    unrecorded: 0,
  };

  const todayByZone = new Map<string, string>();
  for (const entry of entries) {
    let zoneToday = todayByZone.get(entry.timezone);
    if (!zoneToday) {
      zoneToday = localDateOf(now, entry.timezone);
      todayByZone.set(entry.timezone, zoneToday);
    }
    const isDue = entry.plannedAt ? entry.plannedAt <= now : entry.localDate < zoneToday;
    if (!isDue && entry.status === 'planned') continue;

    counts.due += 1;
    if (entry.status === 'planned') counts.unrecorded += 1;
    else if (entry.status === 'taken') counts.taken += 1;
    else if (entry.status === 'partial') counts.partial += 1;
    else if (entry.status === 'skipped') counts.skipped += 1;
    else if (entry.status === 'missed') counts.missed += 1;
    else if (entry.status === 'delayed') counts.delayed += 1;
    else if (entry.status === 'held') counts.held += 1;
    else counts.unknown += 1;
  }

  return counts;
}

const TIME_ONLY = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isTimeOnly(value: string) {
  return TIME_ONLY.test(value);
}

/** Reads a stored slots value back into well-formed slots, dropping junk. */
export function normalizeDoseSlots(value: unknown): DoseSlot[] {
  if (!Array.isArray(value)) return [];

  const slots: DoseSlot[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;

    const candidate = entry as Record<string, unknown>;
    const label = typeof candidate.label === 'string' && candidate.label.trim()
      ? candidate.label.trim()
      : null;
    const time = typeof candidate.time === 'string' && isTimeOnly(candidate.time.trim())
      ? candidate.time.trim()
      : null;
    const anchorKind =
      typeof candidate.anchorKind === 'string' && isDoseAnchorKind(candidate.anchorKind)
        ? candidate.anchorKind
        : time
          ? 'clock'
          : null;
    const anchorMeal =
      typeof candidate.anchorMeal === 'string' && isDoseAnchorMeal(candidate.anchorMeal)
        ? candidate.anchorMeal
        : null;
    const anchorOffsetMinutes =
      typeof candidate.anchorOffsetMinutes === 'number' &&
      Number.isInteger(candidate.anchorOffsetMinutes) &&
      Math.abs(candidate.anchorOffsetMinutes) <= 24 * 60
        ? candidate.anchorOffsetMinutes
        : null;
    const amountValue =
      typeof candidate.amountValue === 'number' && Number.isFinite(candidate.amountValue)
        ? candidate.amountValue
        : null;
    const amountUnit = typeof candidate.amountUnit === 'string' && candidate.amountUnit.trim()
      ? candidate.amountUnit.trim()
      : null;

    const key =
      typeof candidate.key === 'number' && Number.isInteger(candidate.key) && candidate.key >= 0
        ? candidate.key
        : null;

    slots.push({
      key,
      label,
      anchorKind,
      anchorMeal: anchorKind === 'meal' ? anchorMeal : null,
      anchorOffsetMinutes: anchorKind === 'clock' ? null : anchorOffsetMinutes,
      time: anchorKind === 'clock' ? time : null,
      amountValue,
      amountUnit,
    });
  }

  return slots;
}

/**
 * Gives every slot a unique persistent key, keeping the ones already
 * assigned. Slot lists arriving from outside the form parser (archive rows,
 * connector payloads) pass through here before they are stored.
 */
export function assignDoseSlotKeys(slots: DoseSlot[]): DoseSlot[] {
  const consumed = new Set<number>();
  let nextKey = 0;

  return slots.map((slot) => {
    if (slot.key !== null && !consumed.has(slot.key)) {
      consumed.add(slot.key);
      return slot;
    }

    while (consumed.has(nextKey)) nextKey += 1;
    const key = nextKey;
    consumed.add(key);
    return { ...slot, key };
  });
}

export function normalizeDaysOfWeek(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;

  const days = [
    ...new Set(
      value.filter(
        (day): day is number => typeof day === 'number' && Number.isInteger(day) && day >= 0 && day <= 6,
      ),
    ),
  ].sort((a, b) => a - b);

  return days.length > 0 ? days : null;
}

export function formatAmountWithUnit(value: number, unit: string | null) {
  if (!unit) return `${value}`;
  // A Latin unit reads with a space (2 mg); a CJK counter reads without (2錠).
  const separator = /^[A-Za-z]/.test(unit) ? ' ' : '';
  return `${value}${separator}${unit}`;
}

export function formatDoseAmount(slot: DoseSlot | null, doseText: string | null) {
  if (slot?.amountValue !== null && slot?.amountValue !== undefined) {
    return formatAmountWithUnit(slot.amountValue, slot.amountUnit);
  }
  return doseText;
}

/** The course a medicine is on: the ongoing one, else the most recently started. */
export function activeCourseOf(courses: MedicineCourseRecord[]): MedicineCourseRecord | null {
  const sorted = [...courses].sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
  return sorted.find((course) => course.status === 'active') || sorted[0] || null;
}

function byLatestStart(a: DoseRegimenRecord, b: DoseRegimenRecord) {
  return a.effectiveFrom < b.effectiveFrom ? 1 : -1;
}

/** The dose rule in force for a course on a local date; the latest start wins. */
export function currentRegimenOf(
  course: MedicineCourseRecord,
  regimens: DoseRegimenRecord[],
  today: string,
): DoseRegimenRecord | null {
  return (
    regimens
      .filter(
        (regimen) =>
          regimen.courseId === course.id &&
          regimen.effectiveFrom <= today &&
          (!regimen.effectiveTo || regimen.effectiveTo >= today),
      )
      .sort(byLatestStart)[0] || null
  );
}

/** The most recently started dose rule of a course, whether or not it is in force. */
export function latestRegimenOf(
  course: MedicineCourseRecord,
  regimens: DoseRegimenRecord[],
): DoseRegimenRecord | null {
  return regimens.filter((regimen) => regimen.courseId === course.id).sort(byLatestStart)[0] || null;
}
