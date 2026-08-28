import { and, eq } from 'drizzle-orm';
import {
  addDays,
  isCourseKind,
  isCourseStatus,
  isDoseStatus,
  isRegimenRuleKind,
  normalizeDaysOfWeek,
  normalizeDoseSlots,
  planDoses,
  type DoseOccurrenceRecord,
  type DoseRegimenRecord,
  type MedicineCourseRecord,
} from '$lib/medicine-plan';
import { db } from '$lib/server/db';
import { claimRevision, doseOccurrence, doseRegimen, medicineCourse } from '$lib/server/db/schema';
import type {
  DoseActionInput,
  DoseRegimenInput,
  MedicineCourseInput,
} from '$lib/server/medicine-plan';
import {
  claimRevisionValues,
  StaleClaimRevisionError,
  type ClaimRevisionSource,
} from '$lib/server/claim-revisions';
import type { ClaimOrigin } from '$lib/server/claim-mutations';

export function normalizeMedicineCourse(
  value: typeof medicineCourse.$inferSelect,
): MedicineCourseRecord {
  return {
    ...value,
    kind: isCourseKind(value.kind) ? value.kind : 'initial',
    status: isCourseStatus(value.status) ? value.status : 'active',
  };
}

export function normalizeDoseRegimen(value: typeof doseRegimen.$inferSelect): DoseRegimenRecord {
  return {
    ...value,
    ruleKind: isRegimenRuleKind(value.ruleKind) ? value.ruleKind : 'as_needed',
    slots: normalizeDoseSlots(value.slots),
    daysOfWeek: normalizeDaysOfWeek(value.daysOfWeek),
  };
}

export function normalizeDoseOccurrence(
  value: typeof doseOccurrence.$inferSelect,
): DoseOccurrenceRecord {
  return {
    ...value,
    status: isDoseStatus(value.status) ? value.status : 'unknown',
  };
}

export class RegimenOverlapError extends Error {
  constructor() {
    super('The edited window overlaps another regimen of the same course');
    this.name = 'RegimenOverlapError';
  }
}

export class UnknownDoseSlotError extends Error {
  constructor() {
    super('The regimen does not plan this dose slot');
    this.name = 'UnknownDoseSlotError';
  }
}

export async function createMedicineCourse(options: {
  patientId: string;
  medicineClaimId: string;
  input: MedicineCourseInput;
  origin: ClaimOrigin;
}) {
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(medicineCourse)
      .values({
        patientId: options.patientId,
        medicineClaimId: options.medicineClaimId,
        ...options.input,
        originKind: options.origin.kind,
        originProvider: options.origin.provider,
        originExternalId: options.origin.externalId ?? null,
      })
      .returning();

    const snapshot = normalizeMedicineCourse(inserted[0]);
    await tx
      .insert(claimRevision)
      .values(claimRevisionValues('medicine_course', snapshot, options.origin));

    return snapshot;
  });
}

export async function updateMedicineCourse(options: {
  current: typeof medicineCourse.$inferSelect;
  input: MedicineCourseInput;
  expectedRevision: number;
  source: ClaimRevisionSource;
}) {
  if (options.current.revision !== options.expectedRevision) {
    throw new StaleClaimRevisionError();
  }

  return db.transaction(async (tx) => {
    const currentSnapshot = normalizeMedicineCourse(options.current);
    await tx
      .insert(claimRevision)
      .values(claimRevisionValues('medicine_course', currentSnapshot, options.source))
      .onConflictDoNothing();

    const updated = await tx
      .update(medicineCourse)
      .set({
        ...options.input,
        revision: options.expectedRevision + 1,
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(medicineCourse.id, options.current.id),
          eq(medicineCourse.patientId, options.current.patientId),
          eq(medicineCourse.revision, options.expectedRevision),
        ),
      )
      .returning();

    if (!updated[0]) throw new StaleClaimRevisionError();

    const snapshot = normalizeMedicineCourse(updated[0]);
    await tx
      .insert(claimRevision)
      .values(claimRevisionValues('medicine_course', snapshot, options.source));

    return snapshot;
  });
}

