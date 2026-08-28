import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import {
  addDays,
  buildDoseChecklist,
  doseStatuses,
  formatAmountWithUnit,
  formatDoseAmount,
  isDoseStatus,
  planDoses,
  type DoseChecklistEntry,
  type DoseRegimenRecord,
  type DoseStatus,
  type MedicineCourseRecord,
} from '$lib/medicine-plan';
import type { MedicineClaimRecord } from '$lib/medicine';
import { db } from '$lib/server/db';
import {
  doseDelivery,
  doseOccurrence,
  doseRegimen,
  medicineClaim,
  medicineCourse,
} from '$lib/server/db/schema';
import {
  normalizeDoseOccurrence,
  normalizeDoseRegimen,
  normalizeMedicineCourse,
  recordPlannedDose,
  updateDoseOccurrence,
  UnknownDoseSlotError,
} from '$lib/server/medicine-plan-mutations';
import { normalizeMedicineClaim } from '$lib/server/claim-mutations';
import { StaleClaimRevisionError } from '$lib/server/claim-revisions';
import { toDateTimeLocal, utcOffsetMinutesAt } from '$lib/time-zone';
import { capResult } from './budget';
import { requirePatient, ToolError, type McpContext } from './context';
import type { ToolDefinition } from './tools';

const MAX_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_DELIVERIES = 100;
const MAX_OCCURRENCES = 500;

const recordableStatuses = doseStatuses.filter((status) => status !== 'planned');

function isoInstant(value: unknown, field: string) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/i.test(value.trim())
  ) {
    throw new ToolError(`${field} must be an ISO timestamp with Z or a numeric UTC offset`);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new ToolError(`${field} is not a valid timestamp`);
  return parsed.toISOString();
}

function slotIdentity(regimenId: string, localDate: string, slotKey: number) {
  return `${regimenId}:${localDate}:${slotKey}`;
}

const COMPOSITE_ID = /^([0-9a-f-]{36}):(\d{4}-\d{2}-\d{2}):(\d+)$/i;

interface PlanContext {
  courses: Map<string, MedicineCourseRecord>;
  regimens: Map<string, DoseRegimenRecord>;
  medicines: Map<string, MedicineClaimRecord>;
}

async function loadPlanContext(patientId: string): Promise<PlanContext> {
  const [courseRows, regimenRows, medicineRows] = await Promise.all([
    db.select().from(medicineCourse).where(eq(medicineCourse.patientId, patientId)),
    db.select().from(doseRegimen).where(eq(doseRegimen.patientId, patientId)),
    db.select().from(medicineClaim).where(eq(medicineClaim.patientId, patientId)),
  ]);

  return {
    courses: new Map(courseRows.map((row) => [row.id, normalizeMedicineCourse(row)])),
    regimens: new Map(regimenRows.map((row) => [row.id, normalizeDoseRegimen(row)])),
    medicines: new Map(medicineRows.map((row) => [row.id, normalizeMedicineClaim(row)])),
  };
}

function serializeEntry(entry: DoseChecklistEntry, plan: PlanContext) {
  const regimen = entry.regimenId ? plan.regimens.get(entry.regimenId) ?? null : null;
  const course = plan.courses.get(entry.courseId) ?? null;
  const medicine = course ? plan.medicines.get(course.medicineClaimId) ?? null : null;
  const slot = entry.slot;
  const record = entry.record;
  const occurrenceId =
    entry.regimenId && entry.slotKey !== null
      ? slotIdentity(entry.regimenId, entry.localDate, entry.slotKey)
      : record?.id ?? null;

  return {
    occurrence_id: occurrenceId,
    medicine_id: medicine?.id ?? null,
    medicine_name: medicine?.name ?? null,
    generic_name: medicine?.genericName ?? null,
    dose_line: record?.actualText
      ?? (record?.actualValue !== null && record?.actualValue !== undefined
        ? formatAmountWithUnit(record.actualValue, record.actualUnit)
        : formatDoseAmount(slot, regimen?.doseText ?? null)),
    form: medicine?.form ?? null,
    route: record?.route ?? regimen?.route ?? medicine?.route ?? null,
    site: record?.site ?? regimen?.site ?? null,
    slot_label: slot?.label ?? null,
    anchor: slot?.anchorKind
      ? {
          kind: slot.anchorKind,
          meal: slot.anchorMeal,
          offset_minutes: slot.anchorOffsetMinutes,
        }
      : null,
    local_date: entry.localDate,
    planned_at: entry.plannedAt,
    planned_local: entry.plannedAt ? toDateTimeLocal(entry.plannedAt, entry.timezone) : null,
    timezone: entry.timezone,
    utc_offset_minutes: entry.plannedAt
      ? utcOffsetMinutesAt(entry.plannedAt, entry.timezone)
      : null,
    status: entry.status,
    as_needed: regimen ? regimen.ruleKind === 'as_needed' : !entry.regimenId,
    actual_at: record?.actualAt ?? null,
    reason: record?.reason ?? null,
    reaction: record?.reaction ?? null,
    regimen_id: entry.regimenId,
    regimen_revision: record?.regimenRevision ?? regimen?.revision ?? null,
    remind_minutes_before: regimen?.remindMinutesBefore ?? null,
    record_revision: record?.revision ?? null,
  };
}

