import { and, count, desc, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';
import { energyDirections, energyStatuses, type EnergyClaimRecord } from '$lib/energy';
import { medicineStatuses, type MedicineClaimRecord } from '$lib/medicine';
import { db } from '$lib/server/db';
import {
  claimRevision,
  energyClaim,
  energySource,
  medicineClaim,
} from '$lib/server/db/schema';
import {
  createEnergyClaim,
  createMedicineClaim,
  normalizeEnergyClaim,
  normalizeMedicineClaim,
  updateEnergyClaim,
  updateMedicineClaim,
} from '$lib/server/claim-mutations';
import {
  StaleClaimRevisionError,
  toEnergyClaimRevision,
  toMedicineClaimRevision,
} from '$lib/server/claim-revisions';
import {
  InvalidEnergyInputError,
  parseEnergyInput,
  validateEnergyEntry,
} from '$lib/server/energy';
import { InvalidMedicineInputError, parseMedicineInput } from '$lib/server/medicines';
import {
  getOwnedEnergyClaim,
  getOwnedMedicineClaim,
} from '$lib/server/ownership';
import {
  isValidTimeZone,
  timeZoneFromMetadata,
  toDateTimeLocal,
  utcOffsetMinutesAt,
} from '$lib/time-zone';
import { capResult } from './budget';
import { requirePatient, ToolError, type McpContext } from './context';
import type { ToolDefinition } from './tools';

const MAX_CLAIMS_PER_PAGE = 100;
const MAX_HISTORY_PER_PAGE = 100;
const REQUEST_ID_LIMIT = 128;

const medicineFields = [
  'name',
  'generic_name',
  'form',
  'strength',
  'route',
  'schedule',
  'status',
  'start_date',
  'end_date',
  'purpose',
  'prescriber',
  'notes',
] as const;

const energyFields = [
  'direction',
  'label',
  'category',
  'energy_kcal',
  'occurred_at',
  'timezone',
  'duration_minutes',
  'status',
  'notes',
] as const;

const medicineProperties = {
  name: { type: 'string', maxLength: 200 },
  generic_name: { type: ['string', 'null'], maxLength: 200 },
  form: { type: ['string', 'null'], maxLength: 120 },
  strength: { type: ['string', 'null'], maxLength: 120 },
  route: { type: ['string', 'null'], maxLength: 120 },
  schedule: { type: ['string', 'null'], maxLength: 1000 },
  status: { type: 'string', enum: medicineStatuses },
  start_date: { type: ['string', 'null'], description: 'Calendar date in YYYY-MM-DD form.' },
  end_date: { type: ['string', 'null'], description: 'Calendar date in YYYY-MM-DD form.' },
  purpose: { type: ['string', 'null'], maxLength: 500 },
  prescriber: { type: ['string', 'null'], maxLength: 200 },
  notes: { type: ['string', 'null'], maxLength: 4000 },
} as const;

const energyProperties = {
  direction: { type: 'string', enum: energyDirections },
  label: { type: ['string', 'null'], maxLength: 300 },
  category: { type: ['string', 'null'], maxLength: 100 },
  energy_kcal: { type: ['number', 'null'], minimum: 0, maximum: 1_000_000 },
  occurred_at: {
    type: 'string',
    description: 'ISO timestamp with Z or a numeric UTC offset. Stored at minute resolution.',
  },
  timezone: { type: 'string', description: 'IANA timezone. The profile timezone is the default.' },
  duration_minutes: { type: ['integer', 'null'], minimum: 0, maximum: 10_080 },
  status: { type: 'string', enum: energyStatuses },
  notes: { type: ['string', 'null'], maxLength: 4000 },
} as const;

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function owns(object: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function filterText(args: Record<string, unknown>, key: string, maximum?: number) {
  if (!owns(args, key)) return null;
  if (typeof args[key] !== 'string') throw new ToolError(`${key} must be text`);
  const normalized = args[key].trim();
  if (maximum && normalized.length > maximum) throw new ToolError(`${key} is too long`);
  return normalized || null;
}

function pageLimit(value: unknown, fallback: number, maximum = MAX_CLAIMS_PER_PAGE) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > maximum) {
    throw new ToolError(`limit must be an integer from 1 through ${maximum}`);
  }

  return Number(value);
}

