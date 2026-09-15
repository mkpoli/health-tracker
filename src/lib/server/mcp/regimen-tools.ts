import { and, eq, inArray } from 'drizzle-orm';
import type { MedicineStatus } from '$lib/medicine';
import {
  activeCourseOf,
  courseStatuses,
  doseAnchorKinds,
  doseAnchorMeals,
  regimenRuleKinds,
  type CourseStatus,
  type DoseRegimenRecord,
  type DoseSlot,
  type MedicineCourseRecord,
} from '$lib/medicine-plan';
import {
  InvalidMedicinePlanInputError,
  parseDoseRegimenInput,
  parseMedicineCourseInput,
  type DoseRegimenInput,
} from '$lib/server/medicine-plan';
import { db } from '$lib/server/db';
import { doseRegimen, medicineCourse } from '$lib/server/db/schema';
import { normalizeMedicineClaim, type WriteTx } from '$lib/server/claim-mutations';
import { StaleClaimRevisionError } from '$lib/server/claim-revisions';
import {
  createDoseRegimen,
  createMedicineCourse,
  normalizeDoseRegimen,
  normalizeMedicineCourse,
  RegimenOverlapError,
  updateDoseRegimen,
  updateMedicineCourse,
} from '$lib/server/medicine-plan-mutations';
import { getOwnedDoseRegimen, getOwnedMedicineClaim } from '$lib/server/ownership';
import { timeZoneFromMetadata } from '$lib/time-zone';
import { REQUEST_ID_LIMIT, stableClaimId } from './claim-ids';
import { requirePatient, ToolError, type McpContext } from './context';
import type { ToolDefinition } from './tools';

const MAX_SLOTS = 12;

const slotProperties = {
  key: {
    type: ['integer', 'null'],
    minimum: 0,
    description:
      'Identity of a slot inside its regimen, from get_medicine_plan. Keep it when correcting a rule so recorded doses stay attached; a slot without one is new.',
  },
  label: {
    type: ['string', 'null'],
    maxLength: 120,
    description: 'How the person names the slot, e.g. 朝食後 or bedtime.',
  },
  anchor: {
    type: 'object',
    description:
      'What places the dose in the day, in the shape get_medicine_plan and list_dose_occurrences return. clock needs the slot’s time; meal names its meal; wake, meal and bedtime take offset_minutes and get no planned instant, because the day itself decides when they fall.',
    properties: {
      kind: { type: 'string', enum: doseAnchorKinds },
      meal: { type: ['string', 'null'], enum: [...doseAnchorMeals, null] },
      offset_minutes: { type: ['integer', 'null'], minimum: -1440, maximum: 1440 },
    },
    required: ['kind'],
    additionalProperties: false,
  },
  time: {
    type: ['string', 'null'],
    description: 'Local wall-clock time HH:MM for a clock anchor.',
  },
  amount_value: { type: ['number', 'null'], exclusiveMinimum: 0, maximum: 100_000 },
  amount_unit: { type: ['string', 'null'], maxLength: 40 },
} as const;