const listDoseOccurrences: ToolDefinition = {
  name: 'list_dose_occurrences',
  title: 'List dose occurrences',
  description:
    'Planned and recorded dose slots for one profile inside a caller-chosen window, at most 14 days wide. A slot with status planned has no record yet; it never becomes missed on its own. Wake, meal, and bedtime anchors carry no planned instant — the anchor object says what the dose is anchored to, and local_date bounds the day. occurrence_id is stable across regimen revisions for the same planned slot.',
  inputSchema: {
    type: 'object',
    properties: {
      patient_id: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      status: { type: 'string', enum: doseStatuses },
    },
    required: ['patient_id', 'from', 'to'],
    additionalProperties: false,
  },
  handler: async (ctx, args) => {
    const profile = await requirePatient(ctx, args.patient_id);
    const from = isoInstant(args.from, 'from');
    const to = isoInstant(args.to, 'to');
    if (from > to) throw new ToolError('from must not be after to');
    if (Date.parse(to) - Date.parse(from) > MAX_WINDOW_MS) {
      throw new ToolError('The window may span at most 14 days');
    }

    const statusFilter =
      args.status === undefined
        ? null
        : typeof args.status === 'string' && isDoseStatus(args.status)
          ? (args.status as DoseStatus)
          : null;
    if (args.status !== undefined && !statusFilter) throw new ToolError('status is invalid');

    const plan = await loadPlanContext(profile.id);

    // UTC-derived bounds padded a day each way cover every real timezone, so
    // recorded doses surface even when the profile has no regimen rows.
    const windowDates: string[] = [
      addDays(from.slice(0, 10), -1),
      addDays(to.slice(0, 10), 1),
    ];
    const planned = [];
    for (const regimen of plan.regimens.values()) {
      const course = plan.courses.get(regimen.courseId);
      if (!course) continue;

      const fromDate = toDateTimeLocal(from, regimen.timezone).slice(0, 10);
      const toDate = toDateTimeLocal(to, regimen.timezone).slice(0, 10);
      if (!fromDate || !toDate) continue;
      windowDates.push(fromDate, toDate);
      planned.push(...planDoses(course, regimen, fromDate, toDate));
    }
    const minDate = windowDates.length ? windowDates.reduce((a, b) => (a < b ? a : b)) : null;
    const maxDate = windowDates.length ? windowDates.reduce((a, b) => (a > b ? a : b)) : null;

    const stored =
      minDate && maxDate
        ? await db
            .select()
            .from(doseOccurrence)
            .where(
              and(
                eq(doseOccurrence.patientId, profile.id),
                gte(doseOccurrence.localDate, minDate),
                lte(doseOccurrence.localDate, maxDate),
              ),
            )
        : [];

    const entries = buildDoseChecklist(planned, stored.map(normalizeDoseOccurrence))
      .filter((entry) => {
        const instant = entry.plannedAt ?? entry.record?.actualAt ?? null;
        return instant ? instant >= from && instant <= to : true;
      })
      .filter((entry) => (statusFilter ? entry.status === statusFilter : true))
      .slice(0, MAX_OCCURRENCES);

    return capResult({
      patient_id: profile.id,
      from,
      to,
      occurrences: entries.map((entry) => serializeEntry(entry, plan)),
    });
  },
};