function positiveInteger(value: unknown, field: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new ToolError(`${field} must be a positive integer`);
  }

  return Number(value);
}

function requestId(value: unknown) {
  const normalized = text(value);
  if (
    !normalized ||
    normalized.length > REQUEST_ID_LIMIT ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new ToolError(`request_id must contain 1 to ${REQUEST_ID_LIMIT} visible characters`);
  }

  return normalized;
}

function optionalTextField(
  args: Record<string, unknown>,
  key: string,
  fallback: string | null = null,
) {
  if (!owns(args, key)) return fallback ?? '';
  const value = args[key];
  if (value === null) return '';
  if (typeof value !== 'string') throw new ToolError(`${key} must be text or null`);
  return value;
}

function optionalNumberField(
  args: Record<string, unknown>,
  key: string,
  fallback: number | null = null,
) {
  if (!owns(args, key)) return fallback === null ? '' : String(fallback);
  const value = args[key];
  if (value === null) return '';
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ToolError(`${key} must be a number or null`);
  }
  return String(value);
}

function dateOnly(value: unknown, field: string) {
  if (value === undefined) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ToolError(`${field} must use YYYY-MM-DD`);
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new ToolError(`${field} is not a calendar date`);
  }

  return value;
}

function instant(value: unknown, fallback: number) {
  if (value === undefined) return new Date(fallback).toISOString();
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/i.test(value.trim())
  ) {
    throw new ToolError('occurred_at must be an ISO timestamp with Z or a numeric UTC offset');
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new ToolError('occurred_at is not a valid timestamp');
  return parsed.toISOString();
}

function mcpProvider(ctx: McpContext) {
  return `mcp:${ctx.clientId}`;
}

async function stableClaimId(
  ctx: McpContext,
  patientId: string,
  kind: 'medicine' | 'energy',
  idempotencyKey: string,
) {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(
        ['health-tracker-mcp-claim', patientId, ctx.clientId, kind, idempotencyKey].join('\u001f'),
      ),
    ),
  );
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function medicineForm(args: Record<string, unknown>, current?: MedicineClaimRecord) {
  const data = new FormData();
  data.set('name', optionalTextField(args, 'name', current?.name ?? null));
  data.set('genericName', optionalTextField(args, 'generic_name', current?.genericName ?? null));
  data.set('form', optionalTextField(args, 'form', current?.form ?? null));
  data.set('strength', optionalTextField(args, 'strength', current?.strength ?? null));
  data.set('route', optionalTextField(args, 'route', current?.route ?? null));
  data.set('schedule', optionalTextField(args, 'schedule', current?.schedule ?? null));
  data.set('status', optionalTextField(args, 'status', current?.status ?? 'active'));
  data.set('startDate', optionalTextField(args, 'start_date', current?.startDate ?? null));
  data.set('endDate', optionalTextField(args, 'end_date', current?.endDate ?? null));
  data.set('purpose', optionalTextField(args, 'purpose', current?.purpose ?? null));
  data.set('prescriber', optionalTextField(args, 'prescriber', current?.prescriber ?? null));
  data.set('notes', optionalTextField(args, 'notes', current?.notes ?? null));
  return data;
}

function parseMedicine(args: Record<string, unknown>, current?: MedicineClaimRecord) {
  try {
    return parseMedicineInput(medicineForm(args, current));
  } catch (error) {
    if (error instanceof InvalidMedicineInputError) {
      throw new ToolError(`Invalid medicine claim: ${error.code}`);
    }
    throw error;
  }
}

