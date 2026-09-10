# ConnectSphere folder guide

Use this guide to find files and decide where new code belongs. Authentication is implemented; the other feature folders are reserved for future work.

## Project overview

| Folder                 | Purpose                                   |
| ---------------------- | ----------------------------------------- |
| `frontend/`            | React website that users see.             |
| `backend/`             | Express server that handles API requests. |
| `supabase/migrations/` | Future SQL changes for Supabase Cloud.    |
| `tests/e2e/`           | Tests for complete user workflows.        |
| `docs/`                | Team documentation, including this guide. |

Docker runs the frontend on port **5173** and the backend on port **3000**. The database is hosted on **Supabase Cloud**, not in a local Docker container.

## Frontend

The main code lives in `frontend/src/`:

```text
src/
|-- main.jsx             Starts React
|-- App.jsx              Main app component
|-- App.css              App styles
|-- index.css            Global styles
|-- assets/              Images and icons imported by code
|-- components/
|   |-- ui/              Shared buttons, inputs, and dialogs
|   `-- layout/          Shared headers, navigation, and page layouts
|-- features/
|   |-- auth/            Sign-in and authentication
|   |-- events/          Event-related code
|   |   |-- components/  UI used only by events
|   |   |-- pages/       Event pages
|   |   `-- hooks/       React logic used only by events
|   |-- venues/          Venue-related code
|   |-- bookings/        Booking-related code
|   |-- equipment/       Equipment-related code
|   |-- registrations/   Registration-related code
|   `-- notifications/   Notification-related code
|-- hooks/               React logic shared across features
|-- lib/                 Shared API helpers and library setup
|-- routes/              Connects page URLs to pages
|-- styles/              Shared CSS for future use
`-- utils/               General helper functions
```

**Where should new code go?** A shared button belongs in `components/ui/`. An event card belongs in `features/events/components/`. An event page belongs in `features/events/pages/`.

Only events has the example `components/`, `pages/`, and `hooks/` subfolders for now. Keep the other feature folders empty until needed. Existing CSS files stay where they are.

Other files inside `frontend/`:

| File                                          | Purpose                                 |
| --------------------------------------------- | --------------------------------------- |
| `index.html`                                  | HTML page where React loads.            |
| `vite.config.js`                              | Vite development and build settings.    |
| `eslint.config.js`                            | Code quality rules.                     |
| `README.md`                                   | Original React and Vite template notes. |
| `public/favicon.svg`                          | Browser tab icon.                       |
| `public/icons.svg`                            | Static icon asset.                      |
| `src/assets/hero.png`                         | Starter image.                          |
| `src/assets/react.svg`, `src/assets/vite.svg` | Starter logos.                          |

`App.jsx` manages session state and displays the sign-in form or protected account screen. `features/auth/SignIn.jsx` holds the form; `lib/supabase.js` creates the browser Auth client using public configuration from Express.

## Backend

The main code lives in `backend/src/`:

```text
src/
|-- server.js            Loads configuration and starts Express
|-- app.js               Defines public and protected API endpoints
|-- supabase.js          Creates the administrative Supabase client
|-- checkSupabase.js     Separate script to check the cloud connection
|-- auth/                Staff permission policy
|-- config/              Server settings
|-- middleware/          Shared request checks and error handling
|-- modules/             Backend code grouped by feature
|   |-- events/
|   |-- venues/
|   |-- bookings/
|   |-- equipment/
|   |-- registrations/
|   `-- notifications/
|-- routes/              Connects API URLs to backend code
`-- utils/               General helper functions
```

Put business logic in its matching module. For example, booking logic belongs in `modules/bookings/`.

`middleware/requireAuth.js` verifies bearer tokens with Supabase and attaches trusted identity to `req.user`. `GET /api/auth/me` uses it to return the signed-in user. `GET /api/auth/config` exposes only the public project URL and publishable key.

Staff permissions live in `auth/permissions.js`. `middleware/requirePermission.js` enforces them after authentication. `GET /api/internal/access` supplies the account screen's `StaffResponsibilities.jsx`. See [staff access](staff-access.md) before adding internal feature routes or record queries.

The `/api/health` endpoint checks that Express is running. It does not check Supabase. The separate `checkSupabase.js` script checks access through the Supabase Auth admin API.

## Files used by both apps

These files appear inside both `frontend/` and `backend/`:

| File or folder      | Purpose                                                  |
| ------------------- | -------------------------------------------------------- |
| `package.json`      | Lists packages and commands for that app.                |
| `package-lock.json` | Records exact installed package versions.                |
| `Dockerfile`        | Instructions for building and running the app container. |
| `.dockerignore`     | Files to leave out of the Docker build.                  |
| `node_modules/`     | Installed packages managed by npm. Do not edit manually. |

`frontend/dist/` is generated website output: HTML, JavaScript, CSS, and copied images. Edit the source files instead.

## Root files

| File                        | Purpose                                                                                      |
| --------------------------- | -------------------------------------------------------------------------------------------- |
| `docker-compose.yml`        | Runs the frontend and backend containers together.                                           |
| `.env`                      | Private settings passed to the backend, including Supabase credentials. Ignored by Git.      |
| `.env.example`              | Template listing the required settings.                                                      |
| `.gitignore`                | Tells Git which files to ignore. The frontend also has its own `.gitignore`.                 |
| `.github/workflows/ci.yml`  | Automatic frontend, backend syntax/tests, and Docker checks on pushes and pull requests to `main`. |
| `architecture.md`           | Overview of how the project fits together.                                                   |
| `docs/project-structure.md` | This folder guide.                                                                           |

`.git/` stores Git history and internal data. Leave it to Git.

## Tests and database changes

| Folder                       | What goes here                                     |
| ---------------------------- | -------------------------------------------------- |
| `backend/tests/unit/`        | Tests for individual backend functions.            |
| `backend/tests/integration/` | Tests for backend parts working together.          |
| `tests/e2e/`                 | Tests for a complete user journey through the app. |
| `supabase/migrations/`       | Future SQL files for changes to Supabase Cloud.    |

`backend/tests/integration/auth.test.js` and `permissions.test.js` run with Node's built-in test runner through `npm --prefix backend test` and CI. The other test folders and migrations folder remain reserved space. No automatic migrations or local Supabase setup are configured.

Keep the Supabase secret key on the backend, never in frontend code.

**Empty folders are local only:** Git does not track them until files are added, so teammates will not receive empty folders when cloning the repository.
