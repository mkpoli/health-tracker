import {
  isEnergyDirection,
  isEnergyStatus,
  type EnergyDirection,
  type EnergyStatus,
} from '$lib/energy';

const fieldLimits = {
  label: 300,
  category: 100,
  timezone: 100,
  notes: 4000,
} as const;

export type EnergyInput = {
  direction: EnergyDirection;
  label: string | null;
  category: string | null;
  energyKcal: number | null;
  occurredAt: string;
  localDate: string;
  timezone: string | null;
  timezoneOffsetMinutes: number;
  durationMinutes: number | null;
  status: EnergyStatus;
  notes: string | null;
};

export type EnergyInputErrorCode =
  | 'invalid_direction'
  | 'invalid_status'
  | 'invalid_energy'
  | 'missing_energy'
  | 'invalid_time'
  | 'invalid_timezone'
  | 'invalid_duration'
  | 'field_too_long'
  | 'empty_entry';

export class InvalidEnergyInputError extends Error {
  constructor(public readonly code: EnergyInputErrorCode) {
    super(code);
  }
}

function readText(data: FormData, key: keyof typeof fieldLimits) {
  const value = data.get(key);
  const normalized = typeof value === 'string' ? value.trim() : '';

  if (normalized.length > fieldLimits[key]) {
    throw new InvalidEnergyInputError('field_too_long');
  }

  return normalized || null;
}

function readEnergyKcal(data: FormData) {
  const value = data.get('energyKcal');
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) return null;

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1_000_000) {
    throw new InvalidEnergyInputError('invalid_energy');
  }

  return Math.round(parsed * 1000) / 1000;
}

function readTimezoneOffset(data: FormData) {
  const raw = data.get('timezoneOffsetMinutes');
  const parsed = typeof raw === 'string' ? Number(raw) : Number.NaN;

  if (!Number.isInteger(parsed) || parsed < -840 || parsed > 840) {
    throw new InvalidEnergyInputError('invalid_timezone');
  }

  return parsed;
}

function readLocalDateTime(data: FormData, timezoneOffsetMinutes: number) {
  const raw = data.get('occurredLocal');
  const value = typeof raw === 'string' ? raw.trim() : '';
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new InvalidEnergyInputError('invalid_time');

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const localAsUtc = new Date(Date.UTC(year, month - 1, day, hour, minute));

  if (
    localAsUtc.getUTCFullYear() !== year ||
    localAsUtc.getUTCMonth() !== month - 1 ||
    localAsUtc.getUTCDate() !== day ||
    localAsUtc.getUTCHours() !== hour ||
    localAsUtc.getUTCMinutes() !== minute
  ) {
    throw new InvalidEnergyInputError('invalid_time');
  }

  return {
    localDate: `${match[1]}-${match[2]}-${match[3]}`,
    occurredAt: new Date(localAsUtc.getTime() - timezoneOffsetMinutes * 60_000).toISOString(),
  };
}

function readDuration(data: FormData, direction: EnergyDirection) {
  if (direction !== 'expenditure') return null;

  const raw = data.get('durationMinutes');
  const normalized = typeof raw === 'string' ? raw.trim() : '';
  if (!normalized) return null;

  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10_080) {
    throw new InvalidEnergyInputError('invalid_duration');
  }

  return parsed;
}

export function parseEnergyInput(data: FormData): EnergyInput {
  const directionValue = data.get('direction');
  const direction = typeof directionValue === 'string' ? directionValue : '';
  if (!isEnergyDirection(direction)) throw new InvalidEnergyInputError('invalid_direction');

  const energyKcal = readEnergyKcal(data);
  const statusValue = data.get('status');
  const requestedStatus = typeof statusValue === 'string' ? statusValue : 'auto';
  const status = requestedStatus === 'auto' ? (energyKcal === null ? 'draft' : 'recorded') : requestedStatus;

  if (!isEnergyStatus(status)) throw new InvalidEnergyInputError('invalid_status');
  if (status === 'recorded' && energyKcal === null) {
    throw new InvalidEnergyInputError('missing_energy');
  }

  const timezoneOffsetMinutes = readTimezoneOffset(data);
  const { occurredAt, localDate } = readLocalDateTime(data, timezoneOffsetMinutes);
  const timezone = readText(data, 'timezone');

  if (timezone) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: timezone }).format(0);
    } catch {
      throw new InvalidEnergyInputError('invalid_timezone');
    }
  }

  return {
    direction,
    label: readText(data, 'label'),
    category: readText(data, 'category'),
    energyKcal,
    occurredAt,
    localDate,
    timezone,
    timezoneOffsetMinutes,
    durationMinutes: readDuration(data, direction),
    status,
    notes: readText(data, 'notes'),
  };
}

export function validateEnergyEntry(input: EnergyInput, hasPhoto: boolean) {
  if (!input.label && input.energyKcal === null && !hasPhoto) {
    throw new InvalidEnergyInputError('empty_entry');
  }
}
