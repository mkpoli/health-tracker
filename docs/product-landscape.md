# Product landscape

Reviewed 2026-08-15.

## Product position

Health Tracker keeps a person's health history as editable, sourced claims. Its native record remains usable when every optional connector is disconnected. Imports, manual entries, source files, and model-generated drafts keep enough context for later review and reprocessing.

The product develops in this order:

1. durable records, source files, provenance, revision history, and recovery;
2. fast manual capture and reviewed machine-assisted capture;
3. imports and device connectors;
4. reminders and plans based on confirmed records;
5. advice with visible evidence, uncertainty, and safety boundaries.

The account holder controls the record. They may correct, replace, hide, or delete a value. Earlier saved versions remain available until the account holder removes them through an explicit retention control.

## Design commitments

- The native archive is a complete transfer and recovery format for supported data and retained files.
- A connector contributes claims and provenance. Its availability never determines whether an imported record can still be read.
- Original photos, documents, payloads, timestamps, units, and identifiers are retained when the source permits it.
- Machine extraction creates a proposal. Saving requires a separate user action.
- Unknown values stay unknown. Zero has its ordinary numeric meaning.
- Imported duplicates remain traceable to every source. A reversible equivalence link can group records that describe the same event.
- Every timestamp keeps the source instant, source offset when supplied, profile timezone, and local calendar date used for summaries.
- External writes use scoped authorization, retry-safe request identifiers, and revision checks.
- Exports remain documented and testable before reminders or advice depend on the corresponding records.

## Market map

