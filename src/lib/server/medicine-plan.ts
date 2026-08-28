import {
  isCourseKind,
  isCourseStatus,
  isDateOnly,
  isDoseAnchorKind,
  isDoseAnchorMeal,
  isDoseStatus,
  isRegimenRuleKind,
  isTimeOnly,
  type CourseKind,
  type CourseStatus,
  type DoseSlot,
  type DoseStatus,
  type RegimenRuleKind,
} from '$lib/medicine-plan';
import { isValidTimeZone, resolveZonedDateTime } from '$lib/time-zone';

const MAX_SLOTS = 12;
const MAX_INTERVAL_HOURS = 24 * 45;

const fieldLimits = {
  endReason: 500,
  notes: 4000,
  doseText: 200,
  route: 120,
  site: 120,
  actualUnit: 40,
  actualText: 200,
  reason: 500,
  reaction: 2000,
} as const;

export type MedicinePlanInputErrorCode =
  | 'invalid_kind'
  | 'invalid_status'
  | 'invalid_date'
  | 'invalid_time'
  | 'invalid_timezone'
  | 'invalid_rule'
  | 'invalid_slots'
  | 'invalid_interval'
  | 'invalid_amount'
  | 'invalid_window'
  | 'field_too_long';

export class InvalidMedicinePlanInputError extends Error {
  constructor(public readonly code: MedicinePlanInputErrorCode) {
    super(code);
  }
}

export interface MedicineCourseInput {
  kind: CourseKind;
  status: CourseStatus;
  previousCourseId: string | null;
  startDate: string;
  endDate: string | null;
  endReason: string | null;
  notes: string | null;
}

export interface DoseRegimenInput {
  ruleKind: RegimenRuleKind;
  slots: DoseSlot[];
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
}

export interface DoseActionInput {
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
}

function readText(data: FormData, key: keyof typeof fieldLimits) {
  const value = data.get(key);
  const normalized = typeof value === 'string' ? value.trim() : '';

  if (normalized.length > fieldLimits[key]) {
    throw new InvalidMedicinePlanInputError('field_too_long');
  }

  return normalized || null;
}

function readDate(data: FormData, key: string, required = false) {
  const value = data.get(key);
  const normalized = typeof value === 'string' ? value.trim() : '';

  if (!normalized) {
    if (required) throw new InvalidMedicinePlanInputError('invalid_date');
    return null;
  }
  if (!isDateOnly(normalized)) throw new InvalidMedicinePlanInputError('invalid_date');
  return normalized;
}

function readInstant(data: FormData, key: string, timezone: string) {
  const value = data.get(key);
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) return null;

  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(normalized)) {
    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) throw new InvalidMedicinePlanInputError('invalid_time');
    return parsed.toISOString();
  }

  const resolved = resolveZonedDateTime(normalized, timezone);
  if (!resolved) throw new InvalidMedicinePlanInputError('invalid_time');
  return resolved.instant;
}

export function parseMedicineCourseInput(data: FormData): MedicineCourseInput {
  const kind = data.get('kind')?.toString().trim() || 'initial';
  if (!isCourseKind(kind)) throw new InvalidMedicinePlanInputError('invalid_kind');

  const status = data.get('status')?.toString().trim() || 'active';
  if (!isCourseStatus(status)) throw new InvalidMedicinePlanInputError('invalid_status');

  const startDate = readDate(data, 'startDate', true) as string;
  const endDate = readDate(data, 'endDate');
  if (endDate && endDate < startDate) throw new InvalidMedicinePlanInputError('invalid_window');

  const previousCourseId = data.get('previousCourseId')?.toString().trim() || null;

  return {
    kind,
    status,
    previousCourseId,
    startDate,
    endDate,
    endReason: readText(data, 'endReason'),
    notes: readText(data, 'notes'),
  };
}

