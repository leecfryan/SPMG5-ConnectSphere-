# UI reference

The frontend as it is on `staging`: the shell, the three layout modes, the palette, shared classes and components,
and the patterns every screen follows. Route-by-route behaviour lives in
[../../docs/frontend-routing.md](../../docs/frontend-routing.md).

This describes the current UI, not plans for it. When a change makes something here untrue, fix it here in the same
commit.

## Shell

`App.jsx` retains all routes and guards. It renders a skip-to-content link, the
ConnectSphere wordmark with a small brand caption, `main#main-content` and the footer.
Guest sign-in and session-error recovery retain the introductory two-column layout.
Pending session checks use a neutral workspace skeleton instead of the guest intro.

Every signed-in page uses the same `WorkspaceLayout`: permission-filtered icon
navigation, `.workspace-content` containing the unchanged route outlet, and the
existing sign-out action. Navigation and sign-out share a `.workspace-sidebar`
wrapper that sticks as one unit above 760px. On mobile the wrapper uses
`display: contents`, keeping navigation above the page and sign-out below it.
Navigation destinations, order and permission checks
are unchanged. Icon paths live in `components/ui/Icon.jsx` and are decorative.

## Layout modes

| Mode | Shape |
|---|---|
| Guest | Intro plus a 440px sign-in/session-error panel, stacked at 760px |
| Session loading | Workspace-sized sidebar/content placeholders while access is checked; no protected content or navigation |
| Signed-in desktop | 208px sidebar plus flexible page content, within a 1536px shell |
| Compact desktop | 176px sidebar from 761px through 1099px |
| Collapsed desktop | 64px icon navigation; the page gains the released space |
| Mobile, 760px and below | Expanded two-column navigation above the page; no collapse control |

The sidebar's Collapse/Expand button exposes `aria-expanded` and `aria-controls`.
Collapsed links retain explicit accessible names; their visible label appears on
hover and focus. Collapse is local presentation state for the mounted workspace,
survives navigation within it, and resets after reload/sign-out. It does not
remount the route outlet or discard entered form values. At phone width the
navigation is always expanded, even when resized from a collapsed desktop.

The existing `fullWorkspace` path detection in App.jsx is retained for compatibility.
The signed-in CSS layout uses `main:has(.workspace)` instead of adding route cases.
Feature styles remain scoped to their existing roots. Venue and Equipment retain
their own layouts and actions inside the wider content column.

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
| Radius | `--cs-radius-sm` 8px for controls, `--cs-radius-lg` 16px for cards, `--cs-radius-pill` |
| Elevation | `--cs-shadow-sm`, `--cs-shadow-md`, `--cs-shadow-lg` |
| Type | `--cs-font`, `--cs-font-mono`, `--cs-text-xs` 12px to `--cs-text-3xl` 36px |
| Decorative | `--cs-hero`, `--cs-hero-text`, `--cs-hero-muted`, `--cs-art-*` for abstract editorial artwork |
| Other | `--cs-focus`, `--cs-transition`, `--cs-overlay` |

Rules for a new screen:

- **Two radii only.** A control is `--cs-radius-sm`, a card is `--cs-radius-lg`, a badge is a pill. Nothing else.
- **One primary.** A second green would stop `--cs-primary` meaning "the main action".
- **Status is a pair.** `--cs-danger` on `--cs-danger-soft`, never a text colour on an unrelated tint.
- **Spacing comes from the scale.** If a gap wants 18px, use 16px or 24px.
- **Don't restyle a control that already works.** Inputs, buttons, badges and cards are styled globally in
  `App.css`; a feature stylesheet adds layout, not a second button.

The font stack prefers locally available Inter, then Segoe UI and system sans fonts via `--cs-font`. There is no font download or new dependency. Focus is one
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


## Attendee presentation (30 October 2026)

- `/events`: an emerald editorial hero and three-column event cards on large
  screens, two at intermediate widths and one on phones. The artwork is abstract
  decoration, never presented as a photograph of a venue or event.
- Discovery filters operate only on the authorised server result: name/description
  search, venue city, local-calendar from-date (inclusive), availability and name/date
  sorting. Missing dates sort last; unknown capacity is not claimed as available.
  No price/category controls appear because the existing public payload has neither.
  No matches and empty catalogues have distinct recovery actions; outages have retry.
