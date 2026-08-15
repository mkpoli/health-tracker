import { foreignKey, index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';

export const task = sqliteTable('task', {
	id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
	title: text('title').notNull(),
	priority: integer('priority').notNull().default(1)
});

export const patient = sqliteTable('patient', {
	id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
	ownerUserId: text('owner_user_id'),
	name: text('name').notNull(),
	agab: text('agab'), // assigned gender at birth
	birthday: text('birthday'), // standard ISO format date string
	// Using { mode: 'json' } to allow objects directly when inserting/selecting
	extraData: text('extra_data', { mode: 'json' })
});

export const report = sqliteTable('report', {
	id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
	patientId: text('patient_id')
		.notNull()
		.references(() => patient.id, { onDelete: 'cascade' }),
	// 'lab' for a clinical report, 'body' for a hand-logged body measurement session
	kind: text('kind').notNull().default('lab'),
	testDate: text('test_date').notNull(),
	reportTime: text('report_time'),
	rawData: text('raw_data'), // base64, URL, or raw text
	organizedData: text('organized_data', { mode: 'json' }), // extracted logical format
	parsedJsonData: text('parsed_json_data', { mode: 'json' }), // raw JSON format
	extraData: text('extra_data', { mode: 'json' })
});

export const record = sqliteTable('record', {
	id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
	patientId: text('patient_id')
		.notNull()
		.references(() => patient.id, { onDelete: 'cascade' }),
	reportId: text('report_id')
		.notNull()
		.references(() => report.id, { onDelete: 'cascade' }),
	metricName: text('metric_name').notNull(),
	value: text('value').notNull(),
	unit: text('unit'),
	refRange: text('ref_range'),
	status: text('status'), // e.g. "Normal", "High"
	extraData: text('extra_data', { mode: 'json' })
});

export const medicineClaim = sqliteTable(
	'medicine_claim',
	{
		id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
		patientId: text('patient_id')
			.notNull()
			.references(() => patient.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		genericName: text('generic_name'),
		form: text('form'),
		strength: text('strength'),
		route: text('route'),
		schedule: text('schedule'),
		status: text('status').notNull().default('active'),
		startDate: text('start_date'),
		endDate: text('end_date'),
		purpose: text('purpose'),
		prescriber: text('prescriber'),
		notes: text('notes'),
		originKind: text('origin_kind').notNull().default('manual'),
		originProvider: text('origin_provider'),
		originExternalId: text('origin_external_id'),
		revision: integer('revision').notNull().default(1),
		createdAt: text('created_at')
			.notNull()
			.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
		updatedAt: text('updated_at')
			.notNull()
			.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`)
	},
	(table) => [
		index('medicine_claim_patient_idx').on(table.patientId),
		index('medicine_claim_patient_status_idx').on(table.patientId, table.status),
		index('medicine_claim_patient_updated_idx').on(table.patientId, table.updatedAt)
	]
);

export const energyClaim = sqliteTable(
	'energy_claim',
	{
		id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
		patientId: text('patient_id')
			.notNull()
			.references(() => patient.id, { onDelete: 'cascade' }),
		direction: text('direction').notNull(),
		label: text('label'),
		category: text('category'),
		energyKcal: real('energy_kcal'),
		occurredAt: text('occurred_at').notNull(),
		localDate: text('local_date').notNull(),
		timezone: text('timezone'),
		timezoneOffsetMinutes: integer('timezone_offset_minutes').notNull(),
		durationMinutes: integer('duration_minutes'),
		status: text('status').notNull().default('recorded'),
		notes: text('notes'),
		originKind: text('origin_kind').notNull().default('manual'),
		originProvider: text('origin_provider'),
		originExternalId: text('origin_external_id'),
		revision: integer('revision').notNull().default(1),
		createdAt: text('created_at')
			.notNull()
			.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
		updatedAt: text('updated_at')
			.notNull()
			.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`)
	},
	(table) => [
		uniqueIndex('energy_claim_id_patient_idx').on(table.id, table.patientId),
		index('energy_claim_patient_date_idx').on(table.patientId, table.localDate),
		index('energy_claim_patient_occurred_idx').on(table.patientId, table.occurredAt),
		uniqueIndex('energy_claim_external_idx').on(
			table.patientId,
			table.originProvider,
			table.originExternalId
		)
	]
);

export const energySource = sqliteTable(
	'energy_source',
	{
		id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
		patientId: text('patient_id')
			.notNull()
			.references(() => patient.id, { onDelete: 'cascade' }),
		energyClaimId: text('energy_claim_id').notNull(),
		kind: text('kind').notNull().default('photo'),
		storageKey: text('storage_key').notNull().unique(),
		mimeType: text('mime_type').notNull(),
		fileName: text('file_name'),
		byteSize: integer('byte_size').notNull(),
		objectEtag: text('object_etag'),
		createdAt: text('created_at')
			.notNull()
			.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`)
	},
	(table) => [
		foreignKey({
			name: 'energy_source_claim_patient_fk',
			columns: [table.energyClaimId, table.patientId],
			foreignColumns: [energyClaim.id, energyClaim.patientId]
		}).onDelete('cascade'),
		index('energy_source_patient_idx').on(table.patientId),
		index('energy_source_claim_idx').on(table.energyClaimId)
	]
);

export const patientRelations = relations(patient, ({ many }) => ({
	reports: many(report),
	records: many(record),
	medicineClaims: many(medicineClaim),
	energyClaims: many(energyClaim),
	energySources: many(energySource)
}));

export const reportRelations = relations(report, ({ one, many }) => ({
	patient: one(patient, {
		fields: [report.patientId],
		references: [patient.id]
	}),
	records: many(record)
}));

export const recordRelations = relations(record, ({ one }) => ({
	patient: one(patient, {
		fields: [record.patientId],
		references: [patient.id]
	}),
	report: one(report, {
		fields: [record.reportId],
		references: [report.id]
	})
}));

export const medicineClaimRelations = relations(medicineClaim, ({ one }) => ({
	patient: one(patient, {
		fields: [medicineClaim.patientId],
		references: [patient.id]
	})
}));

export const energyClaimRelations = relations(energyClaim, ({ one, many }) => ({
	patient: one(patient, {
		fields: [energyClaim.patientId],
		references: [patient.id]
	}),
	sources: many(energySource)
}));

export const energySourceRelations = relations(energySource, ({ one }) => ({
	patient: one(patient, {
		fields: [energySource.patientId],
		references: [patient.id]
	}),
	energyClaim: one(energyClaim, {
		fields: [energySource.energyClaimId],
		references: [energyClaim.id]
	})
}));

export * from './auth.schema';
export * from './mcp.schema';
