# Data portability

Health Tracker uses a versioned profile archive for backup and transfer. A profile remains usable with its native records after a connector is removed.

## Health Tracker archives

| File | Structured records | Retained files | Main use |
| --- | --- | --- | --- |
| ZIP | Included | Included with byte counts and SHA-256 checksums | Backup, transfer, and recovery |
| JSON | Included | Manifest entries only | Inspection and structured-data transfer |

The archive contains:

- profile details;
- reports and recorded values;
- medicine ingredients, packaged products, localized names, identifiers, provenance, and saved catalog versions;
- current medicine plans and saved plan revisions;
- calorie intake and energy expenditure entries, their saved revisions, and meal photos;
- exercise definitions, workout sessions, reusable workout plans, nested sets, and saved revisions;
- import records and retained source files, including Hevy workout CSV files;
- retained report sources, including scans and PDFs.

Account credentials, connected-assistant grants, and connector credentials live outside a profile archive.

### Export a profile

1. Sign in and select the profile.
2. Choose **Export Health Archive** on the profile dashboard.
3. Keep the downloaded ZIP in storage appropriate for health records.

The export stops if a retained file cannot be read. This prevents a successful-looking ZIP with silently omitted source files.

### Restore a profile

1. Sign in and select the destination profile.
2. Choose **Import Data**.
3. Select a Health Tracker ZIP or JSON file.
4. Review the counts for reports, values, medicines, calories, workouts, saved versions, and retained files.
5. Select **Replace this profile's details** when the archived name, birthday, assigned sex at birth, and profile settings should replace the destination profile values.
6. Choose **Restore**.

Profile replacement stays off by default. The structured import runs in bounded batches. ZIP media is read one file at a time, checked against its recorded size and checksum, then stored under the destination profile.

### Merge behavior

- A restore back into its source profile keeps the original entity IDs.
- A restore into another profile creates stable IDs from the destination profile, source profile, entity type, and source ID.
- Repeating the same restore reuses those IDs and fills missing records.
- Provider and external IDs identify calorie and workout records that already arrived through a connector.
- Existing current records retain their local values when identities meet. Missing historical revisions are added.
- Restoring an existing catalog entry keeps its stored names and identifiers.
- Existing retained files remain in place. A missing storage object can be repaired from the ZIP.
- A current-format ZIP requires byte counts and SHA-256 checksums for every retained file.

Each retained file may be up to 50 MB. JSON restoration leaves retained-file entries unresolved because JSON carries the manifest without file bytes. The review and completion screens report missing files. Native archive rollback currently uses the normal edit and delete controls for each imported record.

Messages used to prepare Medicine or Calories drafts are copied into the claim's Notes field before review. A saved message is included in claim revisions and native archives. The user can edit or remove it in the review form.

## Native workout records

The Calories section stores workout sessions and reusable plans in Health Tracker. Each workout contains ordered exercises and sets. A set can retain load, repetitions, duration, distance, effort, state, type, and notes. Exercise names, categories, and equipment are copied into the workout snapshot so historical records stay readable after the exercise catalog changes.

Choosing **Use plan** creates an editable session linked to its source plan. Session edits create saved revisions containing the full nested exercise and set structure.

Archive version 8 restores medicine ingredients before products and medicine plans, source imports and exercise definitions before workouts, and saved revisions after their current records.

## Hevy workout CSV import

