import {
  energyCalendarDateFromLocalDateTime,
  isEnergyFoodDataSource,
  isEnergyDirection,
  isEnergyStatus,
  type EnergyDirection,
  type EnergyFoodDataSource,
  type EnergyFoodItemRecord,
  type EnergyStatus,
  suggestEnergyDiaryDate,
} from '$lib/energy';

const fieldLimits = {
  label: 300,
  category: 100,
  timezone: 100,
  notes: 4000,
} as const;

const foodFieldLimits = {
  name: 300,
  quantityUnit: 40,
  notes: 1000,
  id: 100,
  originExternalId: 1000,
} as const;

const MAX_FOOD_ITEMS = 100;
const MAX_FOOD_ITEMS_BYTES = 256 * 1024;

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

export type EnergyFoodItemInput = {
  /** Id of a stored food of the same meal; the row is updated in place. */
  id?: string | null;
  /** Omitted keeps the stored value of a matched food. */
  originExternalId?: string | null;
  nutritionData?: Record<string, number> | null;
  name: string;
  quantityValue: number | null;
  quantityUnit: string | null;
  energyKcal: number | null;
  energyKcalMin: number | null;
  energyKcalMax: number | null;
  proteinG: number | null;
  carbohydrateG: number | null;
  fatG: number | null;
  fiberG: number | null;
  sodiumMg: number | null;
  dataSource: EnergyFoodDataSource;
  notes: string | null;
};

export type ParsedEnergyInput = {
  claim: EnergyInput;
  foodItems: EnergyFoodItemInput[] | null;
};

export type EnergyInputErrorCode =
  | 'invalid_direction'
  | 'invalid_status'
  | 'invalid_energy'
  | 'missing_energy'
  | 'invalid_time'
  | 'invalid_timezone'
  | 'invalid_duration'
  | 'invalid_diary_date'
  | 'invalid_food_items'
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

function optionalFoodText(
  row: Record<string, unknown>,
  key: keyof typeof foodFieldLimits,
) {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new InvalidEnergyInputError('invalid_food_items');
  const normalized = value.trim();
  if (normalized.length > foodFieldLimits[key]) {
    throw new InvalidEnergyInputError('field_too_long');
  }
  return normalized || null;
}

function optionalFoodNumber(
  row: Record<string, unknown>,
  key: string,
  maximum = 1_000_000,
) {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number') throw new InvalidEnergyInputError('invalid_food_items');
  const parsed = value;
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > maximum) {
    throw new InvalidEnergyInputError('invalid_food_items');
  }
  return Math.round(parsed * 1000) / 1000;
}

function optionalNutritionData(row: Record<string, unknown>) {
  const value = row.nutritionData;
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new InvalidEnergyInputError('invalid_food_items');
  }
  const entries = Object.entries(value);
  if (entries.length > 100) throw new InvalidEnergyInputError('invalid_food_items');
  const result: Record<string, number> = {};
  for (const [key, amount] of entries) {
    if (!key || key.length > 120 || typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
      throw new InvalidEnergyInputError('invalid_food_items');
    }
    result[key] = amount;
  }
  return result;
}

function readFoodItems(data: FormData, direction: EnergyDirection) {
  const raw = data.get('foodItems');
  if (direction !== 'intake' || raw === null) return null;
  if (typeof raw !== 'string' || raw.length > MAX_FOOD_ITEMS_BYTES) {
    throw new InvalidEnergyInputError('invalid_food_items');
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new InvalidEnergyInputError('invalid_food_items');
  }
  if (!Array.isArray(value) || value.length > MAX_FOOD_ITEMS) {
    throw new InvalidEnergyInputError('invalid_food_items');
  }

  const seenIds = new Set<string>();
  const seenOrigins = new Set<string>();
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new InvalidEnergyInputError('invalid_food_items');
    }
    const row = item as Record<string, unknown>;
    const name = optionalFoodText(row, 'name');
    if (!name) throw new InvalidEnergyInputError('invalid_food_items');

    const energyKcal = optionalFoodNumber(row, 'energyKcal');
    const energyKcalMin = optionalFoodNumber(row, 'energyKcalMin');
    const energyKcalMax = optionalFoodNumber(row, 'energyKcalMax');
    if (
      (energyKcalMin !== null && energyKcalMax !== null && energyKcalMin > energyKcalMax) ||
      (energyKcal !== null && energyKcalMin !== null && energyKcal < energyKcalMin) ||
      (energyKcal !== null && energyKcalMax !== null && energyKcal > energyKcalMax)
    ) {
      throw new InvalidEnergyInputError('invalid_food_items');
    }

    const source = typeof row.dataSource === 'string' ? row.dataSource : 'unknown';
    if (!isEnergyFoodDataSource(source)) {
      throw new InvalidEnergyInputError('invalid_food_items');
    }

    const id = optionalFoodText(row, 'id');
    const originExternalId =
      row.originExternalId === undefined ? undefined : optionalFoodText(row, 'originExternalId');
    if (id) {
      if (seenIds.has(id)) throw new InvalidEnergyInputError('invalid_food_items');
      seenIds.add(id);
    }
    if (originExternalId) {
      if (seenOrigins.has(originExternalId)) throw new InvalidEnergyInputError('invalid_food_items');
      seenOrigins.add(originExternalId);
    }

    return {
      id,
      originExternalId,
      nutritionData: optionalNutritionData(row),
      name,
      quantityValue: optionalFoodNumber(row, 'quantityValue'),
      quantityUnit: optionalFoodText(row, 'quantityUnit'),
      energyKcal,
      energyKcalMin,
      energyKcalMax,
      proteinG: optionalFoodNumber(row, 'proteinG'),
      carbohydrateG: optionalFoodNumber(row, 'carbohydrateG'),
      fatG: optionalFoodNumber(row, 'fatG'),
      fiberG: optionalFoodNumber(row, 'fiberG'),
      sodiumMg: optionalFoodNumber(row, 'sodiumMg', 100_000_000),
      dataSource: source,
      notes: optionalFoodText(row, 'notes'),
    };
  });
}

