import { check, foreignKey, index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';
import type { ClaimRevisionSnapshot } from '$lib/claim-revision';
import type { MedicineCatalogRevisionSnapshot } from '$lib/medicine-catalog';

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

export const medicineIngredient = sqliteTable(
	'medicine_ingredient',
	{
		id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
		patientId: text('patient_id')
			.notNull()
			.references(() => patient.id, { onDelete: 'cascade' }),
		canonicalName: text('canonical_name').notNull(),
		normalizedName: text('normalized_name').notNull(),
		status: text('status').notNull().default('active'),
		notes: text('notes'),
		originKind: text('origin_kind').notNull().default('manual'),
		originProvider: text('origin_provider'),
		originExternalId: text('origin_external_id'),
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
		check(
			'medicine_ingredient_status_check',
			sql`${table.status} in ('active', 'inactive', 'archived')`
		),
		uniqueIndex('medicine_ingredient_id_patient_idx').on(table.id, table.patientId),
		index('medicine_ingredient_patient_name_idx').on(table.patientId, table.normalizedName),
		index('medicine_ingredient_patient_cursor_idx').on(table.patientId, table.id),
		index('medicine_ingredient_patient_updated_idx').on(table.patientId, table.updatedAt)
	]
);

export const medicineProduct = sqliteTable(
	'medicine_product',
	{
		id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
		patientId: text('patient_id')
			.notNull()
			.references(() => patient.id, { onDelete: 'cascade' }),
		displayName: text('display_name').notNull(),
		normalizedName: text('normalized_name').notNull().default(''),
		productType: text('product_type').notNull().default('other'),
		status: text('status').notNull().default('active'),
		doseFormText: text('dose_form_text'),
		doseFormSystem: text('dose_form_system'),
		doseFormCode: text('dose_form_code'),
		routeText: text('route_text'),
		routeSystem: text('route_system'),
		routeCode: text('route_code'),
		strengthText: text('strength_text'),
		manufacturer: text('manufacturer'),
		marketingAuthorizationHolder: text('marketing_authorization_holder'),
		marketCountry: text('market_country'),
		packageDescription: text('package_description'),
		imprint: text('imprint'),
		color: text('color'),
		shape: text('shape'),
		notes: text('notes'),
		originKind: text('origin_kind').notNull().default('manual'),
		originProvider: text('origin_provider'),
		originExternalId: text('origin_external_id'),
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
		check(
			'medicine_product_type_check',
			sql`${table.productType} in ('branded', 'generic', 'compounded', 'supplement', 'other')`
		),
		check(
			'medicine_product_status_check',
			sql`${table.status} in ('active', 'inactive', 'archived')`
		),
		uniqueIndex('medicine_product_id_patient_idx').on(table.id, table.patientId),
		index('medicine_product_patient_name_idx').on(table.patientId, table.normalizedName),
		index('medicine_product_patient_cursor_idx').on(table.patientId, table.id),
		index('medicine_product_patient_status_idx').on(table.patientId, table.status),
		index('medicine_product_patient_updated_idx').on(table.patientId, table.updatedAt)
	]
);

export const medicineCatalogName = sqliteTable(
	'medicine_catalog_name',
	{
		id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
		patientId: text('patient_id')
			.notNull()
			.references(() => patient.id, { onDelete: 'cascade' }),
		ingredientId: text('ingredient_id'),
		productId: text('product_id'),
		orderIndex: integer('order_index').notNull(),
		name: text('name').notNull(),
		normalizedName: text('normalized_name').notNull(),
		languageTag: text('language_tag').notNull().default('und'),
		nameType: text('name_type').notNull().default('preferred'),
		jurisdiction: text('jurisdiction'),
		preferred: integer('preferred', { mode: 'boolean' }).notNull().default(false),
		sourceKind: text('source_kind').notNull().default('manual'),
		sourceProvider: text('source_provider'),
		sourceUrl: text('source_url'),
		sourceRetrievedAt: text('source_retrieved_at')
	},
	(table) => [
		foreignKey({
			name: 'medicine_catalog_name_ingredient_patient_fk',
			columns: [table.ingredientId, table.patientId],
			foreignColumns: [medicineIngredient.id, medicineIngredient.patientId]
		}).onDelete('cascade'),
		foreignKey({
			name: 'medicine_catalog_name_product_patient_fk',
			columns: [table.productId, table.patientId],
			foreignColumns: [medicineProduct.id, medicineProduct.patientId]
		}).onDelete('cascade'),
		check(
			'medicine_catalog_name_owner_check',
			sql`(${table.ingredientId} is not null and ${table.productId} is null) or (${table.ingredientId} is null and ${table.productId} is not null)`
		),
		check(
			'medicine_catalog_name_type_check',
			sql`${table.nameType} in ('preferred', 'brand', 'generic', 'synonym')`
		),
		uniqueIndex('medicine_catalog_name_ingredient_order_idx').on(
			table.patientId,
			table.ingredientId,
			table.orderIndex
		),
		uniqueIndex('medicine_catalog_name_product_order_idx').on(
			table.patientId,
			table.productId,
			table.orderIndex
		),
		index('medicine_catalog_name_patient_name_idx').on(table.patientId, table.normalizedName)
	]
);

export const medicineCatalogIdentifier = sqliteTable(
	'medicine_catalog_identifier',
	{
		id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
		patientId: text('patient_id')
			.notNull()
			.references(() => patient.id, { onDelete: 'cascade' }),
		ingredientId: text('ingredient_id'),
		productId: text('product_id'),
		orderIndex: integer('order_index').notNull(),
		system: text('system').notNull(),
		code: text('code').notNull(),
		jurisdiction: text('jurisdiction'),
		sourceKind: text('source_kind').notNull().default('manual'),
		sourceProvider: text('source_provider'),
		sourceUrl: text('source_url'),
		sourceRetrievedAt: text('source_retrieved_at')
	},
	(table) => [
		foreignKey({
			name: 'medicine_catalog_identifier_ingredient_patient_fk',
			columns: [table.ingredientId, table.patientId],
			foreignColumns: [medicineIngredient.id, medicineIngredient.patientId]
		}).onDelete('cascade'),
		foreignKey({
			name: 'medicine_catalog_identifier_product_patient_fk',
			columns: [table.productId, table.patientId],
			foreignColumns: [medicineProduct.id, medicineProduct.patientId]
		}).onDelete('cascade'),
		check(
			'medicine_catalog_identifier_owner_check',
			sql`(${table.ingredientId} is not null and ${table.productId} is null) or (${table.ingredientId} is null and ${table.productId} is not null)`
		),
		uniqueIndex('medicine_catalog_identifier_ingredient_order_idx').on(
			table.patientId,
			table.ingredientId,
			table.orderIndex
		),
		uniqueIndex('medicine_catalog_identifier_product_order_idx').on(
			table.patientId,
			table.productId,
			table.orderIndex
		),
		index('medicine_catalog_identifier_patient_system_idx').on(
			table.patientId,
			table.system,
			table.code
		)
	]
);

export const medicineProductIngredient = sqliteTable(
	'medicine_product_ingredient',
	{
		id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
		patientId: text('patient_id')
			.notNull()
			.references(() => patient.id, { onDelete: 'cascade' }),
		productId: text('product_id').notNull(),
		ingredientId: text('ingredient_id').notNull(),
		orderIndex: integer('order_index').notNull(),
		role: text('role').notNull().default('active'),
		numeratorValue: text('numerator_value'),
		numeratorUnit: text('numerator_unit'),
		denominatorValue: text('denominator_value'),
		denominatorUnit: text('denominator_unit'),
		strengthText: text('strength_text'),
		basisOfStrengthText: text('basis_of_strength_text'),
		sourceKind: text('source_kind').notNull().default('manual'),
		sourceProvider: text('source_provider'),
		sourceUrl: text('source_url'),
		sourceRetrievedAt: text('source_retrieved_at')
	},
	(table) => [
		foreignKey({
			name: 'medicine_product_ingredient_product_patient_fk',
			columns: [table.productId, table.patientId],
			foreignColumns: [medicineProduct.id, medicineProduct.patientId]
		}).onDelete('cascade'),
		foreignKey({
			name: 'medicine_product_ingredient_ingredient_patient_fk',
			columns: [table.ingredientId, table.patientId],
			foreignColumns: [medicineIngredient.id, medicineIngredient.patientId]
		}),
		check(
			'medicine_product_ingredient_role_check',
			sql`${table.role} in ('active', 'inactive', 'unknown')`
		),
		uniqueIndex('medicine_product_ingredient_product_ingredient_idx').on(
			table.productId,
			table.ingredientId
		),
		uniqueIndex('medicine_product_ingredient_order_idx').on(table.patientId, table.productId, table.orderIndex),
		index('medicine_product_ingredient_patient_idx').on(table.patientId),
		index('medicine_product_ingredient_ingredient_idx').on(table.ingredientId)
	]
);

export const medicineCatalogRevision = sqliteTable(
	'medicine_catalog_revision',
	{
		id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
		patientId: text('patient_id')
			.notNull()
			.references(() => patient.id, { onDelete: 'cascade' }),
		entityKind: text('entity_kind').notNull(),
		entityId: text('entity_id').notNull(),
		revision: integer('revision').notNull(),
		snapshot: text('snapshot', { mode: 'json' })
			.notNull()
			.$type<MedicineCatalogRevisionSnapshot>(),
		changedAt: text('changed_at').notNull(),
		changeOriginKind: text('change_origin_kind').notNull().default('manual'),
		changeOriginProvider: text('change_origin_provider')
	},
	(table) => [
		check(
			'medicine_catalog_revision_kind_check',
			sql`${table.entityKind} in ('ingredient', 'product')`
		),
		uniqueIndex('medicine_catalog_revision_entity_idx').on(
			table.entityKind,
			table.entityId,
			table.revision
		),
		index('medicine_catalog_revision_patient_idx').on(table.patientId),
		index('medicine_catalog_revision_patient_changed_idx').on(table.patientId, table.changedAt)
	]
);

export const medicineClaim = sqliteTable(
	'medicine_claim',
	{
		id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
		patientId: text('patient_id')
			.notNull()
			.references(() => patient.id, { onDelete: 'cascade' }),
		productId: text('product_id'),
		name: text('name').notNull(),
		genericName: text('generic_name'),
		form: text('form'),
		strength: text('strength'),
		route: text('route'),
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
		foreignKey({
			name: 'medicine_claim_product_patient_fk',
			columns: [table.productId, table.patientId],
			foreignColumns: [medicineProduct.id, medicineProduct.patientId]
		}),
		index('medicine_claim_patient_idx').on(table.patientId),
		index('medicine_claim_product_idx').on(table.productId),
		index('medicine_claim_patient_status_idx').on(table.patientId, table.status),
		index('medicine_claim_patient_updated_idx').on(table.patientId, table.updatedAt)
	]
);

export const medicineCourse = sqliteTable(
	'medicine_course',
	{
		id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
		patientId: text('patient_id')
			.notNull()
			.references(() => patient.id, { onDelete: 'cascade' }),
		medicineClaimId: text('medicine_claim_id')
			.notNull()
			.references(() => medicineClaim.id, { onDelete: 'cascade' }),
		kind: text('kind').notNull().default('initial'),
		status: text('status').notNull().default('active'),
		previousCourseId: text('previous_course_id'),
		startDate: text('start_date').notNull(),
		endDate: text('end_date'),
		endReason: text('end_reason'),
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
		check('medicine_course_kind_check', sql`${table.kind} in ('initial', 'restart')`),
		check(
			'medicine_course_status_check',
			sql`${table.status} in ('planned', 'active', 'held', 'ended')`
		),
		foreignKey({
			name: 'medicine_course_previous_fk',
			columns: [table.previousCourseId],
			foreignColumns: [table.id]
		}).onDelete('set null'),
		index('medicine_course_patient_idx').on(table.patientId),
		index('medicine_course_medicine_idx').on(table.medicineClaimId)
	]
);

export const doseRegimen = sqliteTable(
	'dose_regimen',
	{
		id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
		patientId: text('patient_id')
			.notNull()
			.references(() => patient.id, { onDelete: 'cascade' }),
		courseId: text('course_id')
			.notNull()
			.references(() => medicineCourse.id, { onDelete: 'cascade' }),
		ruleKind: text('rule_kind').notNull(),
		slots: text('slots', { mode: 'json' }).notNull().default([]).$type<unknown>(),
		daysOfWeek: text('days_of_week', { mode: 'json' }).$type<unknown>(),
		intervalHours: real('interval_hours'),
		anchorAt: text('anchor_at'),
		doseText: text('dose_text'),
		route: text('route'),
		site: text('site'),
		timezone: text('timezone').notNull(),
		effectiveFrom: text('effective_from').notNull(),
		effectiveTo: text('effective_to'),
		remindMinutesBefore: integer('remind_minutes_before'),
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
		check(
			'dose_regimen_rule_check',
			sql`${table.ruleKind} in ('fixed_slots', 'interval', 'as_needed')`
		),
		index('dose_regimen_patient_idx').on(table.patientId),
		index('dose_regimen_course_idx').on(table.courseId)
	]
);

export const doseOccurrence = sqliteTable(
	'dose_occurrence',
	{
		id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
		patientId: text('patient_id')
			.notNull()
			.references(() => patient.id, { onDelete: 'cascade' }),
		courseId: text('course_id')
			.notNull()
			.references(() => medicineCourse.id, { onDelete: 'cascade' }),
		regimenId: text('regimen_id').references(() => doseRegimen.id, { onDelete: 'set null' }),
		regimenRevision: integer('regimen_revision'),
		slotKey: integer('slot_key'),
		localDate: text('local_date').notNull(),
		plannedAt: text('planned_at'),
		timezone: text('timezone').notNull(),
		status: text('status').notNull().default('planned'),
		actualAt: text('actual_at'),
		actualValue: real('actual_value'),
		actualUnit: text('actual_unit'),
		actualText: text('actual_text'),
		route: text('route'),
		site: text('site'),
		reason: text('reason'),
		reaction: text('reaction'),
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
		check(
			'dose_occurrence_status_check',
			sql`${table.status} in ('planned', 'taken', 'partial', 'skipped', 'missed', 'delayed', 'held', 'unknown')`
		),
		uniqueIndex('dose_occurrence_slot_idx').on(table.regimenId, table.localDate, table.slotKey),
		index('dose_occurrence_patient_date_idx').on(table.patientId, table.localDate),
		index('dose_occurrence_patient_planned_idx').on(table.patientId, table.plannedAt),
		index('dose_occurrence_course_idx').on(table.courseId)
	]
);

export const doseDelivery = sqliteTable(
	'dose_delivery',
	{
		id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
		patientId: text('patient_id')
			.notNull()
			.references(() => patient.id, { onDelete: 'cascade' }),
		occurrenceRef: text('occurrence_ref').notNull(),
		deliveredAt: text('delivered_at').notNull(),
		channel: text('channel').notNull(),
		provider: text('provider'),
		createdAt: text('created_at')
			.notNull()
			.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`)
	},
	(table) => [
		uniqueIndex('dose_delivery_attempt_idx').on(
			table.patientId,
			table.occurrenceRef,
			table.deliveredAt,
			table.channel
		),
		index('dose_delivery_patient_idx').on(table.patientId, table.deliveredAt)
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

export const dataImport = sqliteTable(
	'data_import',
	{
		id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
		patientId: text('patient_id')
			.notNull()
			.references(() => patient.id, { onDelete: 'cascade' }),
		provider: text('provider').notNull(),
		format: text('format').notNull(),
		status: text('status').notNull().default('pending'),
		fileName: text('file_name'),
		mimeType: text('mime_type').notNull(),
		byteSize: integer('byte_size').notNull(),
		contentSha256: text('content_sha256').notNull(),
		interpretationKey: text('interpretation_key').notNull().default(''),
		storageKey: text('storage_key').notNull().unique(),
		objectEtag: text('object_etag'),
		timezone: text('timezone'),
		summaryData: text('summary_data', { mode: 'json' }).$type<unknown>(),
		errorCode: text('error_code'),
		createdAt: text('created_at')
			.notNull()
			.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
		updatedAt: text('updated_at')
			.notNull()
			.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`)
	},
	(table) => [
		check('data_import_status_check', sql`${table.status} in ('pending', 'completed', 'failed')`),
		uniqueIndex('data_import_source_idx').on(
			table.patientId,
			table.provider,
			table.format,
			table.contentSha256,
			table.interpretationKey
		),
		index('data_import_patient_idx').on(table.patientId),
		index('data_import_patient_created_idx').on(table.patientId, table.createdAt)
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
		check(
			'claim_revision_kind_check',
			sql`${table.claimKind} in ('medicine', 'energy', 'workout', 'medicine_course', 'dose_regimen', 'dose_occurrence')`
		),
		uniqueIndex('claim_revision_claim_idx').on(table.claimKind, table.claimId, table.revision),
		index('claim_revision_patient_idx').on(table.patientId),
		index('claim_revision_patient_changed_idx').on(table.patientId, table.changedAt)
	]
);