function parseSlots(raw: string): DoseSlot[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new InvalidMedicinePlanInputError('invalid_slots');
  }

  if (!Array.isArray(parsed) || parsed.length > MAX_SLOTS) {
    throw new InvalidMedicinePlanInputError('invalid_slots');
  }

  const parsedSlots = parsed.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new InvalidMedicinePlanInputError('invalid_slots');
    }

    const candidate = entry as Record<string, unknown>;
    let key: number | null = null;
    if (candidate.key !== null && candidate.key !== undefined && candidate.key !== '') {
      const numeric = Number(candidate.key);
      if (!Number.isInteger(numeric) || numeric < 0 || numeric > 10_000) {
        throw new InvalidMedicinePlanInputError('invalid_slots');
      }
      key = numeric;
    }
    const label = typeof candidate.label === 'string' ? candidate.label.trim() : '';
    const time = typeof candidate.time === 'string' ? candidate.time.trim() : '';
    if (label.length > 120) throw new InvalidMedicinePlanInputError('field_too_long');
    if (time && !isTimeOnly(time)) throw new InvalidMedicinePlanInputError('invalid_time');

    const rawAnchorKind = typeof candidate.anchorKind === 'string' ? candidate.anchorKind.trim() : '';
    if (rawAnchorKind && !isDoseAnchorKind(rawAnchorKind)) {
      throw new InvalidMedicinePlanInputError('invalid_slots');
    }
    const anchorKind: DoseSlot['anchorKind'] = rawAnchorKind && isDoseAnchorKind(rawAnchorKind)
      ? rawAnchorKind
      : time
        ? 'clock'
        : null;

    const rawAnchorMeal = typeof candidate.anchorMeal === 'string' ? candidate.anchorMeal.trim() : '';
    if (rawAnchorMeal && !isDoseAnchorMeal(rawAnchorMeal)) {
      throw new InvalidMedicinePlanInputError('invalid_slots');
    }
    if (anchorKind === 'meal' && !rawAnchorMeal) {
      throw new InvalidMedicinePlanInputError('invalid_slots');
    }

    let anchorOffsetMinutes: number | null = null;
    if (
      candidate.anchorOffsetMinutes !== null &&
      candidate.anchorOffsetMinutes !== undefined &&
      candidate.anchorOffsetMinutes !== ''
    ) {
      const numeric = Number(candidate.anchorOffsetMinutes);
      if (!Number.isInteger(numeric) || Math.abs(numeric) > 24 * 60) {
        throw new InvalidMedicinePlanInputError('invalid_slots');
      }
      anchorOffsetMinutes = numeric;
    }
    if (anchorKind === 'clock' && !time) {
      throw new InvalidMedicinePlanInputError('invalid_time');
    }

    let amountValue: number | null = null;
    if (candidate.amountValue !== null && candidate.amountValue !== undefined && candidate.amountValue !== '') {
      const numeric = Number(candidate.amountValue);
      if (!Number.isFinite(numeric) || numeric <= 0 || numeric > 100_000) {
        throw new InvalidMedicinePlanInputError('invalid_amount');
      }
      amountValue = numeric;
    }

    const amountUnit = typeof candidate.amountUnit === 'string' ? candidate.amountUnit.trim() : '';
    if (amountUnit.length > 40) throw new InvalidMedicinePlanInputError('field_too_long');

    return {
      key,
      label: label || null,
      anchorKind,
      anchorMeal: anchorKind === 'meal' && isDoseAnchorMeal(rawAnchorMeal) ? rawAnchorMeal : null,
      anchorOffsetMinutes: anchorKind && anchorKind !== 'clock' ? anchorOffsetMinutes : null,
      time: anchorKind === 'clock' ? time || null : null,
      amountValue,
      amountUnit: amountUnit || null,
    };
  });

  // Slots keep the identity they were saved with; a new slot takes the next
  // free key. A duplicate key would fuse two dose slots into one.
  const usedKeys = parsedSlots
    .map((slot) => slot.key)
    .filter((key): key is number => key !== null);
  if (new Set(usedKeys).size !== usedKeys.length) {
    throw new InvalidMedicinePlanInputError('invalid_slots');
  }
  let nextKey = usedKeys.length > 0 ? Math.max(...usedKeys) + 1 : 0;
  for (const slot of parsedSlots) {
    if (slot.key === null) {
      slot.key = nextKey;
      nextKey += 1;
    }
  }

  return parsedSlots;
}