function energyForm(
  ctx: McpContext,
  args: Record<string, unknown>,
  profileMetadata: unknown,
  current?: EnergyClaimRecord,
) {
  const changesTime = owns(args, 'occurred_at') || owns(args, 'timezone');
  if (current && !changesTime) {
    const fixedLocal = new Date(
      new Date(current.occurredAt).getTime() + current.timezoneOffsetMinutes * 60_000,
    )
      .toISOString()
      .slice(0, 16);
    const data = new FormData();
    data.set('direction', optionalTextField(args, 'direction', current.direction));
    data.set('label', optionalTextField(args, 'label', current.label));
    data.set('category', optionalTextField(args, 'category', current.category));
    data.set('energyKcal', optionalNumberField(args, 'energy_kcal', current.energyKcal));
    data.set('occurredLocal', fixedLocal);
    data.set('timezoneOffsetMinutes', String(current.timezoneOffsetMinutes));
    data.set('timezone', current.timezone ?? '');
    data.set(
      'durationMinutes',
      optionalNumberField(args, 'duration_minutes', current.durationMinutes),
    );
    data.set('status', optionalTextField(args, 'status', current.status));
    data.set('notes', optionalTextField(args, 'notes', current.notes));
    return data;
  }

  const fallbackZone =
    current?.timezone && isValidTimeZone(current.timezone)
      ? current.timezone
      : timeZoneFromMetadata(profileMetadata);
  let zone = fallbackZone;

  if (owns(args, 'timezone')) {
    if (typeof args.timezone !== 'string' || !isValidTimeZone(args.timezone)) {
      throw new ToolError('timezone must be an IANA timezone');
    }
    zone = args.timezone.trim();
  }

  const occurredAt = instant(
    owns(args, 'occurred_at') ? args.occurred_at : current?.occurredAt,
    ctx.now,
  );
  const occurredLocal = toDateTimeLocal(occurredAt, zone);
  const offset = utcOffsetMinutesAt(occurredAt, zone);
  if (!occurredLocal || offset === null) throw new ToolError('The entry time could not be resolved');

  const data = new FormData();
  data.set('direction', optionalTextField(args, 'direction', current?.direction ?? null));
  data.set('label', optionalTextField(args, 'label', current?.label ?? null));
  data.set('category', optionalTextField(args, 'category', current?.category ?? null));
  data.set('energyKcal', optionalNumberField(args, 'energy_kcal', current?.energyKcal ?? null));
  data.set('occurredLocal', occurredLocal);
  data.set('timezoneOffsetMinutes', String(offset));
  data.set('timezone', zone);
  data.set(
    'durationMinutes',
    optionalNumberField(args, 'duration_minutes', current?.durationMinutes ?? null),
  );
  data.set('status', optionalTextField(args, 'status', current?.status ?? 'auto'));
  data.set('notes', optionalTextField(args, 'notes', current?.notes ?? null));
  return data;
}

function parseEnergy(
  ctx: McpContext,
  args: Record<string, unknown>,
  profileMetadata: unknown,
  hasPhoto: boolean,
  current?: EnergyClaimRecord,
) {
  try {
    const parsed = parseEnergyInput(energyForm(ctx, args, profileMetadata, current));
    validateEnergyEntry(parsed, hasPhoto);
    return parsed;
  } catch (error) {
    if (error instanceof InvalidEnergyInputError) {
      throw new ToolError(`Invalid energy claim: ${error.code}`);
    }
    throw error;
  }
}

function serializeMedicine(claim: MedicineClaimRecord) {
  return {
    medicine_id: claim.id,
    patient_id: claim.patientId,
    name: claim.name,
    generic_name: claim.genericName,
    form: claim.form,
    strength: claim.strength,
    route: claim.route,
    schedule: claim.schedule,
    status: claim.status,
    start_date: claim.startDate,
    end_date: claim.endDate,
    purpose: claim.purpose,
    prescriber: claim.prescriber,
    notes: claim.notes,
    origin: {
      kind: claim.originKind,
      provider: claim.originProvider,
      external_id: claim.originExternalId,
    },
    revision: claim.revision,
    created_at: claim.createdAt,
    updated_at: claim.updatedAt,
  };
}

function serializeEnergy(claim: EnergyClaimRecord, retainedFileCount = 0) {
  return {
    energy_entry_id: claim.id,
    patient_id: claim.patientId,
    direction: claim.direction,
    label: claim.label,
    category: claim.category,
    energy_kcal: claim.energyKcal,
    occurred_at: claim.occurredAt,
    local_date: claim.localDate,
    timezone: claim.timezone,
    timezone_offset_minutes: claim.timezoneOffsetMinutes,
    duration_minutes: claim.durationMinutes,
    status: claim.status,
    notes: claim.notes,
    retained_file_count: retainedFileCount,
    origin: {
      kind: claim.originKind,
      provider: claim.originProvider,
      external_id: claim.originExternalId,
    },
    revision: claim.revision,
    created_at: claim.createdAt,
    updated_at: claim.updatedAt,
  };
}