/** JSON schema for the regimen argument shared by the medicine tools. */
export const regimenSchema = {
  type: 'object',
  description:
    'The rule that says when doses fall. fixed_slots lists the slots of a day; interval repeats every interval_hours from anchor_at; as_needed plans nothing.',
  properties: {
    rule: { type: 'string', enum: regimenRuleKinds },
    slots: {
      type: 'array',
      maxItems: MAX_SLOTS,
      items: {
        type: 'object',
        properties: slotProperties,
        required: ['anchor'],
        additionalProperties: false,
      },
      description: 'Required for fixed_slots. An interval rule may carry one slot for its dose amount.',
    },
    days_of_week: {
      type: ['array', 'null'],
      items: { type: 'integer', minimum: 0, maximum: 6 },
      maxItems: 7,
      description: 'Days a fixed_slots rule applies, 0 = Sunday. Omit for every day.',
    },
    interval_hours: { type: ['number', 'null'], minimum: 1, maximum: 1080 },
    anchor_at: {
      type: ['string', 'null'],
      description: 'First dose of an interval rule: ISO timestamp with Z or offset, or a local YYYY-MM-DDTHH:MM in the regimen timezone.',
    },
    dose_text: {
      type: ['string', 'null'],
      maxLength: 200,
      description: 'The dose as written, e.g. 1錠 or 2 patches, when the slots carry no amount.',
    },
    route: { type: ['string', 'null'], maxLength: 120 },
    site: { type: ['string', 'null'], maxLength: 120 },
    timezone: {
      type: ['string', 'null'],
      description: 'IANA timezone the slots are read in. The profile timezone is the default.',
    },
    effective_from: {
      type: ['string', 'null'],
      description: 'First day the rule plans, YYYY-MM-DD. Defaults to the course start date.',
    },
    effective_to: { type: ['string', 'null'], description: 'Last day the rule plans, YYYY-MM-DD.' },
    remind_minutes_before: { type: ['integer', 'null'], minimum: 0, maximum: 1440 },
    notes: { type: ['string', 'null'], maxLength: 4000 },
  },
  required: ['rule'],
  additionalProperties: false,
} as const;

function owns(object: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function textOrEmpty(value: unknown) {
  return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
}

function slotForm(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ToolError('Each regimen slot must be an object');
  }
  const slot = raw as Record<string, unknown>;
  const anchor =
    slot.anchor && typeof slot.anchor === 'object' && !Array.isArray(slot.anchor)
      ? (slot.anchor as Record<string, unknown>)
      : null;
  if (!anchor) throw new ToolError('Each regimen slot needs an anchor object with its kind');
  return {
    key: slot.key ?? null,
    label: slot.label ?? null,
    anchorKind: anchor.kind ?? null,
    anchorMeal: anchor.meal ?? null,
    anchorOffsetMinutes: anchor.offset_minutes ?? null,
    time: slot.time ?? null,
    amountValue: slot.amount_value ?? null,
    amountUnit: slot.amount_unit ?? null,
  };
}

const planErrorText: Record<InvalidMedicinePlanInputError['code'], string> = {
  invalid_kind: 'course kind is not recognized',
  invalid_status: 'course status is not recognized',
  invalid_date: 'effective_from and effective_to must be calendar dates in YYYY-MM-DD form',
  invalid_time: 'a clock slot needs time as HH:MM and anchor_at must be a valid timestamp',
  invalid_timezone: 'timezone must be an IANA timezone',
  invalid_rule: 'rule or days_of_week is not recognized',
  invalid_slots: 'fixed_slots needs one to twelve slots, each with a recognized anchor (meal slots name their meal)',
  invalid_interval: 'an interval rule needs interval_hours from 1 through 1080 and anchor_at',
  invalid_amount: 'amount_value must be a positive number',
  invalid_window: 'effective_to must not fall before effective_from',
  field_too_long: 'a regimen text field is too long',
};

/**
 * Reads the regimen argument of a tool call into the plan input the web form
 * produces, so both paths validate the same way.
 */
export function parseRegimenArgs(
  raw: unknown,
  defaults: { timezone: string; effectiveFrom: string | null },
): DoseRegimenInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ToolError('regimen must be an object');
  }
  const args = raw as Record<string, unknown>;
  const data = new FormData();
  data.set('ruleKind', textOrEmpty(args.rule));
  data.set('timezone', textOrEmpty(args.timezone) || defaults.timezone);
  data.set('effectiveFrom', textOrEmpty(args.effective_from) || defaults.effectiveFrom || '');
  data.set('effectiveTo', textOrEmpty(args.effective_to));
  if (owns(args, 'slots')) {
    if (!Array.isArray(args.slots)) throw new ToolError('regimen.slots must be an array');
    data.set('slots', JSON.stringify(args.slots.map(slotForm)));
  }
  if (Array.isArray(args.days_of_week)) {
    for (const day of args.days_of_week) data.append('daysOfWeek', textOrEmpty(day));
  }
  data.set('intervalHours', textOrEmpty(args.interval_hours));
  data.set('anchorAt', textOrEmpty(args.anchor_at));
  data.set('doseText', textOrEmpty(args.dose_text));
  data.set('route', textOrEmpty(args.route));
  data.set('site', textOrEmpty(args.site));
  data.set('remindMinutesBefore', textOrEmpty(args.remind_minutes_before));
  data.set('notes', textOrEmpty(args.notes));

  try {
    return parseDoseRegimenInput(data);
  } catch (error) {
    if (error instanceof InvalidMedicinePlanInputError) {
      throw new ToolError(`Invalid regimen: ${planErrorText[error.code]}`);
    }
    throw error;
  }
}