export function parseDoseRegimenInput(data: FormData): DoseRegimenInput {
  const ruleKind = data.get('ruleKind')?.toString().trim() || '';
  if (!isRegimenRuleKind(ruleKind)) throw new InvalidMedicinePlanInputError('invalid_rule');

  const timezone = data.get('timezone')?.toString().trim() || '';
  if (!isValidTimeZone(timezone)) throw new InvalidMedicinePlanInputError('invalid_timezone');

  const effectiveFrom = readDate(data, 'effectiveFrom', true) as string;
  const effectiveTo = readDate(data, 'effectiveTo');
  if (effectiveTo && effectiveTo < effectiveFrom) {
    throw new InvalidMedicinePlanInputError('invalid_window');
  }

  let slots: DoseSlot[] = [];
  let daysOfWeek: number[] | null = null;
  let intervalHours: number | null = null;
  let anchorAt: string | null = null;

  if (ruleKind === 'fixed_slots') {
    slots = parseSlots(data.get('slots')?.toString() || '[]');
    if (slots.length === 0) throw new InvalidMedicinePlanInputError('invalid_slots');

    const rawDays = data
      .getAll('daysOfWeek')
      .flatMap((value) => value.toString().split(','))
      .map((value) => value.trim())
      .filter(Boolean)
      .map(Number);
    if (rawDays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
      throw new InvalidMedicinePlanInputError('invalid_rule');
    }
    const unique = [...new Set(rawDays)].sort((a, b) => a - b);
    daysOfWeek = unique.length > 0 && unique.length < 7 ? unique : null;
  } else if (ruleKind === 'interval') {
    const rawInterval = data.get('intervalHours')?.toString().trim() || '';
    const numeric = Number(rawInterval);
    if (!Number.isFinite(numeric) || numeric < 1 || numeric > MAX_INTERVAL_HOURS) {
      throw new InvalidMedicinePlanInputError('invalid_interval');
    }
    intervalHours = numeric;

    anchorAt = readInstant(data, 'anchorAt', timezone);
    if (!anchorAt) throw new InvalidMedicinePlanInputError('invalid_interval');

    slots = parseSlots(data.get('slots')?.toString() || '[]').slice(0, 1);
  }

  let remindMinutesBefore: number | null = null;
  const rawRemind = data.get('remindMinutesBefore')?.toString().trim();
  if (rawRemind) {
    const numeric = Number(rawRemind);
    if (!Number.isInteger(numeric) || numeric < 0 || numeric > 24 * 60) {
      throw new InvalidMedicinePlanInputError('invalid_interval');
    }
    remindMinutesBefore = numeric;
  }

  return {
    ruleKind,
    slots,
    daysOfWeek,
    intervalHours,
    anchorAt,
    doseText: readText(data, 'doseText'),
    route: readText(data, 'route'),
    site: readText(data, 'site'),
    timezone,
    effectiveFrom,
    effectiveTo,
    remindMinutesBefore,
    notes: readText(data, 'notes'),
  };
}

export function parseDoseActionInput(data: FormData, timezone: string): DoseActionInput {
  const status = data.get('status')?.toString().trim() || '';
  if (!isDoseStatus(status) || status === 'planned') {
    throw new InvalidMedicinePlanInputError('invalid_status');
  }

  let actualValue: number | null = null;
  const rawValue = data.get('actualValue')?.toString().trim();
  if (rawValue) {
    const numeric = Number(rawValue);
    if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100_000) {
      throw new InvalidMedicinePlanInputError('invalid_amount');
    }
    actualValue = numeric;
  }

  return {
    status,
    actualAt: readInstant(data, 'actualAt', timezone),
    actualValue,
    actualUnit: readText(data, 'actualUnit'),
    actualText: readText(data, 'actualText'),
    route: readText(data, 'route'),
    site: readText(data, 'site'),
    reason: readText(data, 'reason'),
    reaction: readText(data, 'reaction'),
    notes: readText(data, 'notes'),
  };
}