async function retainedFileCounts(patientId: string, claimIds: string[]) {
  const counts = new Map<string, number>();
  if (claimIds.length === 0) return counts;

  const rows = await db
    .select({ energyClaimId: energySource.energyClaimId })
    .from(energySource)
    .where(
      and(
        eq(energySource.patientId, patientId),
        inArray(energySource.energyClaimId, claimIds),
      ),
    );
  for (const row of rows) {
    counts.set(row.energyClaimId, (counts.get(row.energyClaimId) ?? 0) + 1);
  }
  return counts;
}

const listMedicines: ToolDefinition = {
  name: 'list_medicines',
  title: 'List medicine claims',
  description:
    'Current medicine catalog for one profile. These are editable claims about medicines and schedules. They do not prove that a dose was taken.',
  inputSchema: {
    type: 'object',
    properties: {
      patient_id: { type: 'string' },
      status: { type: 'string', enum: medicineStatuses },
      query: { type: 'string', maxLength: 200 },
      limit: { type: 'integer', minimum: 1, maximum: MAX_CLAIMS_PER_PAGE },
    },
    required: ['patient_id'],
    additionalProperties: false,
  },
  handler: async (ctx, args) => {
    const profile = await requirePatient(ctx, args.patient_id);
    const status = filterText(args, 'status');
    if (status && !medicineStatuses.includes(status as (typeof medicineStatuses)[number])) {
      throw new ToolError('status is invalid');
    }
    const query = filterText(args, 'query', 200);
    const limit = pageLimit(args.limit, 50);
    const conditions = [eq(medicineClaim.patientId, profile.id)];
    if (status) conditions.push(eq(medicineClaim.status, status));
    if (query) {
      conditions.push(
        or(
          sql`instr(lower(${medicineClaim.name}), lower(${query})) > 0`,
          sql`instr(lower(coalesce(${medicineClaim.genericName}, '')), lower(${query})) > 0`,
          sql`instr(lower(coalesce(${medicineClaim.purpose}, '')), lower(${query})) > 0`,
        ) as typeof conditions[number],
      );
    }

    const where = and(...conditions);
    const [rows, totals] = await Promise.all([
      db
        .select()
        .from(medicineClaim)
        .where(where)
        .orderBy(desc(medicineClaim.updatedAt))
        .limit(limit),
      db.select({ value: count() }).from(medicineClaim).where(where),
    ]);

    return capResult({
      patient_id: profile.id,
      total: totals[0]?.value ?? 0,
      medicines: rows.map((row) => serializeMedicine(normalizeMedicineClaim(row))),
      truncated: Number(totals[0]?.value ?? 0) > rows.length,
    });
  },
};

const createMedicine: ToolDefinition = {
  name: 'create_medicine',
  title: 'Create a medicine claim',
  description:
    'Create one medicine catalog claim after the person confirms it. request_id makes retries safe within this connection and profile.',
  inputSchema: {
    type: 'object',
    properties: {
      patient_id: { type: 'string' },
      request_id: { type: 'string', minLength: 1, maxLength: REQUEST_ID_LIMIT },
      ...medicineProperties,
    },
    required: ['patient_id', 'request_id', 'name'],
    additionalProperties: false,
  },
  writes: true,
  writeCapability: 'claims',
  idempotent: true,
  handler: async (ctx, args) => {
    const profile = await requirePatient(ctx, args.patient_id);
    const key = requestId(args.request_id);
    const input = parseMedicine(args);
    const provider = mcpProvider(ctx);
    const result = await createMedicineClaim({
      id: await stableClaimId(ctx, profile.id, 'medicine', key),
      idempotent: true,
      patientId: profile.id,
      input,
      origin: { kind: 'mcp', provider, externalId: key },
    });

    return { created: result.created, medicine: serializeMedicine(result.claim) };
  },
};