/** The course a medicine claim's own status implies. */
export function courseStatusFor(status: MedicineStatus): CourseStatus {
  switch (status) {
    case 'planned':
      return 'planned';
    case 'paused':
      return 'held';
    case 'completed':
    case 'stopped':
      return 'ended';
    default:
      return 'active';
  }
}

function serializeSlot(slot: DoseSlot) {
  return {
    key: slot.key,
    label: slot.label,
    anchor: slot.anchorKind
      ? { kind: slot.anchorKind, meal: slot.anchorMeal, offset_minutes: slot.anchorOffsetMinutes }
      : null,
    time: slot.time,
    amount_value: slot.amountValue,
    amount_unit: slot.amountUnit,
  };
}

export function serializeCourse(course: MedicineCourseRecord) {
  return {
    course_id: course.id,
    medicine_id: course.medicineClaimId,
    kind: course.kind,
    status: course.status,
    previous_course_id: course.previousCourseId,
    start_date: course.startDate,
    end_date: course.endDate,
    end_reason: course.endReason,
    notes: course.notes,
    revision: course.revision,
    created_at: course.createdAt,
    updated_at: course.updatedAt,
  };
}

export function serializeRegimen(regimen: DoseRegimenRecord) {
  return {
    regimen_id: regimen.id,
    course_id: regimen.courseId,
    rule: regimen.ruleKind,
    slots: regimen.slots.map(serializeSlot),
    days_of_week: regimen.daysOfWeek,
    interval_hours: regimen.intervalHours,
    anchor_at: regimen.anchorAt,
    dose_text: regimen.doseText,
    route: regimen.route,
    site: regimen.site,
    timezone: regimen.timezone,
    effective_from: regimen.effectiveFrom,
    effective_to: regimen.effectiveTo,
    remind_minutes_before: regimen.remindMinutesBefore,
    notes: regimen.notes,
    revision: regimen.revision,
    created_at: regimen.createdAt,
    updated_at: regimen.updatedAt,
  };
}

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function requestId(value: unknown) {
  const normalized = text(value);
  if (!normalized || normalized.length > REQUEST_ID_LIMIT) {
    throw new ToolError(`request_id must be text of at most ${REQUEST_ID_LIMIT} characters`);
  }
  return normalized;
}

function positiveInteger(value: unknown, field: string) {
  if (!Number.isInteger(value) || Number(value) < 1) {
    throw new ToolError(`${field} must be a positive integer`);
  }
  return Number(value);
}

function mcpProvider(ctx: McpContext) {
  return `mcp:${ctx.clientId}`;
}

async function requireMedicine(ctx: McpContext, patientId: unknown, medicineId: unknown) {
  const profile = await requirePatient(ctx, patientId);
  const id = text(medicineId);
  if (!id) throw new ToolError('medicine_id is required');
  const stored = await getOwnedMedicineClaim(ctx.userId, id);
  if (!stored || stored.patientId !== profile.id) throw new ToolError('No such medicine claim');
  return { profile, medicine: normalizeMedicineClaim(stored) };
}

