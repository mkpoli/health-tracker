# Health Tracker

Health Tracker is a multilingual SvelteKit app for storing patient profiles, importing lab results, and tracking clinical metrics over time.

## Features

- Manage multiple patient profiles
- Add records manually or extract them from images, PDFs, and pasted text
- Review and edit parsed metrics before saving
- Track trends with localized dates and translated UI
- Run on Cloudflare with SQLite/Turso-backed data storage

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