- Event details retain all existing registration-window, capacity, waitlist and
  submission hooks. A sticky desktop summary holds the event/date/availability and
  original form. The progress indicator reflects the existing two-stage process:
  details and registration saved. On smaller screens the summary flows below the
  event and venue information. Contextual help explains status and withdrawal.
- My registrations adds counts, an explore link and All/Pending/Confirmed/Withdrawn
  filter buttons. Offers and waitlist entries remain visible regardless of the
  registration filter, so filtering cannot conceal a time-sensitive offer.
- Registration details name the event and date where supplied. Existing status,
  submitted details, withdrawal restrictions and confirmation remain unchanged.

There are no new backend capabilities, payment steps, QR codes, ticket downloads,
saved events, transfers, host claims, map integrations or trend claims. Those need
separate feature requirements. Form handlers, API helpers, auth and permission
policies, state hooks and route declarations are preserved.


### Session-loading presentation

`features/auth/AuthStatus.jsx` renders `.workspace.auth-loading` while the existing
session/access verification is pending. This opts into the shared workspace shell
and hides the guest intro without changing App.jsx or routing. `features/auth/auth.css`
provides non-interactive, aria-hidden sidebar, banner, toolbar and card placeholders.
The real status text remains announced through `role="status"`; the existing
conditional sign-out action remains available outside the decorative placeholders.
No user details, permission-based links or protected pages render before verification.
Pulse/spinner motion is disabled for reduced-motion preferences. The existing error,
retry and sign-out paths are retained. No tests were run for this follow-up, per
Ryan's explicit instruction.


### Local Docker refresh

The frontend Vite development server polls source files every 500ms. The Windows
Docker bind mount was observed to contain the new AuthStatus source while Vite
still served its cached old transform. Polling in frontend/vite.config.js avoids
relying on missed native change events. A frontend-only container restart clears
the existing transform cache; no image rebuild, dependencies or backend restart
are needed for this presentation update. This is a development-server setting.


The My event requests navigation entry uses the shared `request` SVG (a document
with a folded corner and text lines), distinguishing requests from the My Events
calendar. The sticky sidebar wrapper applies to expanded and collapsed desktop
modes; it preserves the existing nav labels, permission checks, sign-out handler
and route outlet.


### Event-request list cards

The organiser's requests and private drafts use `.event-request-list` in the
existing events workspace stylesheet. Each row is a single keyboard-accessible
link with a document icon, a plain slate heading, a grouped status/assignment/
ownership line and a View request or Continue draft affordance. The link name
comes from the heading; metadata supplies its accessible description. Existing
destinations and guards remain unchanged. Draft rows use a muted surface and
dashed border, while section headings show visually separate counts. The shared
EventList presentation also keeps assigned-event rows consistent. At narrow
widths metadata and the open affordance wrap without truncating long titles.
Activity-history and safety-review lists retain their existing styling: the new
rules are scoped to the additional event-request-list class.


### Event-request detail presentation

EventWorkspaceDetailPage now scopes its layout under `.event-request-detail`:
separated back/refresh navigation; title/status/reference header; start/end/
attendance summary cards; about, registration, planning requirements and
coordinator panels; decision/history cards; and existing management controls.
The coordinator UUID is retained inside an expandable reference rather than
being the main coordinator label. Event times use the existing local formatWhen
helper. The saved/edit/review/resubmit/safety/assignment/arrangement/postpone/
cancel guards and callbacks remain in place.

ChangeRequestControls keeps its original state, eligibility checks and submit
handler. Its pending panel presents the stored reason and submission time, then
Current versus Requested values, formatting datetime fields through formatWhen.
Current means the event payload presently displayed, not a historical snapshot.
The closed action and open form use the shared control styles; long forms have
two desktop columns and stack on phones. Activity expansion remains unchanged.
No backend/API changes or additional requests are introduced. No tests were run
for this presentation follow-up, following Ryan's instruction.


### Sign-out landing behavior

The auth guard owns sign-out navigation. The auth provider marks signed-out
sessions so the guard clears return state, while the button only invokes sign-out.
Initial protected deep links still preserve their destination. After sign-in,
unavailable return pages fall back to `/account`; ordinary signed-in visits to
restricted pages still show Access denied. The fallback marker is bound to the
current verified identity snapshot and becomes stale on reload or re-verification,
so later revocation cannot reuse it. Permission checks happen before any
protected outlet renders. A remembered `/forbidden` return URL also falls back to
Account. No tests were run for this follow-up. Details are in the routing guide.
