# Health Tracker

Health Tracker is a multilingual SvelteKit app for storing patient profiles, importing lab results, and tracking clinical metrics over time.

## Features

- Manage multiple patient profiles
- Add records manually or extract them from images, PDFs, and pasted text
- Review and edit parsed metrics before saving
- Track trends with localized dates and translated UI
- Run on Cloudflare with SQLite/Turso-backed data storage
- Connect an AI assistant to the data through an MCP server

## AI assistants

An assistant that speaks the Model Context Protocol reads the data over
Streamable HTTP at `/mcp`. The app is the OAuth 2.1 authorization server for
those connections and Auth0 identifies the person, so a connection is scoped to
the profiles chosen on the consent screen rather than to the whole account.

Set `MCP_TOKEN_SECRET` — a long random string, separate from
`AUTH0_SESSION_SECRET` so agent tokens can be revoked on their own — and push
the schema so the `mcp_client`, `mcp_grant` and `mcp_auth_code` tables exist:

```sh
bun run db:push
```

In the assistant, add `https://<host>/mcp` as a connector. It opens the consent
screen, where the account holder picks the profiles it may read and whether
assigned gender at birth and age go with them; reference-range selection needs
those two, and withholding them yields general ranges. Connections are listed
and withdrawn under **Connected assistants**.

Seven read-only tools are served: `list_patients`, `get_health_summary`,
`get_metric_history`, `list_reports`, `get_report`, `search_metrics` and
`get_reference_ranges`. Uploaded documents, the R2 source bucket and every
write path stay out of reach.

## Development

Install dependencies and start the dev server:

```sh
bun install
bun run dev
```

Useful commands:

```sh
bun run check
bun run build
bun run preview
```

## Tech Stack

- SvelteKit + Svelte 5
- Tailwind CSS
- Paraglide for i18n
- Drizzle ORM
- Cloudflare Workers
