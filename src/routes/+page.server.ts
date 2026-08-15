import { db } from '$lib/server/db';
import {
  claimRevision,
  energyClaim,
  energySource,
  medicineClaim,
  patient,
  report,
  record,
} from '$lib/server/db/schema';
import { eq, desc, inArray, and } from 'drizzle-orm';
import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { normalizeComparableMeasurement } from '$lib/metrics/normalization';
import { saveReviewedReport } from '$lib/server/report-review';
import {
  deleteMeasurementSession,
  InvalidMeasurementsError,
  parseMeasuredAt,
  saveMeasurementSession,
} from '$lib/server/measurements';
import { isMeasurementKind } from '$lib/report-kind';
import { deleteImportedSessions, importMeasurementSessions } from '$lib/server/measurement-import';
import {
  getOwnedLabReport,
  getOwnedEnergyClaim,
  getOwnedMedicineClaim,
  getOwnedPatient,
  getOwnedRecord,
  getOwnedReport,
  requireUserId,
} from '$lib/server/ownership';
import { InvalidMedicineInputError, parseMedicineInput } from '$lib/server/medicines';
import { isMedicineStatus, type MedicineClaimRecord } from '$lib/medicine';
import { normalizeTimeZone } from '$lib/time-zone';
import { InvalidReportTimeError, resolveReportTime } from '$lib/server/report-time';
import { InvalidEnergyInputError, parseEnergyInput, validateEnergyEntry } from '$lib/server/energy';
import {
  EnergyPhotoError,
  storeEnergyPhoto,
  toEnergySourceRecord,
  validateEnergyPhoto,
} from '$lib/server/energy-source-storage';
import {
  isEnergyDirection,
  isEnergyStatus,
  type EnergyClaimRecord,
} from '$lib/energy';
import {
  claimRevisionValues,
  parseExpectedClaimRevision,
  StaleClaimRevisionError,
  toEnergyClaimRevision,
  toMedicineClaimRevision,
} from '$lib/server/claim-revisions';

const manualRevisionSource = { kind: 'manual', provider: 'local' } as const;

function parseJsonLike(value: unknown) {
  if (!value) return {} as Record<string, unknown>;
  if (typeof value === 'object') return value as Record<string, unknown>;

  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return {} as Record<string, unknown>;
    }
  }

  return {} as Record<string, unknown>;
}

function storedReportSourceKey(value: unknown, patientId: string) {
  const source = parseJsonLike(value);
  const key = typeof source.key === 'string' ? source.key : '';
  const match = /^report-sources\/([^/]+)\/[^/]+$/.exec(key);

  return match?.[1] === patientId ? key : null;
}

function normalizeMedicineClaim(value: typeof medicineClaim.$inferSelect): MedicineClaimRecord {
  return {
    ...value,
    status: isMedicineStatus(value.status) ? value.status : 'active',
  };
}

function normalizeEnergyClaim(value: typeof energyClaim.$inferSelect): EnergyClaimRecord {
  return {
    ...value,
    direction: isEnergyDirection(value.direction) ? value.direction : 'intake',
    status: isEnergyStatus(value.status) ? value.status : 'draft',
  };
}

