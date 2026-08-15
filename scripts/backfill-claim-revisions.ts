import { createClient } from '@libsql/client';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const client = createClient({
  url: databaseUrl,
  authToken: process.env.DATABASE_AUTH_TOKEN,
});

const missingCountsSql = `
  SELECT
    (
      SELECT count(*)
      FROM medicine_claim AS claim
      LEFT JOIN claim_revision AS revision
        ON revision.claim_kind = 'medicine'
        AND revision.claim_id = claim.id
        AND revision.revision = claim.revision
      WHERE revision.id IS NULL
    ) AS medicine,
    (
      SELECT count(*)
      FROM energy_claim AS claim
      LEFT JOIN claim_revision AS revision
        ON revision.claim_kind = 'energy'
        AND revision.claim_id = claim.id
        AND revision.revision = claim.revision
      WHERE revision.id IS NULL
    ) AS energy
`;

const medicineBackfillSql = `
  INSERT OR IGNORE INTO claim_revision (
    id,
    patient_id,
    claim_kind,
    claim_id,
    revision,
    snapshot,
    changed_at,
    change_origin_kind,
    change_origin_provider
  )
  SELECT
    'medicine:' || id || ':' || revision,
    patient_id,
    'medicine',
    id,
    revision,
    json_object(
      'id', id,
      'patientId', patient_id,
      'name', name,
      'genericName', generic_name,
      'form', form,
      'strength', strength,
      'route', route,
      'schedule', schedule,
      'status', status,
      'startDate', start_date,
      'endDate', end_date,
      'purpose', purpose,
      'prescriber', prescriber,
      'notes', notes,
      'originKind', origin_kind,
      'originProvider', origin_provider,
      'originExternalId', origin_external_id,
      'revision', revision,
      'createdAt', created_at,
      'updatedAt', updated_at
    ),
    updated_at,
    origin_kind,
    origin_provider
  FROM medicine_claim
`;

const energyBackfillSql = `
  INSERT OR IGNORE INTO claim_revision (
    id,
    patient_id,
    claim_kind,
    claim_id,
    revision,
    snapshot,
    changed_at,
    change_origin_kind,
    change_origin_provider
  )
  SELECT
    'energy:' || id || ':' || revision,
    patient_id,
    'energy',
    id,
    revision,
    json_object(
      'id', id,
      'patientId', patient_id,
      'direction', direction,
      'label', label,
      'category', category,
      'energyKcal', energy_kcal,
      'occurredAt', occurred_at,
      'localDate', local_date,
      'timezone', timezone,
      'timezoneOffsetMinutes', timezone_offset_minutes,
      'durationMinutes', duration_minutes,
      'status', status,
      'notes', notes,
      'originKind', origin_kind,
      'originProvider', origin_provider,
      'originExternalId', origin_external_id,
      'revision', revision,
      'createdAt', created_at,
      'updatedAt', updated_at
    ),
    updated_at,
    origin_kind,
    origin_provider
  FROM energy_claim
`;

async function missingCounts() {
  const result = await client.execute(missingCountsSql);
  const row = result.rows[0];

  return {
    medicine: Number(row?.medicine || 0),
    energy: Number(row?.energy || 0),
  };
}

try {
  const before = await missingCounts();
  const apply = process.argv.includes('--apply');

  if (apply) {
    await client.batch([medicineBackfillSql, energyBackfillSql], 'write');
  }

  const after = apply ? await missingCounts() : before;
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', before, after }, null, 2));
} finally {
  client.close();
}
