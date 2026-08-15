import { isMedicineStatus, type MedicineStatus } from '$lib/medicine';

const fieldLimits = {
  name: 200,
  genericName: 200,
  form: 120,
  strength: 120,
  route: 120,
  schedule: 1000,
  purpose: 500,
  prescriber: 200,
  notes: 4000,
} as const;

export type MedicineInput = {
  name: string;
  genericName: string | null;
  form: string | null;
  strength: string | null;
  route: string | null;
  schedule: string | null;
  status: MedicineStatus;
  startDate: string | null;
  endDate: string | null;
  purpose: string | null;
  prescriber: string | null;
  notes: string | null;
};

export class InvalidMedicineInputError extends Error {
  constructor(public readonly code: 'missing_name' | 'invalid_status' | 'invalid_date' | 'field_too_long') {
    super(code);
  }
}

function readText(data: FormData, key: keyof typeof fieldLimits) {
  const value = data.get(key);
  const normalized = typeof value === 'string' ? value.trim() : '';

  if (normalized.length > fieldLimits[key]) {
    throw new InvalidMedicineInputError('field_too_long');
  }

  return normalized || null;
}

function readDate(data: FormData, key: 'startDate' | 'endDate') {
  const value = data.get(key);
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) return null;

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (!match) throw new InvalidMedicineInputError('invalid_date');

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new InvalidMedicineInputError('invalid_date');
  }

  return normalized;
}

export function parseMedicineInput(data: FormData): MedicineInput {
  const name = readText(data, 'name');
  if (!name) throw new InvalidMedicineInputError('missing_name');

  const statusValue = data.get('status');
  const status = typeof statusValue === 'string' ? statusValue : '';
  if (!isMedicineStatus(status)) throw new InvalidMedicineInputError('invalid_status');

  return {
    name,
    genericName: readText(data, 'genericName'),
    form: readText(data, 'form'),
    strength: readText(data, 'strength'),
    route: readText(data, 'route'),
    schedule: readText(data, 'schedule'),
    status,
    startDate: readDate(data, 'startDate'),
    endDate: readDate(data, 'endDate'),
    purpose: readText(data, 'purpose'),
    prescriber: readText(data, 'prescriber'),
    notes: readText(data, 'notes'),
  };
}
