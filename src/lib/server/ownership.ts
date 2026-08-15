import { db } from '$lib/server/db';
import {
  dataImport,
  energyClaim,
  energySource,
  medicineClaim,
  medicineIngredient,
  medicineProduct,
  patient,
  record,
  report,
  workoutClaim,
} from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { isLabReport } from '$lib/report-kind';

export function requireUserId(locals: App.Locals) {
  const userId = locals.user?.sub;

  if (!userId) {
    throw new Error('Authenticated user is required');
  }

  return userId;
}

export async function getOwnedPatient(userId: string, patientId: string) {
  const rows = await db
    .select()
    .from(patient)
    .where(and(eq(patient.id, patientId), eq(patient.ownerUserId, userId)));

  return rows[0] || null;
}

export async function getOwnedReport(userId: string, reportId: string) {
  const rows = await db.select().from(report).where(eq(report.id, reportId));
  const currentReport = rows[0];

  if (!currentReport) return null;

  const ownedPatient = await getOwnedPatient(userId, currentReport.patientId);
  return ownedPatient ? currentReport : null;
}

/**
 * Clinical reports only. The lab review flow rewrites a report's metadata and
 * prunes its records, so a body measurement session must never be reachable
 * through it — the same restriction the body save path applies in reverse.
 */
export async function getOwnedLabReport(userId: string, reportId: string) {
  const currentReport = await getOwnedReport(userId, reportId);

  if (!currentReport || !isLabReport(currentReport)) return null;

  return currentReport;
}

export async function getOwnedRecord(userId: string, recordId: string) {
  const rows = await db.select().from(record).where(eq(record.id, recordId));
  const currentRecord = rows[0];

  if (!currentRecord) return null;

  const ownedPatient = await getOwnedPatient(userId, currentRecord.patientId);
  return ownedPatient ? currentRecord : null;
}

export async function getOwnedMedicineClaim(userId: string, medicineId: string) {
  const rows = await db.select().from(medicineClaim).where(eq(medicineClaim.id, medicineId));
  const currentMedicine = rows[0];

  if (!currentMedicine) return null;

  const ownedPatient = await getOwnedPatient(userId, currentMedicine.patientId);
  return ownedPatient ? currentMedicine : null;
}

export async function getOwnedMedicineIngredient(userId: string, ingredientId: string) {
  const rows = await db
    .select()
    .from(medicineIngredient)
    .where(eq(medicineIngredient.id, ingredientId));
  const currentIngredient = rows[0];
  if (!currentIngredient) return null;

  const ownedPatient = await getOwnedPatient(userId, currentIngredient.patientId);
  return ownedPatient ? currentIngredient : null;
}

export async function getOwnedMedicineProduct(userId: string, productId: string) {
  const rows = await db.select().from(medicineProduct).where(eq(medicineProduct.id, productId));
  const currentProduct = rows[0];
  if (!currentProduct) return null;

  const ownedPatient = await getOwnedPatient(userId, currentProduct.patientId);
  return ownedPatient ? currentProduct : null;
}

export async function getOwnedEnergyClaim(userId: string, energyClaimId: string) {
  const rows = await db.select().from(energyClaim).where(eq(energyClaim.id, energyClaimId));
  const currentClaim = rows[0];

  if (!currentClaim) return null;

  const ownedPatient = await getOwnedPatient(userId, currentClaim.patientId);
  return ownedPatient ? currentClaim : null;
}

export async function getOwnedEnergySource(userId: string, sourceId: string) {
  const rows = await db.select().from(energySource).where(eq(energySource.id, sourceId));
  const currentSource = rows[0];

  if (!currentSource) return null;

  const ownedClaim = await getOwnedEnergyClaim(userId, currentSource.energyClaimId);
  return ownedClaim?.patientId === currentSource.patientId ? currentSource : null;
}

export async function getOwnedDataImport(userId: string, importId: string) {
  const rows = await db.select().from(dataImport).where(eq(dataImport.id, importId));
  const currentImport = rows[0];

  if (!currentImport) return null;

  const ownedPatient = await getOwnedPatient(userId, currentImport.patientId);
  return ownedPatient ? currentImport : null;
}

export async function getOwnedWorkoutClaim(userId: string, workoutId: string) {
  const rows = await db.select().from(workoutClaim).where(eq(workoutClaim.id, workoutId));
  const currentWorkout = rows[0];

  if (!currentWorkout) return null;

  const ownedPatient = await getOwnedPatient(userId, currentWorkout.patientId);
  return ownedPatient ? currentWorkout : null;
}
