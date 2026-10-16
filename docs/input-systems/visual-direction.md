> **Status note (2026-10-16).** This specification was written on 2026-08-15 against an earlier version of the app and has not been revised. The routes and navigation below do not match the app on `main`:
>
> - Navigation on `main` is one dashboard at `/[[tab=dashboardTab]]` with the tabs Lab results (`/`), Body (`/body`), Vitals (`/vitals`), Medicine (`/medicine`), Activity (`/activity`) and Calories (`/calories`). The selected profile is the `?patientId=` query, not a path segment.
> - There are no `/patients/[patientId]/today`, `/records`, `/medicine`, `/calories` or `/assistant` routes, no patient-scoped layout, and no Today or Assistant destination. Under `/patients/[patientId]/` only `extract` and `reports/[reportId]/review` exist.
> - The compatibility redirects proposed for old links do not apply; the dashboard tab routes were built instead.
> - Parts already built in another shape: dose plans (courses, regimens, occurrences) and the Medicine tab, a Calories tab, Hevy import, and MCP medicine tools. No separate Agent Worker exists.
> - Mockup images referenced from `visual-direction.md` (`assets/medicine-desktop-light.png`, `assets/calories-mobile-dark.png`) are not in the repository because of their size.

# Visual direction

These reference boards extend the current navy, teal, blue-gray, white, and amber language. Their names, dates, foods, and medication details are illustrative. Production fixtures use neutral seeded profiles.

## Medicine on desktop

![Medicine desktop reference](./assets/medicine-desktop-light.png)

The desktop layout uses a persistent left navigation rail, a spacious Medicine workspace, and a contextual Assistant rail. The selected medication destination receives the strongest navy treatment. Teal marks confirmed events. Amber marks due items and estimate review. Blue-gray marks future items.

Production adjustments:

- add the Future view beside Today, Plans, and History;
- use “No record” for an elapsed occurrence without an event;
- place skipped, missed, and uncertain states behind an accessible action menu;
- show local timezone near the date control when it differs from the profile timezone;
- let the Assistant rail collapse below 1280 px;
- keep plan cards factual and omit an adherence score;
- replace any patient name in design fixtures with a neutral profile label.

## Calories on mobile

![Calories mobile reference](./assets/calories-mobile-dark.png)

The mobile layout keeps the daily summary compact and gives meal capture a direct thumb path. The photo-review sheet shows a total range, an uncertainty reason, editable dish rows, and a conversational correction field. The five-item bottom navigation remains visible during capture.

Production adjustments:

- show a target bar only when an effective target exists;
- label each item’s estimate or database basis in its detail row;
- keep workout energy empty when its source supplies no value;
- keep the bottom sheet below the safe-area inset;
- allow the review sheet to expand to a full page for keyboard and screen-reader use;
- retain text equivalents for every color-coded state.

## Responsive layout

| Width | Navigation | Main content | Assistant |
| --- | --- | --- | --- |
| 1280 px and above | 216 px left rail | Center column up to 960 px | Optional 360–400 px right rail |
| 768–1279 px | Compact left rail or top destinations | One main column | Overlay drawer |
| Below 768 px | Fixed five-item bottom bar | Full-width cards | Bottom sheet or full destination |

The primary labels remain Today, Records, Medicine, Calories, and Assistant. Records owns the existing All metrics, Lab, Body, and Vitals controls. Domain-specific view selectors stay inside their destination.

## Color tokens

The current interface uses many direct Tailwind colors. A theme PR moves shared surfaces to semantic custom properties before dark mode ships.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--canvas` | `#f4f8fb` | `#07111f` | Page background |
| `--surface` | `#ffffff` | `#101d2d` | Cards and panels |
| `--surface-raised` | `#f8fafc` | `#152538` | Sheets and raised rows |
| `--text` | `#0f172a` | `#f8fafc` | Primary text |
| `--text-muted` | `#64748b` | `#94a3b8` | Secondary text |
| `--border` | `#dbe4ee` | `#2a3a4e` | Dividers and card borders |
| `--accent` | `#0f766e` | `#5eead4` | Selected navigation and confirmed state |
| `--accent-soft` | `#ccfbf1` | `#123c3a` | Confirmed-state background |
| `--info` | `#2563eb` | `#93c5fd` | Future and informational state |
| `--attention` | `#b45309` | `#fbbf24` | Due, uncertain, and estimate review |
| `--danger` | `#b91c1c` | `#fca5a5` | Destructive confirmation only |

Contrast is verified against WCAG AA for text and interactive controls. Amber never carries meaning without text or an icon. Destructive red is reserved for account, connection, attachment, or record deletion confirmations.

## Type and spacing

- Use the existing sans-serif stack.
- Page title: 36–48 px desktop, 28–32 px phone.
- Section title: 20–24 px.
- Card title: 16–18 px with a 600–700 weight.
- Body: 14–16 px.
- Metadata: 12–14 px with sufficient contrast.
- Use an 8 px spacing grid, 12 px card radii, and 16–24 px card padding.
- Keep interactive targets at least 44 px in both dimensions.

Numeric values use tabular numerals. Medication units and nutrient units stay attached to their values. Localized formatting controls decimal separators, dates, and time.

## Component patterns

### Timeline row

A timeline row has a time column, identity block, state label, and primary action. It supports keyboard focus, an expanded detail region, and a menu. State icons have screen-reader text.

### Review card

A review card contains a title, source summary, editable fields, uncertainty block, confirm action, edit action, and discard action. Confirmation text names the exact record that will be created or changed.

### Summary card

Summary cards show factual totals and coverage. They avoid radial progress rings, streaks, scores, praise, and failure copy. Empty states explain the next available action.

### Photo row

The thumbnail has a descriptive alt label or is marked decorative when the adjacent title supplies the content. The original photo opens in a protected viewer. Removing a photo does not remove the confirmed meal unless the person chooses that separate action.

### Assistant composer

The composer includes text, camera, send, stop, and attachment-removal controls. During streaming it shows a stop action. During processing it names the operation, such as “Reviewing meal photo.” It preserves a draft when the sheet closes.

## Motion

Sheets use the existing short rise animation. Confirmation can use a brief color transition and status-icon change. Reduced-motion preference removes transforms and animated progress. Streaming text avoids a cursor animation that competes with screen readers.

## Empty and error states

Empty Medicine state: “Add a medication plan to see today’s schedule.”

Empty Calories state: “Capture a meal, describe it, or enter items.”

Photo uncertainty: “Portion size needs review.”

Medication gap: “No record for this time.”

Workout energy gap: “This source did not include energy.”

Errors name a recovery action. They do not discard typed text, selected images, or pending edits. Authorization failures return to the profile selector without exposing whether another patient’s record exists.

## Visual verification set

Each UI PR captures and reviews:

- desktop light at 1440 × 1000;
- desktop dark at 1440 × 1000;
- phone light at 390 × 844;
- phone dark at 390 × 844;
- 200% browser zoom;
- long English text;
- representative Japanese text;
- representative Simplified Chinese text;
- keyboard focus order;
- reduced motion;
- empty, loading, processing, validation, offline, and expired-draft states.

Seed data covers tablets, liquid medicine, injection, a pause, a future plan change, a corrected event, an uncertain event, a multi-dish meal, an unknown portion, a database match, a Hevy workout without energy, and a user-entered target.