| Area | Products and documented strengths | Direction for Health Tracker |
| --- | --- | --- |
| Device and health-data hubs | [Apple Health and HealthKit](https://developer.apple.com/documentation/healthkit/about-the-healthkit-framework) cover activity, workouts, nutrition, sleep, vitals, symptoms, routes, and clinical records. Apple Health also supports [medication schedules, dose logging, reminders, archives, and PDF export](https://support.apple.com/en-ca/105064). [Health Connect](https://developer.android.com/health-and-fitness/health-connect/data-types) provides an Android store for activity, body, cycle, nutrition, sleep, and vital data. Its [medical-record API](https://developer.android.com/health-and-fitness/health-connect/medical-records) uses FHIR and remains experimental. | Support both ecosystems through native bridges. Keep the application's native schema, provenance, and archive available across platforms. |
| Platform personal record | [Google Health](https://support.google.com/googlehealth/answer/16998660?hl=en) gathers provider records, Health Connect data, and uploaded PDFs or images, then organizes medications, allergies, immunizations, laboratory results, vitals, procedures, conditions, and visits. It provides export and deletion controls. | Combine clinical records with detailed self-observation, treatment, food, exercise, and source history. Keep export available independently of the platform source. |
| Consumer health record | [Guava](https://guavahealth.com/api) connects providers, devices, documents, CSV data, FHIR, C-CDA, and an early-access API. [OneRecord](https://onerecord.com/) focuses on health-system aggregation. [HealthThread](https://apps.apple.com/us/app/healththread-by-jardogshealth/id6781116877) combines provider, pharmacy, and wearable records. | Cover self-recorded body data, treatment activity, source media, and agent access alongside clinical records. |
| Local and self-hosted records | [HealthLog](https://docs.healthlog.dev/) provides a self-hosted timeline, medication adherence, device connectors, FHIR export, and a read-only FHIR API. [Savva](https://www.savva.ai/how-it-works) stores the record on-device and lets the user choose an AI provider. [PHR Health Records](https://apps.apple.com/us/app/phr-health-records/id6761078876) imports C-CDA into an on-device family record. | Offer a hosted product with complete native export, documented APIs, scoped agent access, and a future self-hosting path that reads the same archive. |
| Record-first AI | [Folio](https://www.foliohealth.app/), [Ankol](https://ankol.app/), [Slothwise](https://www.slothwise.com/), [Advoca](https://advocahealth.com/), and [Insina Health](https://insinahealth.com/) describe source-linked answers, timelines, visit preparation, or reviewed records. [LabsVault](https://labsvault.com/) exposes laboratory data to assistants through MCP. | Preserve claim-level evidence before adding cross-record reasoning. Agent output should cite record IDs, revisions, time windows, and source artifacts. |
| Symptoms and daily factors | [Bearable](https://bearable.app/medical-professionals/) emphasizes quick symptom, mood, factor, and correlation tracking. [CareClinic](https://careclinic.io/features/) spans medication, symptoms, nutrition, activity, sleep, appointments, documents, and family profiles. | Use a shared event model with domain-specific fields and quick capture. Keep correlations descriptive and show sample counts, time windows, missingness, and confounders. |
| Medication routines | [Medisafe](https://medisafe.com/download-the-app) supports complex schedules, refill reminders, adherence reports, interaction alerts, measurements, and caregiver escalation. [MyTherapy](https://www.mytherapyapp.com/) combines dose logs, stock, refill reminders, injection-site tracking, symptoms, measurements, and reports. | Separate medication identity, regimen, schedule rules, planned doses, actual dose events, inventory, and evidence. Permit late correction of every dose event. |
| Food and nutrition | [Cronometer](https://support.cronometer.com/hc/en-us/articles/360018760151-Account-Settings) exports servings, exercise, biometrics, and notes as CSV and syncs with [Health Connect](https://support.cronometer.com/hc/en-us/articles/22731903751316-Health-Connect). [MyFitnessPal](https://support.myfitnesspal.com/hc/en-us/articles/360032273352-Data-Export-FAQs) exports meal nutrition, progress, and exercise CSV files for Premium accounts. [CaloriAI](https://www.caloriai.com/) derives editable ingredients and amounts from a meal photo. [Nibby](https://www.nibby.app/) accepts photo, barcode, text, and voice capture. | Store the meal photo, the user's description, each inferred component, nutrient-source references, model and prompt versions, confidence, assumptions, and user revisions. |
| Strength training | [Hevy's API](https://api.hevyapp.com/docs/) exposes workouts, workout events, routines, exercise templates, exercise history, and measurements. The API is marked experimental and requires Hevy Pro. Hevy also documents [workout and measurement CSV export](https://help.hevyapp.com/hc/en-us/articles/38001424401943-How-to-Import-Strong-App-CSV-Files-and-Export-Your-Data-in-Hevy). | Build native workout, exercise, set, and plan records first. Add CSV import before account-linked sync, then retain API payloads and deletion events through connector runs. |
| Platform-independent food capture | Photo-based products differ on source retention. [Nourli](https://nourli.health/) describes confidence and provenance while stating that submitted photos are not stored. | Retain source photos by default, include them in native archives, and expose a clear per-file delete control. Later models can reprocess the same evidence without rewriting prior revisions. |

## Lessons from existing products

### A useful record survives a service failure

CaloriAI demonstrates the value of editable ingredient and amount estimates. A [public account of its 2025 login outage](https://note.com/ryojihido/n/ne5f3a1b6b09a) linked the developer's request for subscribers to cancel while recovery was delayed. Data export, offline-safe capture, migration, monitoring, and a readable native archive therefore belong in the product's core reliability work.

### Source priority needs a visible rule

Nutrition and wearable products warn about duplicated activity when several connected services report the same movement. A preferred-source setting should affect summaries while preserving each underlying claim. The setting belongs to a data type and time range because one provider may be preferred for sleep while another is preferred for strength workouts.

### Records need correction after the day has passed

People forget to confirm doses, wearables misclassify sleep, imports use the wrong timezone, and food models estimate portions incorrectly. A correction should create a revision with actor, time, reason when supplied, and the prior value. The corrected record drives summaries immediately.

### A photo estimate is a structured hypothesis

A food image alone rarely identifies ingredients, preparation method, portion weight, or hidden fats with certainty. The proposal should contain visible alternatives and confidence at the component level. The person can confirm a dish, change its amount, split it into components, add packaging or menu evidence, or leave nutrients unknown.

### Clinical exchange and personal tracking have different shapes

FHIR represents prescribed medication, reported medication use, and actual administration with distinct resources. FHIR R5 introduces [NutritionIntake](https://fhir.hl7.org/fhir/nutritionintake.html) as a food or fluid event; it remains Trial Use and did not exist in R4. Health Tracker should map to FHIR at the boundary while retaining a native schema suited to personal timelines, raw sources, corrections, and connector reconciliation.

## Canonical record layers

| Layer | Purpose | Required properties |
| --- | --- | --- |
| Profile | Identifies the person whose body the records describe | Stable ID, locale, timezone, demographic claims, access policy |
| Concept | Identifies a reusable thing such as a medication, food, exercise, symptom, or metric | Native ID, names, codes when known, code-system version, free-text fallback |
| Plan | Describes an intended regimen, target, routine, or schedule | Effective period, recurrence rule, status, author, revision |
| Event | Describes something that happened or was reported | Effective instant or period, local date, status, quantities, links to concepts and plans |
| Claim | Carries an assertion from a person, device, provider, import, or model | Claim type, payload schema version, claimant, confidence when applicable, revision |
| Source artifact | Preserves evidence and machine-readable input | MIME type, byte count, checksum, storage state, capture time, source URI or filename |
| Provenance | Explains how a claim or artifact arrived and changed | Origin kind, provider, external ID, source version, source timestamps, actor, transform version |
| Import batch | Groups a bounded ingestion operation | Provider, started and completed times, cursor, counts, warnings, rollback state |
| Equivalence link | Groups claims that may describe one real-world occurrence | Member IDs, match basis, confidence, reviewer, reversible status |
| Derived result | Stores a reproducible summary or estimate | Inputs and revisions, algorithm or model version, parameters, generated time, uncertainty |

[FHIR Provenance](https://hl7.org/fhir/R4/provenance.html) provides a useful exchange model for creation, revision, deletion, and import transformations. [DocumentReference](https://hl7.org/fhir/R4/documentreference.html) can point to preserved source documents. These resources guide boundary mappings; the native archive carries the full product record.

## Medicine data model

### Medication concept

- display name and user aliases;
- ingredient, strength, form, route, and product identifiers when known;
- free-text representation for compounded, regional, traditional, or uncoded products;
- source and code-system version for every normalized identifier;
- photos of packaging, labels, prescriptions, and instructions.

### Regimen and schedule

- intended dose quantity, unit, route, and site;
- start and end conditions;
- fixed times, intervals, selected weekdays, repeating cycles, tapered phases, and as-needed rules;
- relation to meals, sleep, symptoms, measurements, or procedures;
- prescriber and prescription evidence when supplied;
- reminder policy stored separately from the medical instruction.

### Dose occurrence

- planned time and actual time;
- taken, skipped, missed, delayed, partially taken, held, or unknown state;
- actual amount, route, site, reason, symptoms, and note;
- schedule revision used to create the planned occurrence;
- actor and source, including caregiver or imported device;
- correction history without a time limit.

### Inventory

- dispense, purchase, manual adjustment, dose consumption, disposal, and transfer transactions;
- quantity and unit with lot and expiry when supplied;
- refill threshold and expected depletion as derived values;
- reconciliation against a physical count.

Medication interaction, contraindication, and dose guidance require licensed or authoritative drug data, jurisdiction context, and a reviewed safety policy. Reminder delivery can begin once schedule and dose-event recovery tests are in place.

## Food and energy data model

### Intake event

- meal or snack label, start time, duration when known, timezone, and local date;
- dishes and components with amounts, units, preparation details, and free text;
- calories, macro nutrients, micro nutrients, water, alcohol, caffeine, and other measured constituents;
- separate source, confidence, and uncertainty for each amount and nutrient;
- photos, labels, receipts, menus, barcodes, recipes, and the original message;
- inclusion state for daily totals, with a visible explanation for exclusions.

### Inference run

- immutable input artifact references and checksums;
- provider, model, model version, prompt or extractor version, and execution time;
- structured candidate dishes, components, amounts, nutrients, alternatives, and confidence;
- user-confirmed output stored as a new claim revision;
- reprocessing linked to the earlier run so estimates can be compared.

### Exercise and expenditure

- workout session with start, end, timezone, title, notes, and source;
- ordered exercises with exercise identity and equipment;
- sets with type, weight, repetitions, duration, distance, pace, resistance, RPE, RIR, and completion state;
- workout plan and performed workout stored as separate records;
- energy-expenditure estimate linked to the workout, estimator, body inputs, and confidence;
- basal, active, and workout energy categories kept distinct to prevent double counting.

A connector-provided calorie value and a locally calculated value can coexist as separate derived claims. Daily totals select an explicit preferred estimate and retain the alternatives.

## Connector contract

Every connector record carries:

- `originKind`, such as `manual`, `import`, `connector`, `agent`, or `model`;
- `originProvider`, a stable lowercase provider key;
- `originAccountId`, stored as an encrypted or one-way reference where possible;
- `originExternalId` and source version or update token;
- source-created, source-updated, effective, imported, and observed timestamps;
- raw payload or retained artifact reference with checksum;
- transform name and version;
- import-batch ID and sync cursor;
- source deletion or tombstone state;
- links to related native claims and equivalence groups.

The provider and external-ID tuple is unique within a profile and data type. Incremental sync applies source updates through revisions. A provider deletion records a tombstone and follows the account holder's configured retention rule. Disconnecting a provider removes credentials and scheduled sync while preserving imported claims.

Connector credentials stay outside profile archives. Archive manifests retain provider keys, external IDs, payload artifacts, and import history.

## Import and export priority

| Priority | Surface | Import path | Export path | Delivery rule |
| --- | --- | --- | --- | --- |
| Available | Health Tracker archive | ZIP or JSON restore with checksums and stable merge IDs | Versioned ZIP with all retained files; JSON manifest | Round-trip tests cover every supported entity and file. |
| Available | MCP | OAuth-authorized claim and measurement writes | Scoped read tools with revision history | Grants are profile-scoped, revocable, and read-only by default. |
| Available, partial | Apple Health export | Browser-streamed `export.xml` mapping for selected measurements | Native archive and downstream formats | Expand through typed mappings while listing every unhandled Apple type. |
| Available | Native exercise records | Manual session and reusable-plan entry | Native archive | Keep provider mappings outside the canonical workout, exercise, and set records. |
| Available | Hevy workout CSV | Reviewed import into native workouts with retained source rows and source file | Versioned native archive | File checksums, time-zone interpretation, derived source identity, conflict protection, and one-file transactions support retries. |
| Next connector | Hevy API | API-key connector with workout-event cursors | User-authorized writes after read sync is stable | Treat the experimental API as an optional transport and preserve raw responses. |
| Later | HealthKit bridge | Permissioned iOS reads and anchored queries | Permissioned writes for supported data types | Provide per-type consent, source visibility, and retry-safe background sync. |
| Later | Health Connect bridge | Android record reads with change tokens | Permissioned writes for supported data types | Respect platform retention and history-access rules; import into the native record. |
| Later | Clinical records | SMART on FHIR, FHIR bundles, C-CDA, and document upload | FHIR bundle, C-CDA where mapped, PDF summaries | Keep original bundles and documents alongside normalized claims. |
| Later | Nutrition services | Cronometer and MyFitnessPal CSV adapters; generic food CSV mapping | Human-readable CSV and native archive | Preserve source rows and allow user-defined column mapping. |
| Later | Public API | OAuth 2.1 REST resources and webhooks | Same API with scoped writes | Version schemas, publish rate limits, use idempotency keys, and provide audit logs. |

### User export paths from other products

- Apple Health: Health → profile picture or initials → **Export All Health Data**. Import the resulting ZIP or `export.xml` through **Import Data**. Apple documents the export in [Share your data in Health on iPhone](https://support.apple.com/guide/iphone/share-your-health-data-iph5ede58c3d/ios).
- Hevy: Profile → Settings → **Export & Import Data** → **Export Data** → **Export Measurements** or **Export Workouts**. The [Hevy help article](https://help.hevyapp.com/hc/en-us/articles/38001424401943-How-to-Import-Strong-App-CSV-Files-and-Export-Your-Data-in-Hevy) also states that Hevy's own CSV importer accepts English exports from Strong.
- Cronometer: Settings → Account → Account Data → **Export Data**. Select a date range and include servings, exercises, biometrics, and notes. See [Cronometer account settings](https://support.cronometer.com/hc/en-us/articles/360018760151-Account-Settings).
- MyFitnessPal Premium: open Nutrition or Progress and choose **Export**. The emailed ZIP contains meal nutrition, progress, and exercise CSV files. See [MyFitnessPal Data Export FAQs](https://support.myfitnesspal.com/hc/en-us/articles/360032273352-Data-Export-FAQs).

Each importer should show detected format, profile destination, date range, counts by record type, unknown columns or types, duplicates, conflicts, and files before confirmation. Completion should provide an import-batch ID, counts, warnings, and an undo action.

## Delivery sequence

1. Native workout, exercise, set, and workout-plan records with revisions and archive support — available.
2. Hevy workout CSV import with review, repeat identity, retained source files, and conflict protection — available.
3. Medicine product catalog with ingredients, presentations, identifiers, jurisdictions, and sourced locale labels.
4. Treatment courses, effective-dated regimens, scheduled dose occurrences, and administration records with correction history.
5. Suspected adverse-effect records, adherence calculations, and medication reminders with delivery history.
6. Medication inventory transactions and refill projections.
7. Wider Apple Health XML coverage for workouts, nutrition, sleep, and source metadata.
8. Generic connector-run, cursor, payload, warning, and tombstone storage.
9. Native HealthKit and Health Connect bridges.
10. Provenance-aware meal-photo proposals with component-level review.
11. FHIR and C-CDA clinical import followed by standards-based export.
12. Evidence-linked summaries and advice with explicit safety review.

Every slice includes schema migration, ownership checks, input limits, archive round trips, import idempotency where relevant, user-visible correction, tests, production backup, deployment, and smoke verification.

## Brand screen

The working product name remains **Health Tracker** until a replacement is approved.

### Recommended candidate: WholeRecord

`WholeRecord` uses ordinary English, describes a record that spans the person's health, and carries no regional or cultural framing. The display name can use **WholeRecord** with a descriptive store subtitle such as **Personal health record**.

Preliminary checks on 2026-08-15 found:

- no exact-name health product in general web, Apple App Store, or Google Play searches;
- `wholerecord.app` and `wholerecord.health` returned “not found” from their registry RDAP services;
- `wholerecord.com` is registered and appears parked;
- basic indexed searches showed no exact `WholeRecord` result from USPTO or EUIPO pages.

`My Whole Record` and `Your Whole Record` are plain-English backups. Their `.com`, `.app`, and `.health` registry lookups returned “not found” on the same date. They are more descriptive and may receive narrower trademark protection.

Registry status can change at any time. Search-engine and app-store checks do not establish trademark availability. Before a paid launch, specialist clearance should cover exact and similar marks, relevant software and health-service classes, launch jurisdictions, company registries, app stores, domains, and social handles. Domain purchase and product renaming should follow approval of the final candidate.
