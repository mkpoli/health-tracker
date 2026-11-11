import { and, eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/libsql';
import type { Client } from '@libsql/client';
import { isDateOnly } from '$lib/medicine-plan';
import { db } from '$lib/server/db';
import * as schema from '$lib/server/db/schema';
import { claimRevision, doseRegimen, mcpWriteReceipt, medicineClaim, medicineCourse, patient } from '$lib/server/db/schema';
import { mcpGrant } from '$lib/server/db/mcp.schema';
import { normalizeMedicineClaim } from '$lib/server/claim-mutations';
import { claimRevisionValues } from '$lib/server/claim-revisions';
import { normalizeMedicineCourse } from '$lib/server/medicine-plan-mutations';
import { positiveInteger, requestId, mcpProvider } from './claim-tool-input';
import { serializeMedicine } from './medicine-serialization';
import { requirePatient, ToolError } from './context';
import { CLAIM_WRITE_SCOPE, READ_SCOPE, grantPatientIds } from './oauth';
import type { ToolDefinition } from './tools';
import { MAX_STOP_COURSES as MAX_COURSES, MAX_STOP_REGIMENS as MAX_REGIMENS } from './stop-medicine-limits';
const OPERATION = 'stop_medicine_courses';

function id(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200 || value !== value.trim()) {
    throw new ToolError(`${name} must be a nonempty identifier of at most 200 characters`);
  }
  return value;
}

function object(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ToolError('Invalid snapshot');
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some((key) => !fields.includes(key))) throw new ToolError('Unexpected snapshot field');
  return result;
}

function snapshot(value: unknown) {
  if (!Array.isArray(value) || value.length > MAX_COURSES) throw new ToolError(`expected_courses must contain at most ${MAX_COURSES} courses`);
  let total = 0;
  const seenCourses = new Set<string>();
  const seenRegimens = new Set<string>();
  const courses = value.map((raw) => {
    const item = object(raw, ['course_id', 'revision', 'regimens']);
    const courseId = id(item.course_id, 'course_id');
    if (seenCourses.has(courseId)) throw new ToolError('Duplicate course_id');
    seenCourses.add(courseId);
    if (!Array.isArray(item.regimens)) throw new ToolError('regimens must be an array');
    total += item.regimens.length;
    if (total > MAX_REGIMENS) throw new ToolError(`At most ${MAX_REGIMENS} regimens are allowed`);
    const regimens = item.regimens.map((rawRegimen) => {
      const regimen = object(rawRegimen, ['regimen_id', 'revision']);
      const regimenId = id(regimen.regimen_id, 'regimen_id');
      if (seenRegimens.has(regimenId)) throw new ToolError('Duplicate regimen_id');
      seenRegimens.add(regimenId);
      return { regimen_id: regimenId, revision: positiveInteger(regimen.revision, 'regimen revision') };
    }).sort((a, b) => a.regimen_id < b.regimen_id ? -1 : a.regimen_id > b.regimen_id ? 1 : 0);
    return { course_id: courseId, revision: positiveInteger(item.revision, 'course revision'), regimens };
  });
  return courses.sort((a, b) => a.course_id < b.course_id ? -1 : a.course_id > b.course_id ? 1 : 0);
}