type StoredFoodItem = EnergyFoodItemRecord;

const foodItemFields = [
  'name', 'quantityValue', 'quantityUnit', 'energyKcal', 'energyKcalMin', 'energyKcalMax',
  'proteinG', 'carbohydrateG', 'fatG', 'fiberG', 'sodiumMg', 'dataSource', 'notes',
] as const;

/**
 * Matches submitted foods to the stored ones by id. Matched rows are updated in place
 * (keeping id, creation time, origin and nutrition data the submission omits); unmatched
 * submissions are inserted; stored rows not submitted are deleted.
 */
export function planFoodItemChanges(current: StoredFoodItem[], items: EnergyFoodItemInput[]) {
  const stored = new Map(current.map((item) => [item.id, item]));
  const matched = new Set<string>();
  const updates: { id: string; orderIndex: number; changed: boolean; values: Record<string, unknown> }[] = [];
  const inserts: (EnergyFoodItemInput & { orderIndex: number })[] = [];

  items.forEach((item, orderIndex) => {
    const existing = item.id ? stored.get(item.id) : undefined;
    if (!existing || matched.has(existing.id)) {
      inserts.push({ ...item, id: undefined, orderIndex });
      return;
    }
    matched.add(existing.id);
    const values: Record<string, unknown> = { orderIndex };
    for (const field of foodItemFields) values[field] = item[field];
    if (item.originExternalId !== undefined) values.originExternalId = item.originExternalId;
    if (item.nutritionData !== undefined) values.nutritionData = item.nutritionData;
    const changed = Object.entries(values).some(
      ([key, value]) =>
        JSON.stringify(value) !== JSON.stringify((existing as unknown as Record<string, unknown>)[key]),
    );
    updates.push({ id: existing.id, orderIndex, changed, values });
  });

  return {
    deletes: current.filter((item) => !matched.has(item.id)).map((item) => item.id),
    updates: updates.filter((update) => update.changed),
    inserts,
  };
}

export function foodItemsEnergyKcal(items: EnergyFoodItemInput[]) {
  if (items.length === 0 || items.some((item) => item.energyKcal === null)) return null;
  return Math.round(items.reduce((sum, item) => sum + (item.energyKcal || 0), 0) * 1000) / 1000;
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
    occurredLocal: value,
    calendarDate: energyCalendarDateFromLocalDateTime(value) || `${match[1]}-${match[2]}-${match[3]}`,
    occurredAt: new Date(localAsUtc.getTime() - timezoneOffsetMinutes * 60_000).toISOString(),
  };
}

function readDiaryDate(data: FormData, calendarDate: string, suggestedDate: string) {
  const raw = data.get('diaryDate');
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return suggestedDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new InvalidEnergyInputError('invalid_diary_date');
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new InvalidEnergyInputError('invalid_diary_date');
  }
  const calendar = new Date(`${calendarDate}T00:00:00.000Z`);
  const differenceDays = Math.abs((parsed.getTime() - calendar.getTime()) / 86_400_000);
  if (differenceDays > 1) throw new InvalidEnergyInputError('invalid_diary_date');
  return value;
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

export function parseEnergyInput(data: FormData): ParsedEnergyInput {
  const directionValue = data.get('direction');
  const direction = typeof directionValue === 'string' ? directionValue : '';
  if (!isEnergyDirection(direction)) throw new InvalidEnergyInputError('invalid_direction');

  const foodItems = readFoodItems(data, direction);
  const energyKcal = foodItems === null || foodItems.length === 0 ? readEnergyKcal(data) : foodItemsEnergyKcal(foodItems);
  const statusValue = data.get('status');
  const requestedStatus = typeof statusValue === 'string' ? statusValue : 'auto';
  const status = requestedStatus === 'auto' ? (energyKcal === null ? 'draft' : 'recorded') : requestedStatus;

  if (!isEnergyStatus(status)) throw new InvalidEnergyInputError('invalid_status');
  if (status === 'recorded' && energyKcal === null) {
    throw new InvalidEnergyInputError('missing_energy');
  }

  const category = readText(data, 'category');
  const timezoneOffsetMinutes = readTimezoneOffset(data);
  const { occurredAt, occurredLocal, calendarDate } = readLocalDateTime(
    data,
    timezoneOffsetMinutes,
  );
  const suggestedDate = suggestEnergyDiaryDate(occurredLocal, direction, category) || calendarDate;
  const localDate = readDiaryDate(data, calendarDate, suggestedDate);
  const timezone = readText(data, 'timezone');

  if (timezone) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: timezone }).format(0);
    } catch {
      throw new InvalidEnergyInputError('invalid_timezone');
    }
  }

  return {
    claim: {
      direction,
      label: readText(data, 'label'),
      category,
      energyKcal,
      occurredAt,
      localDate,
      timezone,
      timezoneOffsetMinutes,
      durationMinutes: readDuration(data, direction),
      status,
      notes: readText(data, 'notes'),
    },
    foodItems,
  };
}

export function validateEnergyEntry(
  input: EnergyInput,
  hasPhoto: boolean,
  foodItems: EnergyFoodItemInput[] | null = null,
) {
  if (!input.label && input.energyKcal === null && !hasPhoto && !foodItems?.length) {
    throw new InvalidEnergyInputError('empty_entry');
  }
}
