# Frontend test dashboard and reports

Vitest runs the existing React Testing Library and service tests. The dashboard
shows test names, status, duration and failure details. Tests use simulated DOM
and mocked authentication/API responses; these reports are not evidence of live
Supabase sign-in or cross-browser end-to-end testing. Backend tests continue to
use Node's test runner and are not included in this frontend report.

Run the commands below from the repository root. Choose either local Node or
Docker for each server; both use the same ports.

## Local Node.js

Install dependencies after pulling changes:

```sh
npm --prefix frontend ci
```

Start the live dashboard:

```sh
npm --prefix frontend run test:ui
```

Open the UI URL printed in the terminal (port 51204, path /__vitest__/).
Keep its token query parameter if present. Tests rerun when source files change;
you can also rerun tests from the dashboard. Stop the process with Ctrl+C.

Generate a saved report, then optionally serve it:

```sh
npm --prefix frontend run test:report
npm --prefix frontend run test:report:preview
```

Open http://localhost:4174 for the saved report. Each completed test run,
including normal npm test and the live dashboard, updates frontend/.vitest/index.html.
This is a self-contained file you can open directly in a browser or share.
Copy it elsewhere to keep a particular run before the next run overwrites it.
Failures still produce a report and the test command exits nonzero.
The preview serves the last saved results; it does not run tests.

## Docker

Refresh the frontend image, dependencies and port mappings once after pulling
these changes (the existing backend is left running):

```sh
docker compose up -d --build --renew-anon-volumes frontend
```

Start the dashboard in a terminal:

```sh
docker compose exec -e CHOKIDAR_USEPOLLING=true frontend npm run test:ui -- --api.host 0.0.0.0
```

Open the printed UI URL using localhost instead of 0.0.0.0 and keep the token.
Polling detects file edits through Docker Desktop bind mounts. Stop with Ctrl+C.
The dashboard supports rerunning tests; editing files and updating snapshots
through the API are disabled. Docker publishes the dashboard only on localhost.

To generate a report without starting the live dashboard:

```sh
docker compose exec frontend npm run test:report
```

The frontend bind mount saves the report to frontend/.vitest/index.html on your
computer too. Open that file directly, or start the preview:

```sh
docker compose exec frontend npm run test:report:preview -- --host 0.0.0.0
```

Open http://localhost:4174. This port is also published only on localhost.
Avoid running a separate report command while a dashboard run is in progress,
since both update the same report file.

## Generated files

The .vitest directory is excluded from Git, ESLint and Docker build contexts.
UI assets and results are embedded into the HTML; no extra report folder needs
to accompany the file. Keep @vitest/ui and vitest on matching versions when
upgrading dependencies.