async function hash(value: unknown) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export const stopMedicineCourses: ToolDefinition = {
  name: OPERATION,
  title: 'Stop medicine courses',
  description: 'Stop a confirmed medicine and its exact active course and regimen snapshot. Read get_medicine_stop_snapshot first. end_date is inclusive; repeat the same request_id and payload to recover the original receipt.',
  inputSchema: {
    type: 'object',
    properties: {
      patient_id: { type: 'string', minLength: 1, maxLength: 200 },
      medicine_id: { type: 'string', minLength: 1, maxLength: 200 },
      expected_medicine_revision: { type: 'integer', minimum: 1 },
      expected_courses: { type: 'array', maxItems: MAX_COURSES, items: {
        type: 'object', properties: {
          course_id: { type: 'string', minLength: 1, maxLength: 200 },
          revision: { type: 'integer', minimum: 1 },
          regimens: { type: 'array', maxItems: MAX_REGIMENS, items: {
            type: 'object', properties: { regimen_id: { type: 'string', minLength: 1, maxLength: 200 }, revision: { type: 'integer', minimum: 1 } },
            required: ['regimen_id', 'revision'], additionalProperties: false,
          } },
        }, required: ['course_id', 'revision', 'regimens'], additionalProperties: false,
      } },
      end_date: { type: 'string', description: 'Inclusive calendar date YYYY-MM-DD.' },
      request_id: { type: 'string', minLength: 1, maxLength: 128 },
    },
    required: ['patient_id', 'medicine_id', 'expected_medicine_revision', 'expected_courses', 'end_date', 'request_id'],
    additionalProperties: false,
  },
  writes: true,
  writeCapability: 'claims',
  idempotent: true,
  handler: async (ctx, args) => {
    if (!ctx.canWriteClaims) throw new ToolError('health:claims:write is required');
    if (!ctx.tokenClientId || ctx.tokenClientId !== ctx.clientId) throw new ToolError('This connection is no longer authorized for this profile');
    object(args, ['patient_id', 'medicine_id', 'expected_medicine_revision', 'expected_courses', 'end_date', 'request_id']);
    const patientId = id(args.patient_id, 'patient_id');
    const medicineId = id(args.medicine_id, 'medicine_id');
    const expectedRevision = positiveInteger(args.expected_medicine_revision, 'expected_medicine_revision');
    const expectedCourses = snapshot(args.expected_courses);
    const key = requestId(args.request_id);
    if (typeof args.end_date !== 'string' || !isDateOnly(args.end_date)) throw new ToolError('end_date must be a valid YYYY-MM-DD calendar date');
    const endDate = args.end_date;
    await requirePatient(ctx, patientId);
    const payloadHash = await hash({ patient_id: patientId, medicine_id: medicineId, expected_medicine_revision: expectedRevision, expected_courses: expectedCourses, end_date: endDate });
    const source = { kind: 'mcp', provider: mcpProvider(ctx) };
    const changedAt = new Date(ctx.now).toISOString();

    // The adapter batches through this transaction, not the parent client.
    // libsql's write mode begins with BEGIN IMMEDIATE before the first batch.
    const transaction = await db.$client.transaction('write');
    let committed = false;
    try {
      const tx = drizzle(transaction as unknown as Client, { schema });
      const activeWhere = and(eq(medicineCourse.medicineClaimId, medicineId), eq(medicineCourse.patientId, patientId), eq(medicineCourse.status, 'active'));
      const receiptKey = and(eq(mcpWriteReceipt.patientId, patientId), eq(mcpWriteReceipt.operation, OPERATION), eq(mcpWriteReceipt.requestId, key));
      const activeCourseIds = tx.select({ id: medicineCourse.id }).from(medicineCourse).where(activeWhere).limit(MAX_COURSES + 1);
      const [[grant], [owner], [previous]] = await tx.batch([
        tx.select({ ownerUserId: mcpGrant.ownerUserId, clientId: mcpGrant.clientId, revokedAt: mcpGrant.revokedAt, scope: mcpGrant.scope, patientIds: mcpGrant.patientIds }).from(mcpGrant).where(eq(mcpGrant.id, ctx.grant.id)).limit(1),
        tx.select({ id: patient.id }).from(patient).where(and(eq(patient.id, patientId), eq(patient.ownerUserId, ctx.userId))).limit(1),
        tx.select({ payloadHash: mcpWriteReceipt.payloadHash, receipt: sql<string>`${mcpWriteReceipt.receipt}` }).from(mcpWriteReceipt).where(receiptKey).limit(1),
      ]);
      const outcome = await (async () => {
      const scopes = grant?.scope.split(/\s+/) ?? [];
      if (!grant || grant.revokedAt || grant.ownerUserId !== ctx.userId || grant.clientId !== ctx.clientId || !scopes.includes(READ_SCOPE) || !scopes.includes(CLAIM_WRITE_SCOPE) || !grantPatientIds(grant).includes(patientId)) {
        throw new ToolError('This connection is no longer authorized for this profile');
      }
      if (!owner) throw new ToolError('No such patient');
      if (previous) {
        if (previous.payloadHash !== payloadHash) throw new ToolError('STOP_REQUEST_ID_MISMATCH: request_id already used with a different payload');
        return JSON.parse(previous.receipt) as { kind: 'success'; receipt: unknown } | { kind: 'error'; message: string };
      }
      const [[medicine], courses, regimens] = await tx.batch([
        tx.select().from(medicineClaim).where(and(eq(medicineClaim.id, medicineId), eq(medicineClaim.patientId, patientId))).limit(1),
        tx.select().from(medicineCourse).where(activeWhere).limit(MAX_COURSES + 1),
        tx.select({ id: doseRegimen.id, patientId: doseRegimen.patientId, courseId: doseRegimen.courseId, revision: doseRegimen.revision, effectiveTo: doseRegimen.effectiveTo }).from(doseRegimen).where(inArray(doseRegimen.courseId, activeCourseIds)).limit(MAX_REGIMENS + 1),
      ]);
      const reject = async (message: string) => {
        const result = { kind: 'error' as const, message: `STOP_REJECTED: ${message}` };
        await tx.insert(mcpWriteReceipt).values({ patientId, clientId: ctx.clientId, operation: OPERATION, requestId: key, payloadHash, receipt: result });
        return result;
      };
      if (!medicine) return reject('No such medicine claim');
      if (medicine.revision !== expectedRevision) return reject('Medicine revision conflict');
      if (medicine.startDate && endDate < medicine.startDate) return reject('end_date precedes medicine start_date');
      if (courses.length > MAX_COURSES) return reject('Active plan exceeds course limit');
      if (regimens.length > MAX_REGIMENS) return reject('Active plan exceeds regimen limit');
      if (regimens.some((regimen) => regimen.patientId !== patientId)) return reject('Medicine plan is inconsistent');
      const actual = snapshot(courses.map((course) => ({ course_id: course.id, revision: course.revision, regimens: regimens.filter((regimen) => regimen.courseId === course.id).map((regimen) => ({ regimen_id: regimen.id, revision: regimen.revision })) })));
      if (JSON.stringify(actual) !== JSON.stringify(expectedCourses)) return reject('Active plan snapshot conflict');
      const oldMedicine = normalizeMedicineClaim(medicine);
      const expectedMedicine = { ...medicine, status: 'stopped', endDate, revision: medicine.revision + 1, updatedAt: changedAt };
      const expectedCoursesAfter = courses.map((course) => ({
        ...course,
        status: course.startDate > endDate ? 'held' : 'ended',
        endDate: course.startDate > endDate ? course.endDate : course.endDate && course.endDate < endDate ? course.endDate : endDate,
        revision: course.revision + 1,
        updatedAt: changedAt,
      }));
      const updatedById = new Map(expectedCoursesAfter.map((course) => [course.id, course]));
      const stopped = [...courses].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map((course) => {
        const updated = updatedById.get(course.id)!;
        return { course_id: course.id, old_revision: course.revision, new_revision: updated.revision, old_status: course.status, new_status: updated.status, old_end_date: course.endDate, new_end_date: updated.endDate, regimens: regimens.filter((regimen) => regimen.courseId === course.id).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map((regimen) => ({ regimen_id: regimen.id, old_revision: regimen.revision, new_revision: regimen.revision, old_effective_to: regimen.effectiveTo, new_effective_to: regimen.effectiveTo })) };
      });
      const receipt = { request_id: key, medicine: serializeMedicine(normalizeMedicineClaim(expectedMedicine)), courses: stopped };
      const result = { kind: 'success' as const, receipt };
      const oldMedicineRevision = tx.insert(claimRevision).values(claimRevisionValues('medicine', oldMedicine, source)).onConflictDoNothing();
      const medicineUpdate = tx.update(medicineClaim).set({ status: 'stopped', endDate, revision: medicine.revision + 1, updatedAt: changedAt }).where(and(eq(medicineClaim.id, medicineId), eq(medicineClaim.patientId, patientId), eq(medicineClaim.revision, expectedRevision))).returning();
      const newMedicineRevision = tx.insert(claimRevision).values(claimRevisionValues('medicine', normalizeMedicineClaim(expectedMedicine), source));
      const receiptInsert = tx.insert(mcpWriteReceipt).values({ patientId, clientId: ctx.clientId, operation: OPERATION, requestId: key, payloadHash, receipt: result });
      let medicineRows: Array<typeof medicineClaim.$inferSelect>;
      let courseRows: Array<typeof medicineCourse.$inferSelect> = [];
      if (courses.length) {
        const oldCourseRevisions = tx.insert(claimRevision).values(courses.map((course) => claimRevisionValues('medicine_course', normalizeMedicineCourse(course), source))).onConflictDoNothing();
        const courseUpdate = tx.update(medicineCourse).set({
          status: sql`case when ${medicineCourse.startDate} > ${endDate} then 'held' else 'ended' end`,
          endDate: sql`case when ${medicineCourse.startDate} > ${endDate} then ${medicineCourse.endDate} when ${medicineCourse.endDate} is not null and ${medicineCourse.endDate} < ${endDate} then ${medicineCourse.endDate} else ${endDate} end`,
          revision: sql`${medicineCourse.revision} + 1`, updatedAt: changedAt,
        }).where(activeWhere).returning();
        const newCourseRevisions = tx.insert(claimRevision).values(expectedCoursesAfter.map((course) => claimRevisionValues('medicine_course', normalizeMedicineCourse(course), source)));
        [, medicineRows, , , courseRows] = await tx.batch([oldMedicineRevision, medicineUpdate, newMedicineRevision, oldCourseRevisions, courseUpdate, newCourseRevisions, receiptInsert]);
      } else {
        [, medicineRows] = await tx.batch([oldMedicineRevision, medicineUpdate, newMedicineRevision, receiptInsert]);
      }
      if (medicineRows.length !== 1 || JSON.stringify(serializeMedicine(normalizeMedicineClaim(medicineRows[0]))) !== JSON.stringify(receipt.medicine)) throw new ToolError('Medicine revision conflict');
      if (courseRows.length !== courses.length || courseRows.some((course) => JSON.stringify(normalizeMedicineCourse(course)) !== JSON.stringify(normalizeMedicineCourse(updatedById.get(course.id)!)))) throw new ToolError('Active plan snapshot conflict');
      return result;
      })();
      await transaction.commit();
      committed = true;
      if (outcome.kind === 'error') throw new ToolError(outcome.message);
      return outcome.receipt;
    } catch (error) {
      if (!committed && !transaction.closed) {
        try { await transaction.rollback(); } catch { /* Preserve the original failure. */ }
      }
      throw error;
    } finally {
      transaction.close();
    }
  },
};