function normalizeMetricMatchKey(value: unknown) {
  if (typeof value !== 'string') return '';

  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const load: PageServerLoad = async ({ url, locals }) => {
  if (!locals.user) {
    return {
      user: locals.user,
      session: locals.session,
      patients: [],
      currentPatient: null,
      records: [],
      reports: [],
      medicines: [],
      energyEntries: [],
      energySources: [],
      claimRevisions: [],
    };
  }

  const userId = requireUserId(locals);
  const selectedPatientId = url.searchParams.get('patientId');

  const patients = await db
    .select()
    .from(patient)
    .where(eq(patient.ownerUserId, userId))
    .orderBy(desc(patient.id));

  let currentPatient = null;
  let recordsList: typeof record.$inferSelect[] = [];
  let reportsList: typeof report.$inferSelect[] = [];
  let medicinesList: typeof medicineClaim.$inferSelect[] = [];
  let energyEntriesList: typeof energyClaim.$inferSelect[] = [];
  let energySourcesList: typeof energySource.$inferSelect[] = [];
  let claimRevisionsList: typeof claimRevision.$inferSelect[] = [];

  if (patients.length > 0) {
    const targetId = selectedPatientId || patients[0].id;
    currentPatient = patients.find(p => p.id === targetId) || patients[0];

    [
      recordsList,
      reportsList,
      medicinesList,
      energyEntriesList,
      energySourcesList,
      claimRevisionsList,
    ] = await Promise.all([
      db
        .select()
        .from(record)
        .where(eq(record.patientId, currentPatient.id))
        .orderBy(desc(record.id)),
      db
        .select()
        .from(report)
        .where(eq(report.patientId, currentPatient.id))
        .orderBy(desc(report.testDate)),
      db
        .select()
        .from(medicineClaim)
        .where(eq(medicineClaim.patientId, currentPatient.id))
        .orderBy(desc(medicineClaim.updatedAt)),
      db
        .select()
        .from(energyClaim)
        .where(eq(energyClaim.patientId, currentPatient.id))
        .orderBy(desc(energyClaim.occurredAt)),
      db
        .select()
        .from(energySource)
        .where(eq(energySource.patientId, currentPatient.id))
        .orderBy(desc(energySource.createdAt)),
      db
        .select()
        .from(claimRevision)
        .where(eq(claimRevision.patientId, currentPatient.id))
        .orderBy(desc(claimRevision.changedAt)),
    ]);
  }

  const claimRevisions = claimRevisionsList.flatMap((revision) => {
    const normalized =
      revision.claimKind === 'medicine'
        ? toMedicineClaimRevision(revision)
        : toEnergyClaimRevision(revision);

    return normalized ? [normalized] : [];
  });

  return {
    user: locals.user,
    session: locals.session,
    patients,
    currentPatient,
    records: recordsList,
    reports: reportsList,
    medicines: medicinesList.map(normalizeMedicineClaim),
    energyEntries: energyEntriesList.map(normalizeEnergyClaim),
    energySources: energySourcesList.map(toEnergySourceRecord),
    claimRevisions,
  };
};

export const actions: Actions = {
  createPatient: async ({ request, locals }) => {
    const userId = requireUserId(locals);
    const data = await request.formData();
    const name = data.get('name')?.toString();
    const agab = data.get('agab')?.toString();
    const birthday = data.get('birthday')?.toString();
    const timeZone = normalizeTimeZone(data.get('timeZone')?.toString());

    if (!name) return fail(400, { error: 'Name is required' });

    const newPatient = await db.insert(patient).values({
      ownerUserId: userId,
      name,
      agab,
      birthday,
      extraData: JSON.stringify({ timeZone }),
    }).returning();

    return { success: true, patient: newPatient[0] };
  },

  createMedicine: async ({ request, locals }) => {
    const userId = requireUserId(locals);
    const data = await request.formData();
    const patientId = data.get('patientId')?.toString();

    if (!patientId) return fail(400, { code: 'medicine_missing_patient' });

    const ownedPatient = await getOwnedPatient(userId, patientId);
    if (!ownedPatient) return fail(404, { code: 'medicine_patient_not_found' });

    try {
      const input = parseMedicineInput(data);
      const medicine = await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(medicineClaim)
          .values({
            patientId: ownedPatient.id,
            ...input,
            originKind: 'manual',
            originProvider: 'local',
          })
          .returning();
        const snapshot = normalizeMedicineClaim(inserted[0]);

        await tx
          .insert(claimRevision)
          .values(claimRevisionValues('medicine', snapshot, manualRevisionSource));

        return snapshot;
      });

      return { success: true, medicine };
    } catch (error) {
      if (error instanceof InvalidMedicineInputError) {
        return fail(400, { code: `medicine_${error.code}` });
      }

      throw error;
    }
  },

  updateMedicine: async ({ request, locals }) => {
    const userId = requireUserId(locals);
    const data = await request.formData();
    const id = data.get('id')?.toString();
    const expectedRevision = parseExpectedClaimRevision(data.get('revision'));

    if (!id) return fail(400, { code: 'medicine_missing_id' });
    if (expectedRevision === null) return fail(400, { code: 'medicine_invalid_revision' });

    const current = await getOwnedMedicineClaim(userId, id);
    if (!current) return fail(404, { code: 'medicine_not_found' });
    if (current.revision !== expectedRevision) {
      return fail(409, { code: 'medicine_stale_revision' });
    }

    try {
      const input = parseMedicineInput(data);
      const medicine = await db.transaction(async (tx) => {
        const currentSnapshot = normalizeMedicineClaim(current);
        await tx
          .insert(claimRevision)
          .values(claimRevisionValues('medicine', currentSnapshot, manualRevisionSource))
          .onConflictDoNothing();

        const updated = await tx
          .update(medicineClaim)
          .set({
            ...input,
            revision: expectedRevision + 1,
            updatedAt: new Date().toISOString(),
          })
          .where(
            and(
              eq(medicineClaim.id, current.id),
              eq(medicineClaim.patientId, current.patientId),
              eq(medicineClaim.revision, expectedRevision),
            ),
          )
          .returning();

        if (!updated[0]) throw new StaleClaimRevisionError();

        const snapshot = normalizeMedicineClaim(updated[0]);
        await tx
          .insert(claimRevision)
          .values(claimRevisionValues('medicine', snapshot, manualRevisionSource));

        return snapshot;
      });

      return { success: true, medicine };
    } catch (error) {
      if (error instanceof InvalidMedicineInputError) {
        return fail(400, { code: `medicine_${error.code}` });
      }

      if (error instanceof StaleClaimRevisionError) {
        return fail(409, { code: 'medicine_stale_revision' });
      }

      throw error;
    }
  },

  deleteMedicine: async ({ request, locals }) => {
    const userId = requireUserId(locals);
    const data = await request.formData();
    const id = data.get('id')?.toString();

    if (!id) return fail(400, { code: 'medicine_missing_id' });

    const current = await getOwnedMedicineClaim(userId, id);
    if (!current) return fail(404, { code: 'medicine_not_found' });

    await db.transaction(async (tx) => {
      await tx
        .delete(claimRevision)
        .where(
          and(
            eq(claimRevision.patientId, current.patientId),
            eq(claimRevision.claimKind, 'medicine'),
            eq(claimRevision.claimId, current.id),
          ),
        );
      await tx
        .delete(medicineClaim)
        .where(and(eq(medicineClaim.id, current.id), eq(medicineClaim.patientId, current.patientId)));
    });
    return { success: true };
  },

  createEnergyEntry: async ({ request, locals, platform }) => {
    const userId = requireUserId(locals);
    const data = await request.formData();
    const patientId = data.get('patientId')?.toString();

    if (!patientId) return fail(400, { code: 'energy_missing_patient' });

    const ownedPatient = await getOwnedPatient(userId, patientId);
    if (!ownedPatient) return fail(404, { code: 'energy_patient_not_found' });

    let storedPhoto: Awaited<ReturnType<typeof storeEnergyPhoto>> | null = null;
    const entryId = crypto.randomUUID();

    try {
      const input = parseEnergyInput(data);
      const photoValue = data.get('photo');
      const photo = validateEnergyPhoto(photoValue instanceof File ? photoValue : null);
      validateEnergyEntry(input, Boolean(photo));

      if (photo) {
        storedPhoto = await storeEnergyPhoto({
          bucket: platform?.env.REPORT_SOURCES,
          patientId: ownedPatient.id,
          energyClaimId: entryId,
          ...photo,
        });
      }

      const entry = await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(energyClaim)
          .values({
            id: entryId,
            patientId: ownedPatient.id,
            ...input,
            originKind: 'manual',
            originProvider: 'local',
          })
          .returning();
        const snapshot = normalizeEnergyClaim(inserted[0]);

        await tx
          .insert(claimRevision)
          .values(claimRevisionValues('energy', snapshot, manualRevisionSource));

        if (storedPhoto) await tx.insert(energySource).values(storedPhoto);
        return snapshot;
      });

      return { success: true, entry };
    } catch (error) {
      if (storedPhoto && platform?.env.REPORT_SOURCES) {
        await platform.env.REPORT_SOURCES.delete(storedPhoto.storageKey);
      }

      if (error instanceof InvalidEnergyInputError || error instanceof EnergyPhotoError) {
        return fail(error instanceof EnergyPhotoError && error.code === 'source_storage_unavailable' ? 503 : 400, {
          code: `energy_${error.code}`,
        });
      }

      throw error;
    }
  },

  updateEnergyEntry: async ({ request, locals }) => {
    const userId = requireUserId(locals);
    const data = await request.formData();
    const id = data.get('id')?.toString();
    const expectedRevision = parseExpectedClaimRevision(data.get('revision'));

    if (!id) return fail(400, { code: 'energy_missing_id' });
    if (expectedRevision === null) return fail(400, { code: 'energy_invalid_revision' });

    const current = await getOwnedEnergyClaim(userId, id);
    if (!current) return fail(404, { code: 'energy_not_found' });
    if (current.revision !== expectedRevision) {
      return fail(409, { code: 'energy_stale_revision' });
    }

    try {
      const input = parseEnergyInput(data);
      const existingSource = await db
        .select({ id: energySource.id })
        .from(energySource)
        .where(eq(energySource.energyClaimId, current.id))
        .limit(1);
      validateEnergyEntry(input, existingSource.length > 0);

      const entry = await db.transaction(async (tx) => {
        const currentSnapshot = normalizeEnergyClaim(current);
        await tx
          .insert(claimRevision)
          .values(claimRevisionValues('energy', currentSnapshot, manualRevisionSource))
          .onConflictDoNothing();

        const updated = await tx
          .update(energyClaim)
          .set({
            ...input,
            revision: expectedRevision + 1,
            updatedAt: new Date().toISOString(),
          })
          .where(
            and(
              eq(energyClaim.id, current.id),
              eq(energyClaim.patientId, current.patientId),
              eq(energyClaim.revision, expectedRevision),
            ),
          )
          .returning();

        if (!updated[0]) throw new StaleClaimRevisionError();

        const snapshot = normalizeEnergyClaim(updated[0]);
        await tx
          .insert(claimRevision)
          .values(claimRevisionValues('energy', snapshot, manualRevisionSource));

        return snapshot;
      });

      return { success: true, entry };
    } catch (error) {
      if (error instanceof InvalidEnergyInputError) {
        return fail(400, { code: `energy_${error.code}` });
      }

      if (error instanceof StaleClaimRevisionError) {
        return fail(409, { code: 'energy_stale_revision' });
      }

      throw error;
    }
  },

  deleteEnergyEntry: async ({ request, locals, platform }) => {
    const userId = requireUserId(locals);
    const data = await request.formData();
    const id = data.get('id')?.toString();

    if (!id) return fail(400, { code: 'energy_missing_id' });

    const current = await getOwnedEnergyClaim(userId, id);
    if (!current) return fail(404, { code: 'energy_not_found' });

    const sources = await db
      .select({ storageKey: energySource.storageKey })
      .from(energySource)
      .where(eq(energySource.energyClaimId, current.id));

    if (sources.length > 0 && !platform?.env.REPORT_SOURCES) {
      return fail(503, { code: 'energy_source_storage_unavailable' });
    }

    if (platform?.env.REPORT_SOURCES) {
      await Promise.all(sources.map(({ storageKey }) => platform.env.REPORT_SOURCES.delete(storageKey)));
    }

    await db.transaction(async (tx) => {
      await tx
        .delete(claimRevision)
        .where(
          and(
            eq(claimRevision.patientId, current.patientId),
            eq(claimRevision.claimKind, 'energy'),
            eq(claimRevision.claimId, current.id),
          ),
        );
      await tx
        .delete(energyClaim)
        .where(and(eq(energyClaim.id, current.id), eq(energyClaim.patientId, current.patientId)));
    });
    return { success: true };
  },

  addManualRecord: async ({ request, locals }) => {
    const userId = requireUserId(locals);
    const data = await request.formData();
    const patientId = data.get('patientId')?.toString();
    const type = data.get('type')?.toString();
    const value = data.get('value')?.toString();
    const date = data.get('date')?.toString();
    const notes = data.get('notes')?.toString();
    const facilityName = data.get('facilityName')?.toString().trim();
    const timeZone = data.get('timeZone')?.toString();

    if (!patientId || !type || !value) return fail(400, { error: 'Missing required fields' });

    const ownedPatient = await getOwnedPatient(userId, patientId);

    if (!ownedPatient) return fail(404, { error: 'Patient not found' });

    let reportTime;
    try {
      reportTime = resolveReportTime(date, timeZone);
    } catch (error) {
      if (error instanceof InvalidReportTimeError) return fail(400, { code: 'invalid_report_time' });
      throw error;
    }

    const newReport = await db.insert(report).values({
      patientId: ownedPatient.id,
      testDate: reportTime.instant,
      extraData: JSON.stringify({
        facilityName: facilityName || null,
        timeZone: reportTime.timeZone,
      })
    }).returning();

    await db.insert(record).values({
      patientId: ownedPatient.id,
      reportId: newReport[0].id,
      metricName: type,
      value,
      status: 'Manual',
      extraData: JSON.stringify({ notes })
    });

    return { success: true };
  },

  addReport: async ({ request, locals }) => {
    const userId = requireUserId(locals);
    const data = await request.formData();
    const patientId = data.get('patientId')?.toString();
    const metricsStr = data.get('metrics')?.toString();
    const reportFacility = data.get('reportFacility')?.toString();
    const reportTestDate = data.get('reportTestDate')?.toString();
    const targetReportId = data.get('targetReportId')?.toString();
    const reportRawSource = data.get('reportRawSource')?.toString();
    const reportTimeZone = data.get('reportTimeZone')?.toString();

    if (!patientId || !metricsStr) return fail(400, { error: 'Missing inputs' });

    const ownedPatient = await getOwnedPatient(userId, patientId);

    if (!ownedPatient) return fail(404, { error: 'Patient not found' });

    if (targetReportId) {
      const ownedReport = await getOwnedLabReport(userId, targetReportId);
      if (!ownedReport || ownedReport.patientId !== ownedPatient.id) {
        return fail(404, { error: 'Report not found' });
      }
    }

    let result;
    try {
      result = await saveReviewedReport({
        patientId: ownedPatient.id,
        metricsStr,
        reportFacility,
        reportTestDate,
        reportTimeZone,
        targetReportId,
        reportRawSource,
        deletedRecordIdsStr: data.get('deletedRecordIds')?.toString()
      });
    } catch (error) {
      if (error instanceof InvalidReportTimeError) return fail(400, { code: 'invalid_report_time' });
      throw error;
    }

    return { success: true, ...result };
  },

  updateRecord: async ({ request, locals }) => {
    const userId = requireUserId(locals);
    const data = await request.formData();
    const id = data.get('id')?.toString();
    const metricName = data.get('metricName')?.toString().trim();
    const value = data.get('value')?.toString();
    const status = data.get('status')?.toString();

    if (!id || !metricName || !value) return fail(400, { error: 'Missing required fields' });

    const current = await getOwnedRecord(userId, id);

    if (!current) return fail(404, { error: 'Record not found' });

    const existingExtraData = parseJsonLike(current.extraData);
    const { category: _legacyCategory, ...extraDataWithoutLegacyCategory } = existingExtraData;
    const fallbackComparable = normalizeComparableMeasurement(value, current.unit, current.refRange);

    await db.update(record).set({
      metricName,
      value,
      status,
      extraData: JSON.stringify({
        ...extraDataWithoutLegacyCategory,
        parsedLabel: metricName,
        comparableValue: fallbackComparable.comparableValue,
        comparableUnit: fallbackComparable.comparableUnit,
        comparableReferenceRange: fallbackComparable.comparableReferenceRange
      })
    }).where(eq(record.id, id));

    return { success: true };
  },

  updateReport: async ({ request, locals }) => {
    const userId = requireUserId(locals);
    const data = await request.formData();
    const id = data.get('id')?.toString();
    const testDate = data.get('testDate')?.toString();
    const title = data.get('title')?.toString().trim();
    const facilityName = data.get('facilityName')?.toString().trim();
    const notes = data.get('notes')?.toString().trim();
    const timeZone = data.get('timeZone')?.toString();

    if (!id || !testDate) return fail(400, { error: 'Missing required fields' });

    const current = await getOwnedLabReport(userId, id);

    if (!current) return fail(404, { error: 'Report not found' });

    const existingExtraData = parseJsonLike(current.extraData);

    let reportTime;
    try {
      reportTime = resolveReportTime(testDate, timeZone);
    } catch (error) {
      if (error instanceof InvalidReportTimeError) return fail(400, { code: 'invalid_report_time' });
      throw error;
    }

    await db.update(report).set({
      testDate: reportTime.instant,
      extraData: JSON.stringify({
        ...existingExtraData,
        title: title || null,
        facilityName: facilityName || null,
        notes: notes || null,
        timeZone: reportTime.timeZone,
      })
    }).where(eq(report.id, id));

    return { success: true };
  },

  deleteReport: async ({ request, locals, platform }) => {
    const userId = requireUserId(locals);
    const data = await request.formData();
    const id = data.get('id')?.toString();

    if (!id) return fail(400, { error: 'Missing ID' });

    const current = await getOwnedReport(userId, id);

    if (!current) return fail(404, { error: 'Report not found' });

    const sourceKey = storedReportSourceKey(current.rawData, current.patientId);
    if (sourceKey && !platform?.env.REPORT_SOURCES) {
      return fail(503, { code: 'source_storage_unavailable' });
    }

    if (sourceKey && platform?.env.REPORT_SOURCES) {
      await platform.env.REPORT_SOURCES.delete(sourceKey);
    }

    await db.delete(record).where(eq(record.reportId, id));
    await db.delete(report).where(eq(report.id, id));

    return { success: true };
  },

  deletePatient: async ({ request, locals, platform }) => {
    const userId = requireUserId(locals);
    const data = await request.formData();
    const id = data.get('patientId')?.toString();

    if (!id) return fail(400, { error: 'Missing ID' });

    const current = await getOwnedPatient(userId, id);

    if (!current) return fail(404, { error: 'Patient not found' });

    const [energySourceKeys, reportSources] = await Promise.all([
      db
        .select({ storageKey: energySource.storageKey })
        .from(energySource)
        .where(eq(energySource.patientId, id)),
      db.select({ rawData: report.rawData }).from(report).where(eq(report.patientId, id)),
    ]);
    const storageKeys = [
      ...energySourceKeys.map(({ storageKey }) => storageKey),
      ...reportSources
        .map(({ rawData }) => storedReportSourceKey(rawData, id))
        .filter((key): key is string => Boolean(key)),
    ];

    if (storageKeys.length > 0 && !platform?.env.REPORT_SOURCES) {
      return fail(503, { code: 'source_storage_unavailable' });
    }

    if (platform?.env.REPORT_SOURCES) {
      await Promise.all([...new Set(storageKeys)].map((storageKey) => platform.env.REPORT_SOURCES.delete(storageKey)));
    }

    await db.delete(energyClaim).where(eq(energyClaim.patientId, id));
    await db.delete(medicineClaim).where(eq(medicineClaim.patientId, id));
    await db.delete(record).where(eq(record.patientId, id));
    await db.delete(report).where(eq(report.patientId, id));
    await db.delete(patient).where(eq(patient.id, id));

    return { success: true };
  },

  deleteRecord: async ({ request, locals }) => {
    const userId = requireUserId(locals);
    const data = await request.formData();
    const id = data.get('id')?.toString();

    if (!id) return fail(400, { error: 'Missing ID' });

    const current = await getOwnedRecord(userId, id);

    if (!current) return fail(404, { error: 'Record not found' });

    await db.delete(record).where(eq(record.id, id));

    return { success: true };
  },

  saveMeasurement: async ({ request, locals }) => {
    const userId = requireUserId(locals);
    const data = await request.formData();
    const patientId = data.get('patientId')?.toString();
    const entriesStr = data.get('entries')?.toString();
    const kind = data.get('kind')?.toString();

    if (!patientId || !entriesStr) return fail(400, { error: 'Missing required fields' });
    if (!isMeasurementKind(kind)) return fail(400, { error: 'Unknown measurement kind' });

    const ownedPatient = await getOwnedPatient(userId, patientId);

    if (!ownedPatient) return fail(404, { error: 'Patient not found' });

    let entries: unknown;

    try {
      entries = JSON.parse(entriesStr);
    } catch {
      return fail(400, { code: 'invalid_entries' });
    }

    if (!Array.isArray(entries) || entries.length === 0) {
      return fail(400, { code: 'invalid_entries' });
    }

    const measuredAt = parseMeasuredAt(data.get('measuredAt')?.toString());

    if (!measuredAt) {
      return fail(400, { code: 'invalid_date' });
    }

    const sessionId = data.get('sessionId')?.toString() || null;

    if (sessionId) {
      const ownedSession = await getOwnedReport(userId, sessionId);

      // Without the kind check a lab report id passed here would have its date
      // and notes rewritten and every record not named in this payload deleted.
      if (!ownedSession || ownedSession.patientId !== ownedPatient.id || ownedSession.kind !== kind) {
        return fail(404, { error: 'Measurement session not found' });
      }
    }

    try {
      const result = await saveMeasurementSession({
        kind,
        patientId: ownedPatient.id,
        sessionId,
        measuredAt,
        notes: data.get('notes')?.toString(),
        entries,
      });

      return { success: true, ...result };
    } catch (error) {
      if (error instanceof InvalidMeasurementsError) {
        return fail(400, { code: 'invalid_entries' });
      }

      throw error;
    }
  },

  importMeasurements: async ({ request, locals }) => {
    const userId = requireUserId(locals);
    const data = await request.formData();
    const patientId = data.get('patientId')?.toString();
    const source = data.get('source')?.toString();
    const sessionsStr = data.get('sessions')?.toString();

    if (!patientId || !sessionsStr) return fail(400, { error: 'Missing required fields' });
    if (source !== 'apple-health' && source !== 'health-tracker-export') {
      return fail(400, { error: 'Unknown import source' });
    }

    const ownedPatient = await getOwnedPatient(userId, patientId);

    if (!ownedPatient) return fail(404, { error: 'Patient not found' });

    let sessions: unknown;

    try {
      sessions = JSON.parse(sessionsStr);
    } catch {
      return fail(400, { error: 'Invalid import payload' });
    }

    if (!Array.isArray(sessions) || sessions.length === 0) {
      return fail(400, { error: 'Nothing to import' });
    }

    const result = await importMeasurementSessions({
      patientId: ownedPatient.id,
      source,
      sessions: sessions as never,
    });

    return { success: true, ...result };
  },

  removeImportedMeasurements: async ({ request, locals }) => {
    const userId = requireUserId(locals);
    const data = await request.formData();
    const patientId = data.get('patientId')?.toString();
    const source = data.get('source')?.toString();

    if (!patientId || source !== 'apple-health') return fail(400, { error: 'Missing required fields' });

    const ownedPatient = await getOwnedPatient(userId, patientId);

    if (!ownedPatient) return fail(404, { error: 'Patient not found' });

    const removed = await deleteImportedSessions(ownedPatient.id, source);

    return { success: true, removed };
  },

  deleteMeasurement: async ({ request, locals }) => {
    const userId = requireUserId(locals);
    const data = await request.formData();
    const sessionId = data.get('sessionId')?.toString();

    if (!sessionId) return fail(400, { error: 'Missing ID' });

    const ownedSession = await getOwnedReport(userId, sessionId);

    if (!ownedSession) return fail(404, { error: 'Measurement session not found' });

    const deleted = await deleteMeasurementSession(ownedSession.patientId, ownedSession.id);

    if (!deleted) return fail(404, { error: 'Measurement session not found' });

    return { success: true };
  },

  batchDeleteRecords: async ({ request, locals }) => {
    const userId = requireUserId(locals);
    const data = await request.formData();
    const idsStr = data.get('ids')?.toString();

    if (!idsStr) return fail(400, { error: 'Missing IDs' });

    try {
      const ids = JSON.parse(idsStr);
      if (!Array.isArray(ids) || ids.length === 0) {
        return fail(400, { error: 'Invalid IDs array' });
      }

      const ownedRecords = await Promise.all(ids.map((id) => getOwnedRecord(userId, String(id))));
      const ownedIds = ownedRecords.map((item) => item?.id).filter(Boolean) as string[];

      if (ownedIds.length === 0) {
        return fail(404, { error: 'No matching records found' });
      }

      await db.delete(record).where(inArray(record.id, ownedIds));
      return { success: true };
    } catch (e) {
      return fail(400, { error: 'Failed to process batch deletion' });
    }
  }
};