export async function createDoseRegimen(options: {
  patientId: string;
  courseId: string;
  input: DoseRegimenInput;
  origin: ClaimOrigin;
}) {
  return db.transaction(async (tx) => {
    // A new rule closes the open one the day before it takes effect, so at
    // most one regimen plans any given day. A rule already scheduled to start
    // later stays scheduled; the new rule ends the day before it instead.
    const open = await tx
      .select()
      .from(doseRegimen)
      .where(
        and(eq(doseRegimen.courseId, options.courseId), eq(doseRegimen.patientId, options.patientId)),
      );

    const input = { ...options.input };
    for (const existing of open) {
      if (existing.effectiveTo && existing.effectiveTo < input.effectiveFrom) continue;

      if (existing.effectiveFrom > input.effectiveFrom) {
        const cappedTo = addDays(existing.effectiveFrom, -1);
        if (!input.effectiveTo || input.effectiveTo > cappedTo) input.effectiveTo = cappedTo;
        if (input.effectiveTo < input.effectiveFrom) throw new RegimenOverlapError();
        continue;
      }

      // planDoses treats effectiveTo as inclusive; the old rule's last day is
      // the day before the new rule starts.
      const closedTo = addDays(input.effectiveFrom, -1);
      const snapshotBefore = normalizeDoseRegimen(existing);
      await tx
        .insert(claimRevision)
        .values(claimRevisionValues('dose_regimen', snapshotBefore, options.origin))
        .onConflictDoNothing();

      const closed = await tx
        .update(doseRegimen)
        .set({
          effectiveTo: closedTo,
          revision: existing.revision + 1,
          updatedAt: new Date().toISOString(),
        })
        .where(and(eq(doseRegimen.id, existing.id), eq(doseRegimen.revision, existing.revision)))
        .returning();

      if (!closed[0]) throw new StaleClaimRevisionError();

      await tx
        .insert(claimRevision)
        .values(claimRevisionValues('dose_regimen', normalizeDoseRegimen(closed[0]), options.origin));
    }

    const inserted = await tx
      .insert(doseRegimen)
      .values({
        patientId: options.patientId,
        courseId: options.courseId,
        ...input,
        originKind: options.origin.kind,
        originProvider: options.origin.provider,
        originExternalId: options.origin.externalId ?? null,
      })
      .returning();

    const snapshot = normalizeDoseRegimen(inserted[0]);
    await tx
      .insert(claimRevision)
      .values(claimRevisionValues('dose_regimen', snapshot, options.origin));

    return snapshot;
  });
}

export async function updateDoseRegimen(options: {
  current: typeof doseRegimen.$inferSelect;
  input: DoseRegimenInput;
  expectedRevision: number;
  source: ClaimRevisionSource;
}) {
  if (options.current.revision !== options.expectedRevision) {
    throw new StaleClaimRevisionError();
  }

  return db.transaction(async (tx) => {
    // An edited window must not reopen this rule over a sibling: at most one
    // regimen plans any given day of a course.
    const siblings = await tx
      .select({ id: doseRegimen.id, effectiveFrom: doseRegimen.effectiveFrom, effectiveTo: doseRegimen.effectiveTo })
      .from(doseRegimen)
      .where(
        and(
          eq(doseRegimen.courseId, options.current.courseId),
          eq(doseRegimen.patientId, options.current.patientId),
        ),
      );
    for (const sibling of siblings) {
      if (sibling.id === options.current.id) continue;
      const startsBeforeSiblingEnds =
        !sibling.effectiveTo || options.input.effectiveFrom <= sibling.effectiveTo;
      const siblingStartsBeforeEnd =
        !options.input.effectiveTo || sibling.effectiveFrom <= options.input.effectiveTo;
      if (startsBeforeSiblingEnds && siblingStartsBeforeEnd) throw new RegimenOverlapError();
    }

    const currentSnapshot = normalizeDoseRegimen(options.current);
    await tx
      .insert(claimRevision)
      .values(claimRevisionValues('dose_regimen', currentSnapshot, options.source))
      .onConflictDoNothing();

    const updated = await tx
      .update(doseRegimen)
      .set({
        ...options.input,
        revision: options.expectedRevision + 1,
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(doseRegimen.id, options.current.id),
          eq(doseRegimen.patientId, options.current.patientId),
          eq(doseRegimen.revision, options.expectedRevision),
        ),
      )
      .returning();

    if (!updated[0]) throw new StaleClaimRevisionError();

    const snapshot = normalizeDoseRegimen(updated[0]);
    await tx
      .insert(claimRevision)
      .values(claimRevisionValues('dose_regimen', snapshot, options.source));

    return snapshot;
  });
}

