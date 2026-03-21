import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';

export const task = sqliteTable('task', {
	id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
	title: text('title').notNull(),
	priority: integer('priority').notNull().default(1)
});

export const patient = sqliteTable('patient', {
	id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
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

export const patientRelations = relations(patient, ({ many }) => ({
	reports: many(report),
	records: many(record)
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

export * from './auth.schema';