/** One medicine's courses and regimens, read through the caller's handle. */
async function loadPlan(reader: WriteTx | typeof db, patientId: string, medicineId: string) {
  const courseRows = await reader
    .select()
    .from(medicineCourse)
    .where(
      and(eq(medicineCourse.patientId, patientId), eq(medicineCourse.medicineClaimId, medicineId)),
    );
  const regimenRows = courseRows.length
    ? await reader
        .select()
        .from(doseRegimen)
        .where(
          and(
            eq(doseRegimen.patientId, patientId),
            inArray(
              doseRegimen.courseId,
              courseRows.map((row) => row.id),
            ),
          ),
        )
    : [];
  return {
    courseRows,
    courses: courseRows.map(normalizeMedicineCourse),
    regimens: regimenRows.map(normalizeDoseRegimen),
  };
}

function newestFirst(a: string, b: string) {
  return a < b ? 1 : a > b ? -1 : 0;
}

function serializePlan(plan: Awaited<ReturnType<typeof loadPlan>>) {
  return [...plan.courses]
    .sort((a, b) => newestFirst(a.startDate, b.startDate))
    .map((course) => ({
      ...serializeCourse(course),
      regimens: plan.regimens
        .filter((regimen) => regimen.courseId === course.id)
        .sort((a, b) => newestFirst(a.effectiveFrom, b.effectiveFrom))
        .map(serializeRegimen),
    }));
}

const getMedicinePlan: ToolDefinition = {
  name: 'get_medicine_plan',
  title: 'Read a medicine’s courses and regimens',
  description:
    'Every course of one medicine with the regimens that plan its doses, newest first. Read this before set_regimen, update_regimen or update_course: it carries the ids and revisions those calls need.',
  inputSchema: {
    type: 'object',
    properties: { patient_id: { type: 'string' }, medicine_id: { type: 'string' } },
    required: ['patient_id', 'medicine_id'],
    additionalProperties: false,
  },
  handler: async (ctx, args) => {
    const { profile, medicine } = await requireMedicine(ctx, args.patient_id, args.medicine_id);
    return { medicine_id: medicine.id, courses: serializePlan(await loadPlan(db, profile.id, medicine.id)) };
  },
};

const setRegimen: ToolDefinition = {
  name: 'set_regimen',
  title: 'Put a new dose rule on a medicine',
  description:
    'Start a new regimen on the medicine’s open course from regimen.effective_from; the rule in force until then keeps planning the days before it. A medicine with no course gets an initial one, and one whose course has ended gets a restart course. Use this when the dose plan changes; use update_regimen to correct a rule that was entered wrongly, including one that starts the same day. request_id makes retries safe within this connection and profile.',
  inputSchema: {
    type: 'object',
    properties: {
      patient_id: { type: 'string' },
      medicine_id: { type: 'string' },
      request_id: { type: 'string', minLength: 1, maxLength: REQUEST_ID_LIMIT },
      regimen: regimenSchema,
    },
    required: ['patient_id', 'medicine_id', 'request_id', 'regimen'],
    additionalProperties: false,
  },
  writes: true,
  writeCapability: 'claims',
  idempotent: true,
  handler: async (ctx, args) => {
    const { profile, medicine } = await requireMedicine(ctx, args.patient_id, args.medicine_id);
    const key = requestId(args.request_id);
    const regimenArgs = args.regimen as Record<string, unknown> | null;
    if (!regimenArgs || typeof regimenArgs !== 'object' || !text(regimenArgs.effective_from)) {
      throw new ToolError('regimen.effective_from is required: the day the new rule takes over');
    }
    const input = parseRegimenArgs(regimenArgs, {
      timezone: timeZoneFromMetadata(profile.extraData),
      effectiveFrom: null,
    });
    const origin = { kind: 'mcp', provider: mcpProvider(ctx), externalId: key };
    const ids = {
      regimen: await stableClaimId(ctx, profile.id, 'regimen', key),
      course: await stableClaimId(ctx, profile.id, 'regimen:course', key),
    };

    try {
      return await db.transaction(async (tx) => {
        const plan = await loadPlan(tx, profile.id, medicine.id);
        const replayed = plan.regimens.find((regimen) => regimen.id === ids.regimen);
        if (replayed) {
          const course = plan.courses.find((candidate) => candidate.id === replayed.courseId);
          if (!course) throw new ToolError('request_id was used for another medicine');
          return { created: false, course: serializeCourse(course), regimen: serializeRegimen(replayed) };
        }

        const current = activeCourseOf(plan.courses);
        // A rule on an ended course would plan nothing; a medicine taken again
        // after a stop gets a restart course, one never planned gets its first.
        const course =
          current && current.status !== 'ended'
            ? current
            : await createMedicineCourse({
                id: ids.course,
                patientId: profile.id,
                medicineClaimId: medicine.id,
                input: {
                  kind: current ? 'restart' : 'initial',
                  status:
                    medicine.status === 'planned' || medicine.status === 'paused'
                      ? courseStatusFor(medicine.status)
                      : 'active',
                  previousCourseId: current?.id ?? null,
                  startDate:
                    !current && medicine.startDate && medicine.startDate < input.effectiveFrom
                      ? medicine.startDate
                      : input.effectiveFrom,
                  endDate: null,
                  endReason: null,
                  notes: null,
                },
                origin,
                tx,
              });
        const regimen = await createDoseRegimen({
          id: ids.regimen,
          patientId: profile.id,
          courseId: course.id,
          input,
          origin,
          tx,
        });
        return { created: true, course: serializeCourse(course), regimen: serializeRegimen(regimen) };
      });
    } catch (error) {
      if (error instanceof RegimenOverlapError) {
        throw new ToolError(
          'Invalid regimen: a rule already starts on or after effective_from; correct it with update_regimen',
        );
      }
      throw error;
    }
  },
};

