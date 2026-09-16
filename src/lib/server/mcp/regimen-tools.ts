import type { MedicineStatus } from '$lib/medicine';
import {
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
  type DoseRegimenInput,
} from '$lib/server/medicine-plan';
import { ToolError } from './context';

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