const updateMedicine: ToolDefinition = {
  name: 'update_medicine',
  title: 'Update a medicine claim',
  description:
    'Change selected fields on a medicine claim. expected_revision prevents an agent from overwriting a newer edit. Send null to clear an optional field.',
  inputSchema: {
    type: 'object',
    properties: {
      patient_id: { type: 'string' },
      medicine_id: { type: 'string' },
      expected_revision: { type: 'integer', minimum: 1 },
      ...medicineProperties,
    },
    required: ['patient_id', 'medicine_id', 'expected_revision'],
    additionalProperties: false,
  },
  writes: true,
  writeCapability: 'claims',
  idempotent: true,
  handler: async (ctx, args) => {
    const profile = await requirePatient(ctx, args.patient_id);
    const id = text(args.medicine_id);
    if (!id) throw new ToolError('medicine_id is required');
    const expectedRevision = positiveInteger(args.expected_revision, 'expected_revision');
    if (!medicineFields.some((field) => owns(args, field))) {
      throw new ToolError('Provide at least one medicine field to change');
    }

    const stored = await getOwnedMedicineClaim(ctx.userId, id);
    if (!stored || stored.patientId !== profile.id) throw new ToolError('No such medicine claim');
    if (stored.revision !== expectedRevision) {
      throw new ToolError(`Revision conflict; current_revision is ${stored.revision}`);
    }

    const current = normalizeMedicineClaim(stored);
    const input = parseMedicine(args, current);
    try {
      const updated = await updateMedicineClaim({
        current: stored,
        input,
        expectedRevision,
        source: { kind: 'mcp', provider: mcpProvider(ctx) },
        changedAt: new Date(ctx.now).toISOString(),
      });
      return { updated: true, medicine: serializeMedicine(updated) };
    } catch (error) {
      if (error instanceof StaleClaimRevisionError) {
        const latest = await getOwnedMedicineClaim(ctx.userId, id);
        throw new ToolError(`Revision conflict; current_revision is ${latest?.revision ?? 'unknown'}`);
      }
      throw error;
    }
  },
};

const listEnergyEntries: ToolDefinition = {
  name: 'list_energy_entries',
  title: 'List energy claims',
  description:
    'Food intake and energy expenditure claims for one profile. Totals include recorded entries with known kilocalories. Retained photos are reported as counts without file access.',
  inputSchema: {
    type: 'object',
    properties: {
      patient_id: { type: 'string' },
      direction: { type: 'string', enum: energyDirections },
      status: { type: 'string', enum: energyStatuses },
      from: { type: 'string', description: 'Local calendar date, inclusive, in YYYY-MM-DD form.' },
      to: { type: 'string', description: 'Local calendar date, inclusive, in YYYY-MM-DD form.' },
      query: { type: 'string', maxLength: 300 },
      limit: { type: 'integer', minimum: 1, maximum: MAX_CLAIMS_PER_PAGE },
    },
    required: ['patient_id'],
    additionalProperties: false,
  },
  handler: async (ctx, args) => {
    const profile = await requirePatient(ctx, args.patient_id);
    const direction = filterText(args, 'direction');
    if (direction && !energyDirections.includes(direction as (typeof energyDirections)[number])) {
      throw new ToolError('direction is invalid');
    }
    const status = filterText(args, 'status');
    if (status && !energyStatuses.includes(status as (typeof energyStatuses)[number])) {
      throw new ToolError('status is invalid');
    }
    const from = dateOnly(args.from, 'from');
    const to = dateOnly(args.to, 'to');
    if (from && to && from > to) throw new ToolError('from must be on or before to');
    const query = filterText(args, 'query', 300);
    const limit = pageLimit(args.limit, 50);
    const conditions = [eq(energyClaim.patientId, profile.id)];
    if (direction) conditions.push(eq(energyClaim.direction, direction));
    if (status) conditions.push(eq(energyClaim.status, status));
    if (from) conditions.push(gte(energyClaim.localDate, from));
    if (to) conditions.push(lte(energyClaim.localDate, to));
    if (query) {
      conditions.push(
        or(
          sql`instr(lower(coalesce(${energyClaim.label}, '')), lower(${query})) > 0`,
          sql`instr(lower(coalesce(${energyClaim.category}, '')), lower(${query})) > 0`,
          sql`instr(lower(coalesce(${energyClaim.notes}, '')), lower(${query})) > 0`,
        ) as typeof conditions[number],
      );
    }

    const where = and(...conditions);
    const [rows, totals] = await Promise.all([
      db
        .select()
        .from(energyClaim)
        .where(where)
        .orderBy(desc(energyClaim.occurredAt))
        .limit(limit),
      db
        .select({
          value: count(),
          intake: sql<number>`coalesce(sum(case when ${energyClaim.status} = 'recorded' and ${energyClaim.direction} = 'intake' then ${energyClaim.energyKcal} else 0 end), 0)`,
          expenditure: sql<number>`coalesce(sum(case when ${energyClaim.status} = 'recorded' and ${energyClaim.direction} = 'expenditure' then ${energyClaim.energyKcal} else 0 end), 0)`,
        })
        .from(energyClaim)
        .where(where),
    ]);
    const normalized = rows.map(normalizeEnergyClaim);
    const files = await retainedFileCounts(
      profile.id,
      normalized.map((entry) => entry.id),
    );
    const intake = Number(totals[0]?.intake ?? 0);
    const expenditure = Number(totals[0]?.expenditure ?? 0);

    return capResult({
      patient_id: profile.id,
      total: totals[0]?.value ?? 0,
      totals_kcal: { intake, expenditure, net: intake - expenditure },
      entries: normalized.map((entry) => serializeEnergy(entry, files.get(entry.id) ?? 0)),
      truncated: Number(totals[0]?.value ?? 0) > rows.length,
    });
  },
};