const updateRegimen: ToolDefinition = {
  name: 'update_regimen',
  title: 'Correct a dose rule in place',
  description:
    'Replace the fields of one regimen after the person confirms the correction. Send the whole rule; keep each slot’s key from get_medicine_plan so recorded doses stay attached. expected_revision prevents overwriting a newer edit.',
  inputSchema: {
    type: 'object',
    properties: {
      patient_id: { type: 'string' },
      regimen_id: { type: 'string' },
      expected_revision: { type: 'integer', minimum: 1 },
      regimen: regimenSchema,
    },
    required: ['patient_id', 'regimen_id', 'expected_revision', 'regimen'],
    additionalProperties: false,
  },
  writes: true,
  writeCapability: 'claims',
  idempotent: true,
  handler: async (ctx, args) => {
    const profile = await requirePatient(ctx, args.patient_id);
    const id = text(args.regimen_id);
    if (!id) throw new ToolError('regimen_id is required');
    const expectedRevision = positiveInteger(args.expected_revision, 'expected_revision');
    const stored = await getOwnedDoseRegimen(ctx.userId, id);
    if (!stored || stored.patientId !== profile.id) throw new ToolError('No such regimen');
    if (stored.revision !== expectedRevision) {
      throw new ToolError(`Revision conflict; current_revision is ${stored.revision}`);
    }

    const input = parseRegimenArgs(args.regimen, {
      timezone: stored.timezone,
      effectiveFrom: stored.effectiveFrom,
    });
    try {
      const regimen = await updateDoseRegimen({
        current: stored,
        input,
        expectedRevision,
        source: { kind: 'mcp', provider: mcpProvider(ctx) },
      });
      return { updated: true, regimen: serializeRegimen(regimen) };
    } catch (error) {
      if (error instanceof RegimenOverlapError) {
        throw new ToolError('Invalid regimen: the window overlaps another rule of the same course');
      }
      if (error instanceof StaleClaimRevisionError) {
        const latest = await getOwnedDoseRegimen(ctx.userId, id);
        throw new ToolError(`Revision conflict; current_revision is ${latest?.revision ?? 'unknown'}`);
      }
      throw error;
    }
  },
};

