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
- current medicine entries and their saved revisions;
- calorie intake and energy expenditure entries, their saved revisions, and meal photos;
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
4. Review the counts for reports, values, medicines, calories, saved versions, and retained files.
5. Select **Replace this profile's details** when the archived name, birthday, assigned sex at birth, and profile settings should replace the destination profile values.
6. Choose **Restore**.

Profile replacement stays off by default. The structured import runs in bounded batches. ZIP media is read one file at a time, checked against its recorded size and checksum, then stored under the destination profile.

### Merge behavior

- A restore back into its source profile keeps the original entity IDs.
- A restore into another profile creates stable IDs from the destination profile, source profile, entity type, and source ID.
- Repeating the same restore reuses those IDs and fills missing records.
- Provider and external IDs identify calorie or exercise entries that already arrived through a connector.
- Existing current records retain their local values when identities meet. Missing historical revisions are added.
- Existing retained files remain in place. A missing storage object can be repaired from the ZIP.
- A current-format ZIP requires byte counts and SHA-256 checksums for every retained file.

Each retained file may be up to 50 MB. JSON restoration leaves retained-file entries unresolved because JSON carries the manifest without file bytes. The review and completion screens report missing files. Native archive rollback currently uses the normal edit and delete controls for each imported record.

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

Read access exposes `list_patients`, `get_health_summary`, `get_metric_history`, `list_reports`, `get_report`, `search_metrics`, `get_reference_ranges`, `list_medicines`, `list_energy_entries`, and `get_claim_history`.

A grant with `health:write` exposes `log_measurement` for body measurements and vital signs. A separate `health:claims:write` grant exposes these tools:

- `create_medicine` and `update_medicine` manage the current medicine catalog and schedule claims.
- `log_energy_entry` and `update_energy_entry` manage food intake and energy expenditure. Exercise can be recorded as `direction: "expenditure"` with optional duration and kilocalories.

The consent screen grants each write scope independently. Connections created before claim writes existed retain their measurement capability and require fresh consent for `health:claims:write`.

`create_medicine` and `log_energy_entry` require a caller-generated `request_id` of up to 128 characters. The identifier is scoped to the MCP client, selected profile, and claim type. A retry with the same identifier returns the existing claim. Reusing it with different values still returns the first stored claim.

Update calls require `expected_revision` from a previous read. A concurrent edit causes a revision-conflict result carrying the current revision. The caller reads the claim again before proposing another change. Every successful create and update appears in `get_claim_history` with its change source.

Energy timestamps require ISO form with `Z` or a numeric UTC offset. The profile's IANA timezone is used when the call omits `timezone`. Day filters on `list_energy_entries` use each entry's retained local date. Totals include recorded entries with known kilocalories; drafts and excluded entries remain visible according to the selected filters.

Medicine claims describe the catalog, plan, and schedule. Dose-taking events will use a separate event model. MCP energy tools expose retained-file counts while source photos and their storage URLs remain private. Photo capture and analysis continue through the application.

The MCP endpoint and versioned archive are the supported external integration surfaces. Page actions and retained-file routes serve the web application and may change with its implementation.

## Connector identity contract

Optional connectors should attach these fields to each imported claim:

- `originKind`: the ingestion class, such as `connector` or `import`;
- `originProvider`: a stable provider key;
- `originExternalId`: the provider's stable record ID;
- source timestamps, raw payloads, and media needed for later review.

The provider and external ID pair makes repeated syncs idempotent. Health Tracker keeps the native claim and its revision history after connector access ends. Apple Health XML is available through file import. Direct HealthKit sync and a Hevy connector are future connector work.