const logEnergyEntry: ToolDefinition = {
  name: 'log_energy_entry',
  title: 'Log an energy claim',
  description:
    'Record food intake or energy expenditure after the person confirms the fields. Unknown kilocalories produce a draft when a label is present. request_id makes retries safe.',
  inputSchema: {
    type: 'object',
    properties: {
      patient_id: { type: 'string' },
      request_id: { type: 'string', minLength: 1, maxLength: REQUEST_ID_LIMIT },
      ...energyProperties,
    },
    required: ['patient_id', 'request_id', 'direction'],
    additionalProperties: false,
  },
  writes: true,
  writeCapability: 'claims',
  idempotent: true,
  handler: async (ctx, args) => {
    const profile = await requirePatient(ctx, args.patient_id);
    const key = requestId(args.request_id);
    const input = parseEnergy(ctx, args, profile.extraData, false);
    const provider = mcpProvider(ctx);
    const result = await createEnergyClaim({
      id: await stableClaimId(ctx, profile.id, 'energy', key),
      idempotent: true,
      patientId: profile.id,
      input,
      origin: { kind: 'mcp', provider, externalId: key },
    });

    return { created: result.created, entry: serializeEnergy(result.claim) };
  },
};

const updateEnergyEntry: ToolDefinition = {
  name: 'update_energy_entry',
  title: 'Update an energy claim',
  description:
    'Change selected fields on an intake or expenditure claim. expected_revision protects newer edits. Existing retained photos stay attached.',
  inputSchema: {
    type: 'object',
    properties: {
      patient_id: { type: 'string' },
      energy_entry_id: { type: 'string' },
      expected_revision: { type: 'integer', minimum: 1 },
      ...energyProperties,
    },
    required: ['patient_id', 'energy_entry_id', 'expected_revision'],
    additionalProperties: false,
  },
  writes: true,
  writeCapability: 'claims',
  idempotent: true,
  handler: async (ctx, args) => {
    const profile = await requirePatient(ctx, args.patient_id);
    const id = text(args.energy_entry_id);
    if (!id) throw new ToolError('energy_entry_id is required');
    const expectedRevision = positiveInteger(args.expected_revision, 'expected_revision');
    if (!energyFields.some((field) => owns(args, field))) {
      throw new ToolError('Provide at least one energy field to change');
    }

    const stored = await getOwnedEnergyClaim(ctx.userId, id);
    if (!stored || stored.patientId !== profile.id) throw new ToolError('No such energy claim');
    if (stored.revision !== expectedRevision) {
      throw new ToolError(`Revision conflict; current_revision is ${stored.revision}`);
    }
    const sourceCount = await db
      .select({ value: count() })
      .from(energySource)
      .where(
        and(
          eq(energySource.patientId, profile.id),
          eq(energySource.energyClaimId, stored.id),
        ),
      );
    const current = normalizeEnergyClaim(stored);
    const input = parseEnergy(ctx, args, profile.extraData, Number(sourceCount[0]?.value ?? 0) > 0, current);

    try {
      const updated = await updateEnergyClaim({
        current: stored,
        input,
        expectedRevision,
        source: { kind: 'mcp', provider: mcpProvider(ctx) },
        changedAt: new Date(ctx.now).toISOString(),
      });
      return {
        updated: true,
        entry: serializeEnergy(updated, Number(sourceCount[0]?.value ?? 0)),
      };
    } catch (error) {
      if (error instanceof StaleClaimRevisionError) {
        const latest = await getOwnedEnergyClaim(ctx.userId, id);
        throw new ToolError(`Revision conflict; current_revision is ${latest?.revision ?? 'unknown'}`);
      }
      throw error;
    }
  },
};

