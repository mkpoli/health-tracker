# Health Tracker

Health Tracker is a multilingual SvelteKit app for storing health profiles, importing lab results, tracking measurements, and managing medicine and energy claims over time.

## Features

- Manage multiple patient profiles
- Add records manually or extract them from images, PDFs, and pasted text
- Review and edit parsed metrics before saving
- Track trends with localized dates and translated UI
- Keep editable medicine plans with revision history
- Record food intake and energy expenditure with retained source photos
- Run on Cloudflare with SQLite/Turso-backed data storage
- Connect an AI assistant to the data through an MCP server

## AI assistants

An assistant that speaks the Model Context Protocol reads the data over
Streamable HTTP at `/mcp`. The app is the OAuth 2.1 authorization server for
those connections and Auth0 identifies the person, so a connection is scoped to
the profiles chosen on the consent screen. The grant never expands to the whole
account.

Set `MCP_TOKEN_SECRET` — a long random string, separate from
`AUTH0_SESSION_SECRET` so agent tokens can be revoked on their own — and push
the schema so the `mcp_client`, `mcp_grant` and `mcp_auth_code` tables exist:

```sh
bun run db:push
```

In the assistant, add `https://<host>/mcp` as a connector. It opens the consent
screen, where the account holder picks the profiles it may read, demographic
sharing, measurement writes, and medicine or energy writes. Reference-range
selection uses assigned gender at birth and age; withholding them yields general
ranges. Connections are listed and withdrawn under **Connected assistants**.

Ten tools read: `list_patients`, `get_health_summary`, `get_metric_history`,
`list_reports`, `get_report`, `search_metrics`, `get_reference_ranges`,
`list_medicines`, `list_energy_entries`, and `get_claim_history`.

Five tools write. `log_measurement` requires `health:write`.
`create_medicine`, `update_medicine`, `log_energy_entry`, and
`update_energy_entry` require `health:claims:write`. The consent screen grants
these scopes separately. Existing measurement-write grants retain their original
capability. The two creation tools require a `request_id` for retry safety.
Updates require the current revision so a newer edit cannot be overwritten.
Laboratory results continue through the uploaded report review flow.

Uploaded documents, calorie photos, and the R2 bucket holding them stay outside
the MCP grant. Energy tools report how many source files are retained.

Backup, restore, Apple Health import, MCP client flow, and connector identity are documented in [Data portability](docs/data-portability.md).

## Development

Install dependencies and start the dev server:

```sh
bun install
bun run dev
```

Useful commands:

```sh
bun run check
bun run test
bun run build
bun run preview
```

## Tests

`bun run test` covers the read model in `src/lib/health/` and, in
`src/lib/metrics/`, the parts of the metric library that carry a judgement: unit
normalization, reference-range selection, freshness, derived values, and the
rules deciding whether a reading may be called high or low and whether a series
may be given a direction. The catalogs themselves — `body.ts`, `vitals.ts`,
`catalog.ts`, `labels.ts` — are data and are not covered.

These are the functions a page render and a connected assistant both read, so a
wrong answer here is a wrong answer in both places.

## Tech Stack

- SvelteKit + Svelte 5
- Tailwind CSS
- Paraglide for i18n
- Drizzle ORM
- Cloudflare Workers