const recordDoseAction: ToolDefinition = {
  name: 'record_dose_action',
  title: 'Record a dose action',
  description:
    'Save what happened to one dose slot after the person confirms it: taken, skipped, or another recorded state, with the actual time. Accepts the composite occurrence_id from list_dose_occurrences or a stored record id. Every change lands in the revision ledger.',
  inputSchema: {
    type: 'object',
    properties: {
      patient_id: { type: 'string' },
      occurrence_id: { type: 'string', maxLength: 200 },
      status: { type: 'string', enum: recordableStatuses },
      actual_at: { type: 'string' },
      reason: { type: 'string', maxLength: 500 },
      notes: { type: 'string', maxLength: 4000 },
    },
    required: ['patient_id', 'occurrence_id', 'status'],
    additionalProperties: false,
  },
  writes: true,
  writeCapability: 'claims',
  idempotent: true,
  handler: async (ctx, args) => {
    const profile = await requirePatient(ctx, args.patient_id);
    const status = typeof args.status === 'string' && isDoseStatus(args.status) ? args.status : null;
    if (!status || status === 'planned') throw new ToolError('status is invalid');

    const requestedActualAt =
      args.actual_at === undefined ? null : isoInstant(args.actual_at, 'actual_at');
    const reasonProvided = Object.prototype.hasOwnProperty.call(args, 'reason');
    const notesProvided = Object.prototype.hasOwnProperty.call(args, 'notes');
    const reason = typeof args.reason === 'string' ? args.reason.trim().slice(0, 500) || null : null;
    const notes = typeof args.notes === 'string' ? args.notes.trim().slice(0, 4000) || null : null;
    const occurrenceId = typeof args.occurrence_id === 'string' ? args.occurrence_id.trim() : '';
    const origin = { kind: 'mcp', provider: `mcp:${ctx.clientId}` };

    // A correction keeps the recorded time and free-text fields unless the
    // call names them; a call that changes nothing answers without writing,
    // so a retried ack stays one revision.
    const correctExistingDose = async (
      row: typeof doseOccurrence.$inferSelect,
      responseId: string,
    ) => {
      const current = normalizeDoseOccurrence(row);
      const nextActualAt = requestedActualAt ?? current.actualAt ?? new Date(ctx.now).toISOString();
      const nextReason = reasonProvided ? reason : current.reason;
      const nextNotes = notesProvided ? notes : current.notes;

      if (
        current.status === status &&
        current.actualAt === nextActualAt &&
        current.reason === nextReason &&
        current.notes === nextNotes
      ) {
        return { occurrence_id: responseId, status: current.status, record_revision: current.revision };
      }

      const saved = await updateDoseOccurrence({
        current: row,
        input: {
          status,
          actualAt: nextActualAt,
          actualValue: current.actualValue,
          actualUnit: current.actualUnit,
          actualText: current.actualText,
          route: current.route,
          site: current.site,
          reason: nextReason,
          reaction: current.reaction,
          notes: nextNotes,
        },
        expectedRevision: row.revision,
        source: origin,
      });
      return { occurrence_id: responseId, status: saved.status, record_revision: saved.revision };
    };

    const composite = COMPOSITE_ID.exec(occurrenceId);
    try {
      if (composite) {
        const [, regimenId, localDate, slotKeyRaw] = composite;
        const slotKey = Number(slotKeyRaw);
        const regimenRows = await db
          .select()
          .from(doseRegimen)
          .where(and(eq(doseRegimen.id, regimenId), eq(doseRegimen.patientId, profile.id)));
        const regimen = regimenRows[0];
        if (!regimen) throw new ToolError('No such dose slot');

        const courseRows = await db
          .select()
          .from(medicineCourse)
          .where(and(eq(medicineCourse.id, regimen.courseId), eq(medicineCourse.patientId, profile.id)));
        const course = courseRows[0];
        if (!course) throw new ToolError('No such dose slot');

        const existing = await db
          .select()
          .from(doseOccurrence)
          .where(
            and(
              eq(doseOccurrence.patientId, profile.id),
              eq(doseOccurrence.regimenId, regimenId),
              eq(doseOccurrence.localDate, localDate),
              eq(doseOccurrence.slotKey, slotKey),
            ),
          );

        if (existing[0]) {
          return await correctExistingDose(existing[0], occurrenceId);
        }

        const saved = await recordPlannedDose({
          course,
          regimen,
          localDate,
          slotKey,
          input: {
            status,
            actualAt: requestedActualAt ?? new Date(ctx.now).toISOString(),
            actualValue: null,
            actualUnit: null,
            actualText: null,
            route: null,
            site: null,
            reason,
            reaction: null,
            notes,
          },
          origin,
        });
        return { occurrence_id: occurrenceId, status: saved.status, record_revision: saved.revision };
      }

      const rows = await db
        .select()
        .from(doseOccurrence)
        .where(and(eq(doseOccurrence.id, occurrenceId), eq(doseOccurrence.patientId, profile.id)));
      if (!rows[0]) throw new ToolError('No such dose record');

      return await correctExistingDose(rows[0], rows[0].id);
    } catch (error) {
      if (error instanceof UnknownDoseSlotError) {
        throw new ToolError('The regimen does not plan this dose slot');
      }
      if (error instanceof StaleClaimRevisionError) {
        throw new ToolError('The dose record changed while saving; read it again and retry');
      }
      throw error;
    }
  },
};

