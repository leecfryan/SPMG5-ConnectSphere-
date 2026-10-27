# UI reference

The frontend as it is on `staging`: the shell, the three layout modes, the palette, shared classes and components,
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
permitted feature, then the page (`<Outlet/>`), then `SignOutButton`. The link order is Account, Notifications, Browse events,
My registrations, then feature links, then Responsibilities. Each link is behind the same `hasPermission` checks as
its route. Notifications, like Account, is available to every verified signed-in user.

## Layout modes

`main` switches layout by path in `App.jsx`:

| Mode | Class | Used by | Shape |
|---|---|---|---|
| Default | none | sign-in, account, notifications, browse events, registrations, managed events (`/events/managed`), responsibilities | Two columns: intro `1fr`, page `440px` |
| Wide form | `main.wide` | `/events/new` | Intro `1fr`, page `560px` |
| Full workspace | `main.venue-workspace` | `/venues/*`, `/equipment/*`, `/technical-support`, `/my-event-requests/*`, `/assigned-events/*`, `/event-management/*`, `/events/assignments` | One column up to 1160px, intro hidden |

A new list, table, calendar or dashboard page adds its path to the `fullWorkspace` condition in `App.jsx`. A single
form or detail card stays in the default mode. Everything collapses to one column at **≤ 760px**.

## Design tokens

Every colour, space, radius and type size is a custom property on `:root` in `index.css`. **Reference the token;
never repeat a hex code.** Before SCRUM-167 the app had 110 distinct colours and ten corner radii across nine
stylesheets, including a grey ramp, an indigo and an amber borrowed from other design systems. One value changed
here now reaches every screen.

| Group | Tokens |
|---|---|
| Brand | `--cs-primary` (hover `--cs-primary-hover`), `--cs-primary-soft`, `--cs-primary-border`, `--cs-accent` |
| Surfaces | `--cs-bg`, `--cs-surface`, `--cs-surface-muted`, `--cs-surface-sunken` |
| Lines | `--cs-border`, `--cs-border-strong` |
| Text | `--cs-text`, `--cs-text-muted`, `--cs-text-subtle` |
| Status | `--cs-success`, `--cs-warning`, `--cs-danger`, `--cs-info`, `--cs-neutral`, each with a `-soft` tint |
| Spacing | `--cs-space-1` 4px to `--cs-space-8` 64px, on a 4px base |
| Radius | `--cs-radius-sm` 8px for controls, `--cs-radius-lg` 14px for cards, `--cs-radius-pill` |
| Elevation | `--cs-shadow-sm`, `--cs-shadow-md`, `--cs-shadow-lg` |
| Type | `--cs-font`, `--cs-font-mono`, `--cs-text-xs` 12px to `--cs-text-3xl` 34px |
| Other | `--cs-focus`, `--cs-transition` |

Rules for a new screen:

- **Two radii only.** A control is `--cs-radius-sm`, a card is `--cs-radius-lg`, a badge is a pill. Nothing else.
- **One primary.** A second green would stop `--cs-primary` meaning "the main action".
- **Status is a pair.** `--cs-danger` on `--cs-danger-soft`, never a text colour on an unrelated tint.
- **Spacing comes from the scale.** If a gap wants 18px, use 16px or 24px.
- **Don't restyle a control that already works.** Inputs, buttons, badges and cards are styled globally in
  `App.css`; a feature stylesheet adds layout, not a second button.

The font is a system stack via `--cs-font`, so it renders natively everywhere with nothing to download. Focus is one
treatment for every control, set once by the global `:focus-visible` rule.

The exact values live in `index.css` and are deliberately not repeated here: a second copy would go stale.

`features/venues/venues.css` keeps scoped tokens (`--v-primary`, `--v-danger`, the slot-state colours, …) under
`.venues`, but each is now defined from a `--cs-` token rather than its own hex. That is the pattern to copy when a
feature needs many colours of its own: derive from the global tokens, never restate a value.

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
| `.status-badge` (+ `.status-<status>`) | Pill for event status. Labels come from `statusLabels` in `features/events/statuses.js` |
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

### SCRUM-117 clarification presentation

The Under review decision form uses a scoped event-review-decision card with a larger note field, a separate return action explaining notification and retained assignment, and secondary approve/reject controls. Saving disables the note and actions and announces progress. The Changes requested panel uses the existing warning palette, preserves message line breaks, wraps long text and explains Edit, Save changes, then Resubmit request. Resubmission is a separate owner-only action outside edit mode. The coordinator sees the latest immutable before/after comparison with its timestamp. Both layouts stack at 760px and were visually checked at 375px. Styles stay in features/events/workspace.css.

SCRUM-117 saved-edit correction: status appears immediately after the event title. The assigned coordinator sees Saved organiser changes against the submitted/resubmitted baseline on refresh, with decision controls before the long event details. Last resubmission comparisons stay below history and explain that they describe a past submission. Limited-history baselines have explicit labels; missing comparison data is not reported as no changes.
