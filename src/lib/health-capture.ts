import { isMedicineStatus, type MedicineStatus } from '$lib/medicine';
import { isEnergyDirection, type EnergyDirection } from '$lib/energy';

export const MAX_CAPTURE_MESSAGE_CHARS = 1500;

export const medicineCaptureFields = [
  'name',
  'genericName',
  'form',
  'strength',
  'route',
  'schedule',
  'status',
  'startDate',
  'endDate',
  'purpose',
  'prescriber',
  'notes',
] as const;

export const energyCaptureFields = [
  'direction',
  'label',
  'category',
  'energyKcal',
  'occurredLocal',
  'durationMinutes',
  'notes',
] as const;

export type MedicineCaptureField = (typeof medicineCaptureFields)[number];
export type EnergyCaptureField = (typeof energyCaptureFields)[number];

export type MedicineCaptureProposal = {
  kind: 'medicine';
  recognized: boolean;
  name: string | null;
  genericName: string | null;
  form: string | null;
  strength: string | null;
  route: string | null;
  schedule: string | null;
  status: MedicineStatus | null;
  startDate: string | null;
  endDate: string | null;
  purpose: string | null;
  prescriber: string | null;
  notes: string | null;
  uncertainFields: MedicineCaptureField[];
};

export type EnergyCaptureProposal = {
  kind: 'energy';
  recognized: boolean;
  direction: EnergyDirection | null;
  label: string | null;
  category: 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'drink' | 'meal' | null;
  energyKcal: number | null;
  occurredLocal: string | null;
  durationMinutes: number | null;
  notes: string | null;
  uncertainFields: EnergyCaptureField[];
};

export type HealthCaptureProposal = MedicineCaptureProposal | EnergyCaptureProposal;

export class InvalidCaptureProposalError extends Error {}

function object(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InvalidCaptureProposalError('proposal must be an object');
  }
  return value as Record<string, unknown>;
}

function nullableText(value: unknown, maximum: number) {
  if (value === null) return null;
  if (typeof value !== 'string') throw new InvalidCaptureProposalError('invalid text field');
  const normalized = value.trim();
  if (normalized.length > maximum) throw new InvalidCaptureProposalError('text field is too long');
  return normalized || null;
}

function dateOnly(value: unknown) {
  const normalized = nullableText(value, 10);
  if (normalized === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new InvalidCaptureProposalError('invalid date');
  }
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw new InvalidCaptureProposalError('invalid date');
  }
  return normalized;
}

function localDateTime(value: unknown) {
  const normalized = nullableText(value, 16);
  if (normalized === null) return null;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(normalized);
  if (!match) throw new InvalidCaptureProposalError('invalid local time');
  const parsed = new Date(`${normalized}:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 16) !== normalized
  ) {
    throw new InvalidCaptureProposalError('invalid local time');
  }
  return normalized;
}

function nullableNumber(value: unknown, maximum: number, integer = false) {
  if (value === null) return null;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > maximum ||
    (integer && !Number.isInteger(value))
  ) {
    throw new InvalidCaptureProposalError('invalid number field');
  }
  return integer ? value : Math.round(value * 1000) / 1000;
}

function uncertainFields<T extends string>(value: unknown, allowed: readonly T[]) {
  if (!Array.isArray(value)) throw new InvalidCaptureProposalError('invalid uncertain fields');
  const allowedSet = new Set<string>(allowed);
  const fields = value.filter(
    (field): field is T => typeof field === 'string' && allowedSet.has(field),
  );
  if (fields.length !== value.length) throw new InvalidCaptureProposalError('invalid uncertain field');
  return [...new Set(fields)];
}

function includeUncertainField<T extends string>(fields: T[], field: T, include: boolean) {
  return include && !fields.includes(field) ? [...fields, field] : fields;
}

export function normalizeMedicineCapture(value: unknown): MedicineCaptureProposal {
  const raw = object(value);
  if (raw.kind !== 'medicine' || typeof raw.recognized !== 'boolean') {
    throw new InvalidCaptureProposalError('invalid medicine proposal');
  }
  const name = nullableText(raw.name, 200);
  const status = raw.status === null ? null : raw.status;
  if (status !== null && (typeof status !== 'string' || !isMedicineStatus(status))) {
    throw new InvalidCaptureProposalError('invalid medicine status');
  }
  const statedUncertainFields = uncertainFields(raw.uncertain_fields, medicineCaptureFields);

  return {
    kind: 'medicine',
    recognized: raw.recognized && name !== null,
    name,
    genericName: nullableText(raw.generic_name, 200),
    form: nullableText(raw.form, 120),
    strength: nullableText(raw.strength, 120),
    route: nullableText(raw.route, 120),
    schedule: nullableText(raw.schedule, 1000),
    status: status as MedicineStatus | null,
    startDate: dateOnly(raw.start_date),
    endDate: dateOnly(raw.end_date),
    purpose: nullableText(raw.purpose, 500),
    prescriber: nullableText(raw.prescriber, 200),
    notes: nullableText(raw.notes, 1000),
    uncertainFields: includeUncertainField(statedUncertainFields, 'status', status === null),
  };
}

export function normalizeEnergyCapture(value: unknown): EnergyCaptureProposal {
  const raw = object(value);
  if (raw.kind !== 'energy' || typeof raw.recognized !== 'boolean') {
    throw new InvalidCaptureProposalError('invalid energy proposal');
  }
  const direction = raw.direction === null ? null : raw.direction;
  if (
    direction !== null &&
    (typeof direction !== 'string' || !isEnergyDirection(direction))
  ) {
    throw new InvalidCaptureProposalError('invalid energy direction');
  }
  const category = raw.category === null ? null : raw.category;
  const categories = ['breakfast', 'lunch', 'dinner', 'snack', 'drink', 'meal'];
  if (category !== null && (typeof category !== 'string' || !categories.includes(category))) {
    throw new InvalidCaptureProposalError('invalid energy category');
  }
  const label = nullableText(raw.label, 300);
  const energyKcal = nullableNumber(raw.energy_kcal, 1_000_000);
  const durationMinutes = nullableNumber(raw.duration_minutes, 10_080, true);
  const occurredLocal = localDateTime(raw.occurred_local);
  const statedUncertainFields = uncertainFields(raw.uncertain_fields, energyCaptureFields);
  const withDefaultTime = includeUncertainField(
    statedUncertainFields,
    'occurredLocal',
    occurredLocal === null,
  );
  const withDefaultCategory = includeUncertainField(
    withDefaultTime,
    'category',
    direction === 'intake' && category === null,
  );

  return {
    kind: 'energy',
    recognized:
      raw.recognized &&
      direction !== null &&
      (label !== null || energyKcal !== null || durationMinutes !== null),
    direction: direction as EnergyDirection | null,
    label,
    category: category as EnergyCaptureProposal['category'],
    energyKcal,
    occurredLocal,
    durationMinutes,
    notes: nullableText(raw.notes, 1000),
    uncertainFields: withDefaultCategory,
  };
}

export function normalizeHealthCapture(
  kind: 'medicine' | 'energy',
  value: unknown,
): HealthCaptureProposal {
  return kind === 'medicine' ? normalizeMedicineCapture(value) : normalizeEnergyCapture(value);
}