const courseErrorText: Record<InvalidMedicinePlanInputError['code'], string> = {
  ...planErrorText,
  invalid_date: 'start_date and end_date must be calendar dates in YYYY-MM-DD form',
  invalid_window: 'end_date must not fall before start_date',
  field_too_long: 'end_reason or notes is too long',
};

const updateCourse: ToolDefinition = {
  name: 'update_course',
  title: 'Change a course’s status or dates',
  description:
    'Set the status and dates of one course after the person confirms it: ended with end_date closes it so no dose is planned past that day; active starts a planned or held one; held pauses it. Fields left out keep their value. The catalog entry keeps its own status — call update_medicine when it should read stopped or completed. course_id and expected_revision come from get_medicine_plan.',
  inputSchema: {
    type: 'object',
    properties: {
      patient_id: { type: 'string' },
      course_id: { type: 'string' },
      expected_revision: { type: 'integer', minimum: 1 },
      status: { type: 'string', enum: courseStatuses },
      start_date: { type: 'string', description: 'First day of the course, YYYY-MM-DD.' },
      end_date: { type: ['string', 'null'], description: 'Last day of the course, YYYY-MM-DD; required when status is ended.' },
      end_reason: { type: ['string', 'null'], maxLength: 500 },
      notes: { type: ['string', 'null'], maxLength: 4000 },
    },
    required: ['patient_id', 'course_id', 'expected_revision'],
    additionalProperties: false,
  },
  writes: true,
  writeCapability: 'claims',
  idempotent: true,
  handler: async (ctx, args) => {
    const profile = await requirePatient(ctx, args.patient_id);
    const id = text(args.course_id);
    if (!id) throw new ToolError('course_id is required');
    const expectedRevision = positiveInteger(args.expected_revision, 'expected_revision');
    const stored = (
      await db
        .select()
        .from(medicineCourse)
        .where(and(eq(medicineCourse.id, id), eq(medicineCourse.patientId, profile.id)))
    )[0];
    if (!stored) throw new ToolError('No such course');
    if (stored.revision !== expectedRevision) {
      throw new ToolError(`Revision conflict; current_revision is ${stored.revision}`);
    }
    if (!['status', 'start_date', 'end_date', 'end_reason', 'notes'].some((field) => field in args)) {
      throw new ToolError('Provide at least one course field to change');
    }

    const current = normalizeMedicineCourse(stored);
    const data = new FormData();
    data.set('kind', current.kind);
    data.set('status', textOrEmpty(args.status) || current.status);
    data.set('startDate', textOrEmpty(args.start_date) || current.startDate);
    data.set('endDate', 'end_date' in args ? textOrEmpty(args.end_date) : current.endDate ?? '');
    data.set('endReason', 'end_reason' in args ? textOrEmpty(args.end_reason) : current.endReason ?? '');
    data.set('notes', 'notes' in args ? textOrEmpty(args.notes) : current.notes ?? '');
    if (current.previousCourseId) data.set('previousCourseId', current.previousCourseId);

    let input;
    try {
      input = parseMedicineCourseInput(data);
    } catch (error) {
      if (error instanceof InvalidMedicinePlanInputError) {
        throw new ToolError(`Invalid course: ${courseErrorText[error.code]}`);
      }
      throw error;
    }
    // A course that ended without a date would plan doses forever.
    if (input.status === 'ended' && !input.endDate) {
      throw new ToolError('Invalid course: an ended course needs its end_date');
    }

    try {
      const course = await updateMedicineCourse({
        current: stored,
        input,
        expectedRevision,
        source: { kind: 'mcp', provider: mcpProvider(ctx) },
      });
      return { updated: true, course: serializeCourse(course) };
    } catch (error) {
      if (error instanceof StaleClaimRevisionError) {
        throw new ToolError('Revision conflict; read get_medicine_plan again');
      }
      throw error;
    }
  },
};

export const regimenTools: ToolDefinition[] = [getMedicinePlan, setRegimen, updateRegimen, updateCourse];