const getClaimHistory: ToolDefinition = {
  name: 'get_claim_history',
  title: 'Get claim history',
  description:
    'Saved versions of one medicine or energy claim, newest first. Each version includes the change source and the complete snapshot held at that revision.',
  inputSchema: {
    type: 'object',
    properties: {
      patient_id: { type: 'string' },
      claim_kind: { type: 'string', enum: ['medicine', 'energy'] },
      claim_id: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: MAX_HISTORY_PER_PAGE },
    },
    required: ['patient_id', 'claim_kind', 'claim_id'],
    additionalProperties: false,
  },
  handler: async (ctx, args) => {
    const profile = await requirePatient(ctx, args.patient_id);
    const kind = text(args.claim_kind);
    if (kind !== 'medicine' && kind !== 'energy') {
      throw new ToolError('claim_kind must be medicine or energy');
    }
    const claimId = text(args.claim_id);
    if (!claimId) throw new ToolError('claim_id is required');
    const limit = pageLimit(args.limit, 25, MAX_HISTORY_PER_PAGE);

    const currentRows =
      kind === 'medicine'
        ? await db
            .select()
            .from(medicineClaim)
            .where(
              and(eq(medicineClaim.id, claimId), eq(medicineClaim.patientId, profile.id)),
            )
            .limit(1)
        : await db
            .select()
            .from(energyClaim)
            .where(and(eq(energyClaim.id, claimId), eq(energyClaim.patientId, profile.id)))
            .limit(1);
    if (!currentRows[0]) throw new ToolError('No such claim');
    const retainedFileCount =
      kind === 'energy'
        ? ((await retainedFileCounts(profile.id, [claimId])).get(claimId) ?? 0)
        : 0;

    const where = and(
      eq(claimRevision.patientId, profile.id),
      eq(claimRevision.claimKind, kind),
      eq(claimRevision.claimId, claimId),
    );
    const [rows, totals] = await Promise.all([
      db
        .select()
        .from(claimRevision)
        .where(where)
        .orderBy(desc(claimRevision.revision))
        .limit(limit),
      db.select({ value: count() }).from(claimRevision).where(where),
    ]);
    const revisions = rows.flatMap((row) => {
      const parsed =
        kind === 'medicine'
          ? toMedicineClaimRevision(row)
          : toEnergyClaimRevision(row);
      if (!parsed) return [];
      return [
        {
          revision: parsed.revision,
          changed_at: parsed.changedAt,
          change_source: {
            kind: parsed.changeOriginKind,
            provider: parsed.changeOriginProvider,
          },
          snapshot:
            kind === 'medicine'
              ? serializeMedicine(parsed.snapshot as MedicineClaimRecord)
              : serializeEnergy(parsed.snapshot as EnergyClaimRecord, retainedFileCount),
        },
      ];
    });
    const current =
      kind === 'medicine'
        ? serializeMedicine(normalizeMedicineClaim(currentRows[0] as typeof medicineClaim.$inferSelect))
        : serializeEnergy(
            normalizeEnergyClaim(currentRows[0] as typeof energyClaim.$inferSelect),
            retainedFileCount,
          );

    return capResult({
      patient_id: profile.id,
      claim_kind: kind,
      claim_id: claimId,
      current,
      total: totals[0]?.value ?? 0,
      revisions,
      truncated: Number(totals[0]?.value ?? 0) > revisions.length,
    });
  },
};

export const healthClaimTools: ToolDefinition[] = [
  listMedicines,
  listEnergyEntries,
  getClaimHistory,
  createMedicine,
  updateMedicine,
  logEnergyEntry,
  updateEnergyEntry,
];