/**
 * Saves the record for a planned dose slot. The slot must come out of the
 * regimen's own plan for that date; the first record materializes the row and
 * a concurrent first record surfaces as a stale-revision conflict.
 */
export async function recordPlannedDose(options: {
  course: typeof medicineCourse.$inferSelect;
  regimen: typeof doseRegimen.$inferSelect;
  localDate: string;
  slotKey: number;
  input: DoseActionInput;
  origin: ClaimOrigin;
}) {
  const course = normalizeMedicineCourse(options.course);
  const regimen = normalizeDoseRegimen(options.regimen);
  const planned = planDoses(course, regimen, options.localDate, options.localDate).find(
    (dose) => dose.slotKey === options.slotKey,
  );

  if (!planned) throw new UnknownDoseSlotError();

  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(doseOccurrence)
      .values({
        patientId: regimen.patientId,
        courseId: course.id,
        regimenId: regimen.id,
        regimenRevision: regimen.revision,
        slotKey: options.slotKey,
        localDate: options.localDate,
        plannedAt: planned.plannedAt,
        timezone: regimen.timezone,
        ...options.input,
        originKind: options.origin.kind,
        originProvider: options.origin.provider,
        originExternalId: options.origin.externalId ?? null,
      })
      .onConflictDoNothing()
      .returning();

    if (!inserted[0]) throw new StaleClaimRevisionError();

    const snapshot = normalizeDoseOccurrence(inserted[0]);
    await tx
      .insert(claimRevision)
      .values(claimRevisionValues('dose_occurrence', snapshot, options.origin));

    return snapshot;
  });
}

/** Saves a dose taken outside any plan: an as-needed dose, or one the person
 * records against a course with no matching slot. */
export async function recordUnplannedDose(options: {
  course: typeof medicineCourse.$inferSelect;
  regimenId: string | null;
  localDate: string;
  timezone: string;
  input: DoseActionInput;
  origin: ClaimOrigin;
}) {
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(doseOccurrence)
      .values({
        patientId: options.course.patientId,
        courseId: options.course.id,
        regimenId: options.regimenId,
        regimenRevision: null,
        slotKey: null,
        localDate: options.localDate,
        plannedAt: null,
        timezone: options.timezone,
        ...options.input,
        originKind: options.origin.kind,
        originProvider: options.origin.provider,
        originExternalId: options.origin.externalId ?? null,
      })
      .returning();

    const snapshot = normalizeDoseOccurrence(inserted[0]);
    await tx
      .insert(claimRevision)
      .values(claimRevisionValues('dose_occurrence', snapshot, options.origin));

    return snapshot;
  });
}

export async function updateDoseOccurrence(options: {
  current: typeof doseOccurrence.$inferSelect;
  input: DoseActionInput;
  expectedRevision: number;
  source: ClaimRevisionSource;
}) {
  if (options.current.revision !== options.expectedRevision) {
    throw new StaleClaimRevisionError();
  }

  return db.transaction(async (tx) => {
    const currentSnapshot = normalizeDoseOccurrence(options.current);
    await tx
      .insert(claimRevision)
      .values(claimRevisionValues('dose_occurrence', currentSnapshot, options.source))
      .onConflictDoNothing();

    const updated = await tx
      .update(doseOccurrence)
      .set({
        ...options.input,
        revision: options.expectedRevision + 1,
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(doseOccurrence.id, options.current.id),
          eq(doseOccurrence.patientId, options.current.patientId),
          eq(doseOccurrence.revision, options.expectedRevision),
        ),
      )
      .returning();

    if (!updated[0]) throw new StaleClaimRevisionError();

    const snapshot = normalizeDoseOccurrence(updated[0]);
    await tx
      .insert(claimRevision)
      .values(claimRevisionValues('dose_occurrence', snapshot, options.source));

    return snapshot;
  });
}