Hevy documents its export path as **Profile → Settings → Export & Import Data → Export Data → Export Workouts**. See [How to Import Strong App CSV Files and Export Your Data in Hevy](https://help.hevyapp.com/hc/en-us/articles/38001424401943-How-to-Import-Strong-App-CSV-Files-and-Export-Your-Data-in-Hevy).

To import the workout export:

1. Open the profile's **Calories** section.
2. In **Workouts**, choose **Import Hevy CSV**.
3. Select the workout CSV.
4. Select the IANA time zone represented by the file.
5. Review workout, exercise, set, row, date-range, unit, warning, and error counts.
6. Confirm the import.

Hevy CSV timestamps have no time-zone field. One selected time zone applies to the entire file. A daylight-saving gap blocks the import. A repeated wall-clock time uses its earlier occurrence and appears as a warning.

The importer accepts UTF-8 CSV files up to 10 MB and 10,000 data rows. It handles quoted commas, quoted line breaks, CRLF, UTF-8 BOM, metric or imperial load columns, and kilometre, metre, mile, or yard distance columns. Unknown columns stay in each raw source row. An unknown set type is stored as `other`, with the original value retained.

Every row is validated before a database write. An error blocks the file. Database changes for one file use one transaction. The original CSV is stored privately, and each workout set carries its raw source row. The profile archive includes the import metadata and CSV bytes.

The file checksum and selected time zone identify a completed import. Repeating that pair reuses the prior result and repairs a missing source object when the CSV is supplied again. A later export can update a workout created by an earlier Hevy import. A workout with newer local edits is reported as a conflict and keeps those edits. The CSV format supplies no workout ID, so the importer derives workout identity from the local start time and normalized title. The source row and derived identity remain available for review.

## Apple Health import

Apple documents the export path as **Health → Summary → profile picture or initials → Export All Health Data**. Choose a sharing destination for the generated ZIP. See [Share your data in Health on iPhone](https://support.apple.com/guide/iphone/share-your-health-data-iph5ede58c3d/ios).

To import that export:

1. Select a Health Tracker profile and choose **Import Data**.
2. Select Apple's ZIP or its `export.xml` file.
3. Review the date range, mapped measurements, and untracked Apple data types.
4. Confirm the import.

The browser streams the XML and sends mapped daily sessions in bounded batches. Repeating an Apple import updates the same day-and-category sessions. **Undo this import** removes sessions tagged with the Apple Health source.

The current mapping covers body mass, height, lean body mass, body-fat percentage, waist circumference, systolic and diastolic blood pressure, heart rate, resting heart rate, heart-rate variability, oxygen saturation, respiratory rate, body temperature, and blood glucose. It keeps the last mapped reading of each day for each measurement. The review lists Apple types outside this mapping. Medications, workouts, nutrition, sleep, routes, and source attachments remain outside the current Apple import.

## Agent access through MCP

The external agent endpoint is:

```text
https://<host>/mcp
```

An MCP client can add that URL directly. OAuth opens in the browser. The consent screen selects profiles, demographic sharing, measurement writes, and medicine or energy writes. Connections can be reviewed or revoked under **Connected assistants**.

The server publishes OAuth discovery at:

```text
https://<host>/.well-known/oauth-protected-resource
https://<host>/.well-known/oauth-authorization-server
```

It supports public-client dynamic registration, authorization code flow with PKCE S256, short-lived access tokens, rotating refresh tokens, and three scopes: `health:read`, `health:write`, and `health:claims:write`. Direct clients send JSON-RPC over Streamable HTTP:

```sh
curl 'https://<host>/mcp' \
  -H 'Authorization: Bearer <access-token>' \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Read access exposes `list_patients`, `get_health_summary`, `get_metric_history`, `list_reports`, `get_report`, `search_metrics`, `get_reference_ranges`, `list_medicine_catalog`, `get_medicine_catalog_entry`, `get_medicine_catalog_history`, `read_medicine_catalog_source`, `list_medicines`, `get_medicine_plan`, `list_energy_entries`, `get_claim_history`, and `list_dose_occurrences`.

An existing `health:claims:write` grant also permits creating and updating catalogue ingredients and products for its selected profiles, including names, identifiers, composition, and retained source data. No new consent is requested for these catalogue tools.

A grant with `health:write` exposes `log_measurement` for body measurements and vital signs. A separate `health:claims:write` grant exposes these tools:

- `create_medicine_ingredient` and `update_medicine_ingredient` manage reusable active ingredients.
- `create_medicine_product` and `update_medicine_product` manage packaged or compounded products linked to those ingredients.
- `create_medicine` creates a medicine together with its first course and dose regimen in one write; a medicine never exists without a rule that says when it is taken. `update_medicine` changes the catalog fields. The optional `product_id` links the medicine to an exact product in the product catalog.
- `set_regimen`, `update_regimen` and `update_course` change the dose plan behind a medicine; `get_medicine_plan` reads it and needs no write scope.
- `log_energy_entry` and `update_energy_entry` manage food intake and energy expenditure. Exercise can be recorded as `direction: "expenditure"` with optional duration and kilocalories.

The consent screen grants each write scope independently. Connections created before claim writes existed retain their measurement capability and require fresh consent for `health:claims:write`.

`create_medicine_ingredient`, `create_medicine_product`, `create_medicine`, `set_regimen` and `log_energy_entry` require a caller-generated `request_id` of up to 128 characters. The identifier is scoped to the MCP client, selected profile, and claim type. A retry with the same identifier returns the existing claim. Reusing it with different values still returns the first stored claim.

`create_medicine` requires `start_date` and a `regimen`: `fixed_slots` with one to twelve slots anchored to a clock time, waking, a meal or bedtime; `interval` with `interval_hours` and `anchor_at`; or `as_needed`. The regimen takes the profile timezone and the course start date unless the call says otherwise. The response carries the medicine, its course and its regimen, and `list_dose_occurrences` plans from them at once.

`get_medicine_plan` reads one medicine's courses and regimens with their ids and revisions; slots come back in the shape the write tools accept, so a read can be edited and sent back. `set_regimen` starts a new rule on the open course from `regimen.effective_from`, closing the previous rule the day before (a rule starting the same day is corrected with `update_regimen` instead), and gives a medicine without a course its first one, or a restart course after an ended one. `update_regimen` corrects one rule in place under `expected_revision`; a slot keeps its key, and a new slot never receives a key the rule has used before, so recorded doses stay attached to the slot they were taken under. `update_course` changes a course's status and dates under its own `expected_revision`: `ended` needs `end_date`, `active` starts a planned or held course. The catalog status changes separately through `update_medicine`. `get_claim_history` reads the saved versions of courses (`medicine_course`) and regimens (`dose_regimen`) as well as medicines and energy entries.

Update calls require `expected_revision` from a previous read. A concurrent edit causes a revision-conflict result carrying the current revision. The caller reads the record again before proposing another change. Medicine plan and energy versions appear in `get_claim_history` with their change source. Ingredient and product versions appear in `get_medicine_catalog_history`.

Energy timestamps require ISO form with `Z` or a numeric UTC offset. The profile's IANA timezone is used when the call omits `timezone`. Day filters on `list_energy_entries` use each entry's retained local date. Totals include recorded entries with known kilocalories; drafts and excluded entries remain visible according to the selected filters.

Medicine claims describe the catalog; the dose plan lives on courses and regimens, and dose-taking events on occurrences. MCP energy tools expose retained-file counts while source photos and their storage URLs remain private. Photo capture and analysis continue through the application.

### Product catalog workflow for agents

1. Call `list_medicine_catalog` with the selected `patient_id`. A search checks normalized canonical names, product display names, and localized names within a bounded page. Pass `next_ingredient_id` and `next_product_id` back as `after_ingredient_id` and `after_product_id` until both are null, including after empty search pages. Counts describe the current page. For entry identity, revision, and complete child rows, call `get_medicine_catalog_entry` with `entity_kind` and `entity_id`. Each collection accepts `names_offset`/`names_limit`, `identifiers_offset`/`identifiers_limit`, or `ingredients_offset`/`ingredients_limit` (default 5, maximum 30; zero skips it). Pass each `next_*_offset` back until null; offsets refer to stored child positions. Assemble pages only while `entry.revision` stays unchanged.
2. Create each reusable ingredient with `create_medicine_ingredient`. `names` may carry BCP 47 language tags, name type, country, preferred status, and source details. `identifiers` may carry RxNorm, YJ, HOT, GS1, Wikidata, or another declared code system.
3. Create the packaged product with `create_medicine_product`. Each item in `ingredients` uses an `ingredient_id` from step 2. Structured strengths use numerator and denominator values with units. `strength_text` preserves the label wording.
4. Pass the returned `product_id` to `create_medicine` when a medicine concerns that exact product. The medicine keeps its own editable name, form, strength and route.

Catalog update tools accept selected fields and keep omitted fields unchanged. Updating `names`, `identifiers`, or `ingredients` replaces that collection, so a caller should send the complete desired collection. Every update requires `expected_revision`. The list tool returns the child row IDs needed to preserve a name, identifier, or ingredient component across an update.

`source_data` accepts JSON up to 2 MB on ingredient and product writes. It is suitable for a retained terminology response or regulator payload when the caller has permission to store it. Catalog reads return `source_data_summary: {available, byte_size}`; `source_data` is reserved for write payloads. `read_medicine_catalog_source` returns bounded JSON chunks with a SHA-256 checksum and continuation offset; an optional `revision` reads the payload saved with that version. Name, identifier, and ingredient-component rows carry their own source type, provider, URL, and retrieval time. Public database labels remain attributed to their source and language.

History pages return `next_before_revision`; pass it as `before_revision` to read older versions. A response marked `truncated` may omit list entries or shorten text. Read the needed entry with a narrower request before using it in an update.

The MCP endpoint and versioned archive are the supported external integration surfaces. Page actions and retained-file routes serve the web application and may change with its implementation.

## Connector identity contract

Optional connectors should attach these fields to each imported claim:

- `originKind`: the ingestion class, such as `connector` or `import`;
- `originProvider`: a stable provider key;
- `originExternalId`: the provider's stable record ID;
- source timestamps, raw payloads, and media needed for later review.

The provider and external ID pair makes repeated syncs idempotent. Health Tracker keeps the native claim and its revision history after connector access ends. Apple Health XML and Hevy workout CSV files are available through file import. Direct HealthKit sync and account-linked Hevy API sync remain future connector work.
