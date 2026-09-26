# UI reference

The frontend as it is on `Staging`: the shell, the three layout modes, the palette, shared classes and components,
and the patterns every screen follows. Route-by-route behaviour lives in
[../../docs/frontend-routing.md](../../docs/frontend-routing.md).

This describes the current UI, not plans for it. When a change makes something here untrue, fix it here in the same
commit.

## Shell

`App.jsx` renders one shell for every page:

```
.app-shell
  header.brand          green "C" mark + "ConnectSphere"
  main[.wide | .venue-workspace]
    aside.intro         eyebrow "EVENT PLANNING & VENUE BOOKING", headline, tagline (hidden in full-width mode)
    <Routes/>           the page, usually a section.card inside WorkspaceLayout
  footer                "ConnectSphere Event Services"
```

`WorkspaceLayout` (every signed-in page) renders `nav.workspace-nav[aria-label="Workspace"]` with a `NavLink` per
permitted feature, then the page (`<Outlet/>`), then `SignOutButton`. The link order is Account, Browse events,
My registrations, then feature links, then Responsibilities. Each link is behind the same `hasPermission` checks as
its route.

## Layout modes

`main` switches layout by path in `App.jsx`:

| Mode | Class | Used by | Shape |
|---|---|---|---|
| Default | none | sign-in, account, events, registrations, responsibilities | Two columns: intro `1fr`, page `440px` |
| Wide form | `main.wide` | `/events/new` | Intro `1fr`, page `560px` |
| Full workspace | `main.venue-workspace` | `/venues/*`, `/equipment/*`, `/technical-support`, `/events/assignments` | One column up to 1160px, intro hidden |

A new list, table, calendar or dashboard page adds its path to the `fullWorkspace` condition in `App.jsx`. A single
form or detail card stays in the default mode. Everything collapses to one column at **≤ 760px**.

## Palette

Global colours are literal hex in `index.css` / `App.css`, with no global custom properties. Reuse these values
exactly; don't introduce a second primary colour.

| Role | Value |
|---|---|
| Brand / primary button / links | `#185c4b` (hover `#104a3b`) |
| Page background | `#f4f6f5` |
| Card background | `#ffffff`, border `#e0e7e2`, radius 18px, shadow `0 14px 45px #153e2b08` |
| Text | `#152c37` |
| Muted text | `#61716f`, `#66756f`, `#748179` |
| Eyebrow / accent text | `#426e60` |
| Input border | `#cbd7d0`; dividers `#e7ece8` |
| Hover tint / selected | `#f9fbfa` / `#f2f8f4` with `#a2bbb0` border |
| Focus ring | `3px solid #56a993` (global) or `2px solid #185c4b` (nav, list items) |
| Error | text `#97372c` on `#fff2ee`; invalid input border `#c08279` |
| Success | text `#0a5c36` on `#e3f4ea` |
| Pending / warning | text `#7a5800` on `#fef3cd` |
| Neutral / withdrawn | text `#5e6d65` on `#f0f0f0` |

Font: `"Segoe UI", Arial, sans-serif`. Headings are weight 600 with negative letter-spacing. Eyebrows are 10–11px,
weight 700, uppercase, letter-spacing ~1.6–1.9px.

`features/venues/venues.css` defines scoped tokens (`--v-primary`, `--v-danger`, the slot-state colours, …) under
`.venues`, derived from the same palette. That scoping pattern (tokens on the feature root, resets for the global
bare-element rules) is the one to copy if a feature needs many colours.

## Shared classes (`App.css`)

| Class | Use |
|---|---|
| `.card` | The page container for default-mode pages. `h1` + `.eyebrow` inside |
| `.eyebrow` | Small uppercase label above a heading |
| `.primary` / `.secondary` | Full-width buttons (override `width: auto` for inline use) |
| `.error` | Block-level error message, pair with `role="alert"` |
| `.field-error`, `.field-hint`, `.field-required`, `.field-pair` | Form field helpers; `.field-pair` is a 2-column row that stacks on mobile |
| `.form-section` | Titled group inside a long form |
| `.status-line` | One-line progress text ("Submitting…") |
| `.event-summary`, `.account-details` | `<dl>` read-only detail lists with dividers |
| `.status-badge` (+ `.status-<status>`) | Pill for event status. Labels come from `StatusBadge.jsx`'s `LABELS` |
| `.card-note` | Small footnote under a card |
| `.visually-hidden` | Screen-reader-only text (in `events.css`) |

Global bare-element rules apply everywhere: `input { width: 100% }`, `label { display: block }`, `form { margin-top: 30px }`.
Scope feature CSS under a feature root class and reset these where they get in the way (checkboxes, radios, inline
forms), as `venues.css` does.

## Feature stylesheets

One CSS file per feature, imported by that feature's pages: `features/<f>/<f>.css`. Prefix its classes with a
short feature name (`.assign-…`, `.eq-…`, `.registration-card__…`) so they can't collide. Don't add feature rules
to `App.css`.

## Shared components

| Component | Use |
|---|---|
| `components/ui/Modal.jsx` | Native `<dialog>` with title, content, OK button. Focus trap, Escape and backdrop come built in |
| `components/ui/ErrorModal.jsx` | Modal for a blocked action (403) or any error better shown as a dialog |
| `features/events/components/StatusBadge.jsx` | Event status pill; unknown statuses render their raw value |
| `features/registrations/components/RegistrationStatusBadge.jsx` | Registration status pill |
| `features/auth/SignOutButton.jsx` | Rendered once by `WorkspaceLayout` |

Confirmations before destructive actions follow `WithdrawButton.jsx`: an inline confirm step, not `window.confirm`.

## Patterns every screen follows

- **States**: loading text, an empty state (`.assign-empty` style: dashed border, muted text, and what to do next),
  an error with a retry action, then content. Never a blank area.
- **Copy**: sentence case, plain English, second person. Errors say what happened and what to do next. Titles
  name the task ("Assign coordinators"), not the data model.
- **Status is text first**: badges always carry a word; colour is a hint.
- **Forms**: native validation attributes (`required`, `type="email"`, `maxLength`) plus server errors shown against
  their field with `aria-invalid` and `.field-error`. Disable the form while submitting. Keep entered values after
  a failed submit, except passwords.
- **Tables**: `<caption>`, `<thead>` with small uppercase headers, numeric columns right-aligned with tabular
  numbers, selected row tinted.
- **Mobile**: check at 375px wide. No horizontal page scroll; wide tables scroll inside their own container.