export const patientRelations = relations(patient, ({ many }) => ({
	reports: many(report),
	records: many(record),
	medicineIngredients: many(medicineIngredient),
	medicineProducts: many(medicineProduct),
	medicineCatalogNames: many(medicineCatalogName),
	medicineCatalogIdentifiers: many(medicineCatalogIdentifier),
	medicineProductIngredients: many(medicineProductIngredient),
	medicineCatalogRevisions: many(medicineCatalogRevision),
	medicineClaims: many(medicineClaim),
	medicineCourses: many(medicineCourse),
	doseRegimens: many(doseRegimen),
	doseOccurrences: many(doseOccurrence),
	energyClaims: many(energyClaim),
	energySources: many(energySource),
	dataImports: many(dataImport),
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

export const medicineIngredientRelations = relations(medicineIngredient, ({ one, many }) => ({
	patient: one(patient, {
		fields: [medicineIngredient.patientId],
		references: [patient.id]
	}),
	names: many(medicineCatalogName, { relationName: 'medicineIngredientNames' }),
	identifiers: many(medicineCatalogIdentifier, {
		relationName: 'medicineIngredientIdentifiers'
	}),
	products: many(medicineProductIngredient)
}));

export const medicineProductRelations = relations(medicineProduct, ({ one, many }) => ({
	patient: one(patient, {
		fields: [medicineProduct.patientId],
		references: [patient.id]
	}),
	names: many(medicineCatalogName, { relationName: 'medicineProductNames' }),
	identifiers: many(medicineCatalogIdentifier, { relationName: 'medicineProductIdentifiers' }),
	ingredients: many(medicineProductIngredient),
	claims: many(medicineClaim)
}));

export const medicineCatalogNameRelations = relations(medicineCatalogName, ({ one }) => ({
	patient: one(patient, {
		fields: [medicineCatalogName.patientId],
		references: [patient.id]
	}),
	ingredient: one(medicineIngredient, {
		fields: [medicineCatalogName.ingredientId],
		references: [medicineIngredient.id],
		relationName: 'medicineIngredientNames'
	}),
	product: one(medicineProduct, {
		fields: [medicineCatalogName.productId],
		references: [medicineProduct.id],
		relationName: 'medicineProductNames'
	})
}));

export const medicineCatalogIdentifierRelations = relations(
	medicineCatalogIdentifier,
	({ one }) => ({
		patient: one(patient, {
			fields: [medicineCatalogIdentifier.patientId],
			references: [patient.id]
		}),
		ingredient: one(medicineIngredient, {
			fields: [medicineCatalogIdentifier.ingredientId],
			references: [medicineIngredient.id],
			relationName: 'medicineIngredientIdentifiers'
		}),
		product: one(medicineProduct, {
			fields: [medicineCatalogIdentifier.productId],
			references: [medicineProduct.id],
			relationName: 'medicineProductIdentifiers'
		})
	})
);

export const medicineProductIngredientRelations = relations(
	medicineProductIngredient,
	({ one }) => ({
		patient: one(patient, {
			fields: [medicineProductIngredient.patientId],
			references: [patient.id]
		}),
		product: one(medicineProduct, {
			fields: [medicineProductIngredient.productId],
			references: [medicineProduct.id]
		}),
		ingredient: one(medicineIngredient, {
			fields: [medicineProductIngredient.ingredientId],
			references: [medicineIngredient.id]
		})
	})
);

export const medicineCatalogRevisionRelations = relations(medicineCatalogRevision, ({ one }) => ({
	patient: one(patient, {
		fields: [medicineCatalogRevision.patientId],
		references: [patient.id]
	})
}));

export const medicineClaimRelations = relations(medicineClaim, ({ one, many }) => ({
	patient: one(patient, {
		fields: [medicineClaim.patientId],
		references: [patient.id]
	}),
	product: one(medicineProduct, {
		fields: [medicineClaim.productId],
		references: [medicineProduct.id]
	}),
	courses: many(medicineCourse)
}));

export const medicineCourseRelations = relations(medicineCourse, ({ one, many }) => ({
	patient: one(patient, {
		fields: [medicineCourse.patientId],
		references: [patient.id]
	}),
	medicine: one(medicineClaim, {
		fields: [medicineCourse.medicineClaimId],
		references: [medicineClaim.id]
	}),
	regimens: many(doseRegimen),
	occurrences: many(doseOccurrence)
}));

export const doseRegimenRelations = relations(doseRegimen, ({ one, many }) => ({
	patient: one(patient, {
		fields: [doseRegimen.patientId],
		references: [patient.id]
	}),
	course: one(medicineCourse, {
		fields: [doseRegimen.courseId],
		references: [medicineCourse.id]
	}),
	occurrences: many(doseOccurrence)
}));

export const doseOccurrenceRelations = relations(doseOccurrence, ({ one }) => ({
	patient: one(patient, {
		fields: [doseOccurrence.patientId],
		references: [patient.id]
	}),
	course: one(medicineCourse, {
		fields: [doseOccurrence.courseId],
		references: [medicineCourse.id]
	}),
	regimen: one(doseRegimen, {
		fields: [doseOccurrence.regimenId],
		references: [doseRegimen.id]
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

export const dataImportRelations = relations(dataImport, ({ one }) => ({
	patient: one(patient, {
		fields: [dataImport.patientId],
		references: [patient.id]
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