const recordDoseDeliveries: ToolDefinition = {
  name: 'record_dose_deliveries',
  title: 'Record reminder deliveries',
  description:
    'Store delivery receipts for reminders that were actually sent, one batch per sweep. A repeated receipt with the same occurrence, time, and channel is ignored, so a retry is safe. Receipts record delivery only; they never change a dose record.',
  inputSchema: {
    type: 'object',
    properties: {
      patient_id: { type: 'string' },
      deliveries: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_DELIVERIES,
        items: {
          type: 'object',
          properties: {
            occurrence_id: { type: 'string', maxLength: 200 },
            delivered_at: { type: 'string' },
            channel: { type: 'string', maxLength: 64 },
          },
          required: ['occurrence_id', 'delivered_at', 'channel'],
          additionalProperties: false,
        },
      },
    },
    required: ['patient_id', 'deliveries'],
    additionalProperties: false,
  },
  writes: true,
  writeCapability: 'claims',
  idempotent: true,
  handler: async (ctx, args) => {
    const profile = await requirePatient(ctx, args.patient_id);
    if (!Array.isArray(args.deliveries) || args.deliveries.length === 0) {
      throw new ToolError('deliveries must be a non-empty array');
    }
    if (args.deliveries.length > MAX_DELIVERIES) {
      throw new ToolError(`deliveries may hold at most ${MAX_DELIVERIES} receipts`);
    }

    const values = args.deliveries.map((entry: unknown) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new ToolError('Each delivery must be an object');
      }
      const candidate = entry as Record<string, unknown>;
      const occurrenceRef =
        typeof candidate.occurrence_id === 'string' ? candidate.occurrence_id.trim() : '';
      if (!occurrenceRef || occurrenceRef.length > 200) {
        throw new ToolError('occurrence_id must contain 1 to 200 characters');
      }
      const channel = typeof candidate.channel === 'string' ? candidate.channel.trim() : '';
      if (!channel || channel.length > 64) {
        throw new ToolError('channel must contain 1 to 64 characters');
      }

      return {
        patientId: profile.id,
        occurrenceRef,
        deliveredAt: isoInstant(candidate.delivered_at, 'delivered_at'),
        channel,
        provider: `mcp:${ctx.clientId}`,
      };
    });

    // Every receipt names a dose of this profile: a composite ref must match
    // one of its regimens, a bare id one of its stored records.
    const compositeRegimenIds = new Set<string>();
    const bareIds = new Set<string>();
    for (const value of values) {
      const composite = COMPOSITE_ID.exec(value.occurrenceRef);
      if (composite) compositeRegimenIds.add(composite[1]);
      else bareIds.add(value.occurrenceRef);
    }
    if (compositeRegimenIds.size > 0) {
      const known = await db
        .select({ id: doseRegimen.id })
        .from(doseRegimen)
        .where(
          and(
            eq(doseRegimen.patientId, profile.id),
            inArray(doseRegimen.id, [...compositeRegimenIds]),
          ),
        );
      if (known.length !== compositeRegimenIds.size) {
        throw new ToolError('A receipt names a dose slot this profile does not have');
      }
    }
    if (bareIds.size > 0) {
      const known = await db
        .select({ id: doseOccurrence.id })
        .from(doseOccurrence)
        .where(
          and(eq(doseOccurrence.patientId, profile.id), inArray(doseOccurrence.id, [...bareIds])),
        );
      if (known.length !== bareIds.size) {
        throw new ToolError('A receipt names a dose record this profile does not have');
      }
    }

    const inserted = await db
      .insert(doseDelivery)
      .values(values)
      .onConflictDoNothing()
      .returning({ id: doseDelivery.id });

    return {
      patient_id: profile.id,
      recorded: inserted.length,
      duplicates: values.length - inserted.length,
    };
  },
};

export const doseTools: ToolDefinition[] = [
  listDoseOccurrences,
  recordDoseAction,
  recordDoseDeliveries,
];
