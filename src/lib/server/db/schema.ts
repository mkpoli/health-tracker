import { check, foreignKey, index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';
import type { ClaimRevisionSnapshot } from '$lib/claim-revision';

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

export const exerciseDefinition = sqliteTable(
	'exercise_definition',
	{
		id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
		patientId: text('patient_id')
			.notNull()
			.references(() => patient.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		normalizedKey: text('normalized_key').notNull(),
		category: text('category'),
		equipment: text('equipment'),
		notes: text('notes'),
		originKind: text('origin_kind').notNull().default('manual'),
		originProvider: text('origin_provider'),
		originExternalId: text('origin_external_id'),
		sourceData: text('source_data', { mode: 'json' }).$type<unknown>(),
		createdAt: text('created_at')
			.notNull()
			.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
		updatedAt: text('updated_at')
			.notNull()
			.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`)
	},
	(table) => [
		uniqueIndex('exercise_definition_id_patient_idx').on(table.id, table.patientId),
		uniqueIndex('exercise_definition_patient_key_idx').on(table.patientId, table.normalizedKey),
		index('exercise_definition_patient_name_idx').on(table.patientId, table.name),
		uniqueIndex('exercise_definition_external_idx').on(
			table.patientId,
			table.originProvider,
			table.originExternalId
		)
	]
);

export const workoutClaim = sqliteTable(
	'workout_claim',
	{
		id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
		patientId: text('patient_id')
			.notNull()
			.references(() => patient.id, { onDelete: 'cascade' }),
		kind: text('kind').notNull(),
		title: text('title').notNull(),
		status: text('status').notNull(),
		basedOnWorkoutId: text('based_on_workout_id'),
		startedAt: text('started_at'),
		endedAt: text('ended_at'),
		localDate: text('local_date'),
		timezone: text('timezone'),
		timezoneOffsetMinutes: integer('timezone_offset_minutes'),
		endedTimezoneOffsetMinutes: integer('ended_timezone_offset_minutes'),
		notes: text('notes'),
		originKind: text('origin_kind').notNull().default('manual'),
		originProvider: text('origin_provider'),
		originExternalId: text('origin_external_id'),
		sourceCreatedAt: text('source_created_at'),
		sourceUpdatedAt: text('source_updated_at'),
		sourceData: text('source_data', { mode: 'json' }).$type<unknown>(),
		revision: integer('revision').notNull().default(1),
		createdAt: text('created_at')
			.notNull()
			.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
		updatedAt: text('updated_at')
			.notNull()
			.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`)
	},
	(table) => [
		check('workout_claim_kind_check', sql`${table.kind} in ('session', 'plan')`),
		check(
			'workout_claim_status_check',
			sql`(${table.kind} = 'session' and ${table.status} in ('completed', 'draft', 'excluded')) or (${table.kind} = 'plan' and ${table.status} in ('active', 'archived'))`
		),
		uniqueIndex('workout_claim_id_patient_idx').on(table.id, table.patientId),
		index('workout_claim_patient_kind_idx').on(table.patientId, table.kind),
		index('workout_claim_patient_date_idx').on(table.patientId, table.localDate),
		index('workout_claim_patient_updated_idx').on(table.patientId, table.updatedAt),
		uniqueIndex('workout_claim_external_idx').on(
			table.patientId,
			table.kind,
			table.originProvider,
			table.originExternalId
		)
	]
);

export const workoutExercise = sqliteTable(
	'workout_exercise',
	{
		id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
		patientId: text('patient_id')
			.notNull()
			.references(() => patient.id, { onDelete: 'cascade' }),
		workoutClaimId: text('workout_claim_id').notNull(),
		exerciseDefinitionId: text('exercise_definition_id'),
		orderIndex: integer('order_index').notNull(),
		name: text('name').notNull(),
		category: text('category'),
		equipment: text('equipment'),
		notes: text('notes'),
		restSeconds: integer('rest_seconds'),
		supersetGroup: text('superset_group'),
		originExternalId: text('origin_external_id'),
		sourceData: text('source_data', { mode: 'json' }).$type<unknown>()
	},
	(table) => [
		foreignKey({
			name: 'workout_exercise_claim_patient_fk',
			columns: [table.workoutClaimId, table.patientId],
			foreignColumns: [workoutClaim.id, workoutClaim.patientId]
		}).onDelete('cascade'),
		foreignKey({
			name: 'workout_exercise_definition_patient_fk',
			columns: [table.exerciseDefinitionId, table.patientId],
			foreignColumns: [exerciseDefinition.id, exerciseDefinition.patientId]
		}),
		uniqueIndex('workout_exercise_identity_idx').on(
			table.id,
			table.workoutClaimId,
			table.patientId
		),
		uniqueIndex('workout_exercise_order_idx').on(table.workoutClaimId, table.orderIndex),
		uniqueIndex('workout_exercise_external_idx').on(
			table.workoutClaimId,
			table.originExternalId
		),
		index('workout_exercise_patient_idx').on(table.patientId),
		index('workout_exercise_definition_idx').on(table.exerciseDefinitionId)
	]
);

export const workoutSet = sqliteTable(
	'workout_set',
	{
		id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
		patientId: text('patient_id')
			.notNull()
			.references(() => patient.id, { onDelete: 'cascade' }),
		workoutClaimId: text('workout_claim_id').notNull(),
		workoutExerciseId: text('workout_exercise_id').notNull(),
		orderIndex: integer('order_index').notNull(),
		setType: text('set_type').notNull().default('normal'),
		status: text('status').notNull().default('unknown'),
		weightValue: real('weight_value'),
		weightUnit: text('weight_unit'),
		repetitions: integer('repetitions'),
		durationSeconds: integer('duration_seconds'),
		distanceValue: real('distance_value'),
		distanceUnit: text('distance_unit'),
		rpe: real('rpe'),
		rir: real('rir'),
		notes: text('notes'),
		originExternalId: text('origin_external_id'),
		sourceData: text('source_data', { mode: 'json' }).$type<unknown>()
	},
	(table) => [
		foreignKey({
			name: 'workout_set_exercise_claim_patient_fk',
			columns: [table.workoutExerciseId, table.workoutClaimId, table.patientId],
			foreignColumns: [workoutExercise.id, workoutExercise.workoutClaimId, workoutExercise.patientId]
		}).onDelete('cascade'),
		check(
			'workout_set_type_check',
			sql`${table.setType} in ('normal', 'warmup', 'drop', 'failure', 'superset', 'rest_pause', 'other')`
		),
		check(
			'workout_set_status_check',
			sql`${table.status} in ('completed', 'planned', 'skipped', 'failed', 'unknown')`
		),
		uniqueIndex('workout_set_order_idx').on(table.workoutExerciseId, table.orderIndex),
		uniqueIndex('workout_set_external_idx').on(table.workoutExerciseId, table.originExternalId),
		index('workout_set_claim_idx').on(table.workoutClaimId),
		index('workout_set_patient_idx').on(table.patientId)
	]
);

export const claimRevision = sqliteTable(
	'claim_revision',
	{
		id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
		patientId: text('patient_id')
			.notNull()
			.references(() => patient.id, { onDelete: 'cascade' }),
		claimKind: text('claim_kind').notNull(),
		claimId: text('claim_id').notNull(),
		revision: integer('revision').notNull(),
		snapshot: text('snapshot', { mode: 'json' }).notNull().$type<ClaimRevisionSnapshot>(),
		changedAt: text('changed_at').notNull(),
		changeOriginKind: text('change_origin_kind').notNull().default('manual'),
		changeOriginProvider: text('change_origin_provider')
	},
	(table) => [
		check('claim_revision_kind_check', sql`${table.claimKind} in ('medicine', 'energy', 'workout')`),
		uniqueIndex('claim_revision_claim_idx').on(table.claimKind, table.claimId, table.revision),
		index('claim_revision_patient_idx').on(table.patientId),
		index('claim_revision_patient_changed_idx').on(table.patientId, table.changedAt)
	]
);

export const patientRelations = relations(patient, ({ many }) => ({
	reports: many(report),
	records: many(record),
	medicineClaims: many(medicineClaim),
	energyClaims: many(energyClaim),
	energySources: many(energySource),
	exerciseDefinitions: many(exerciseDefinition),
	workoutClaims: many(workoutClaim),
	workoutExercises: many(workoutExercise),
	workoutSets: many(workoutSet),
	claimRevisions: many(claimRevision)
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

export const exerciseDefinitionRelations = relations(exerciseDefinition, ({ one, many }) => ({
	patient: one(patient, {
		fields: [exerciseDefinition.patientId],
		references: [patient.id]
	}),
	workoutExercises: many(workoutExercise)
}));

export const workoutClaimRelations = relations(workoutClaim, ({ one, many }) => ({
	patient: one(patient, {
		fields: [workoutClaim.patientId],
		references: [patient.id]
	}),
	exercises: many(workoutExercise),
	sets: many(workoutSet)
}));

export const workoutExerciseRelations = relations(workoutExercise, ({ one, many }) => ({
	patient: one(patient, {
		fields: [workoutExercise.patientId],
		references: [patient.id]
	}),
	workout: one(workoutClaim, {
		fields: [workoutExercise.workoutClaimId],
		references: [workoutClaim.id]
	}),
	exerciseDefinition: one(exerciseDefinition, {
		fields: [workoutExercise.exerciseDefinitionId],
		references: [exerciseDefinition.id]
	}),
	sets: many(workoutSet)
}));

export const workoutSetRelations = relations(workoutSet, ({ one }) => ({
	patient: one(patient, {
		fields: [workoutSet.patientId],
		references: [patient.id]
	}),
	workout: one(workoutClaim, {
		fields: [workoutSet.workoutClaimId],
		references: [workoutClaim.id]
	}),
	exercise: one(workoutExercise, {
		fields: [workoutSet.workoutExerciseId],
		references: [workoutExercise.id]
	})
}));

export const claimRevisionRelations = relations(claimRevision, ({ one }) => ({
	patient: one(patient, {
		fields: [claimRevision.patientId],
		references: [patient.id]
	})
}));

export * from './auth.schema';
export * from './mcp.schema';
