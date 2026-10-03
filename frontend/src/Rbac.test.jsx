// @vitest-environment jsdom
import { createRequire } from "node:module";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { MemoryRouter, Route, Routes, useParams } from "react-router";
import App from "./App";
import { getAuthClient } from "./lib/supabase";
import AuthProvider from "./features/auth/AuthProvider";
import { useAuth } from "./features/auth/useAuth";
import RequireAuth from "./routes/RequireAuth";
import RequirePermission from "./routes/RequirePermission";
import SignInPage from "./routes/SignInPage";

// Exercise the REAL pure permission policy. Only Auth/network transport is faked.
// This test-only Node import is never part of the frontend application bundle.
const require = createRequire(import.meta.url);
const { getPermissions, getResponsibilities } = require("../../backend/src/auth/permissions.js");

vi.mock("./lib/supabase", () => ({ getAuthClient: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

const session = { access_token: "rbac-test-token", user: { id: "unverified-sdk-id" } };
const response = (body) => ({ status: 200, ok: true, json: async () => body });

function setup(roles, { profile = {}, initialSession = session, permissions } = {}) {
  const identity = {
    id: "verified-rbac-id", email: "staff@client.sg", fullName: "Verified Staff",
    roles, accountTypes: ["internal"], ...profile,
  };
  getAuthClient.mockResolvedValue({ auth: {
    onAuthStateChange: vi.fn((callback) => {
      queueMicrotask(() => callback("INITIAL_SESSION", initialSession));
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
  } });
  const fetchMock = vi.fn(async (url) => {
    if (url === "/api/auth/me") return response({
      user: identity, permissions: permissions === undefined ? getPermissions(roles) : permissions,
    });
    if (url === "/api/internal/access") return response({ responsibilities: getResponsibilities(roles) });
    throw new Error("Unexpected test request: " + url);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, identity };
}

function renderStaffPage() {
  return render(<MemoryRouter initialEntries={["/staff/responsibilities"]}><App /></MemoryRouter>);
}

const labels = {
  "venues.read": "Venue information and availability",
  "bookings.read": "Venue booking information",
  "equipment.read": "Equipment information and availability",
  "technical_requests.read": "Technical requirements and arrangements",
  "event_planning.read": "Internal event planning",
  "attendees.read": "Event registration information",
  "clients.read": "Client information for managed events",
  "event_organisers.read": "Event organiser information for managed events",
};

test("[RBAC-ROLE-001] Venue Staff see venue and booking responsibilities only", async () => {
  const { fetchMock } = setup(["venue_staff"]);
  renderStaffPage();
  const list = await screen.findByRole("list");
  expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
    labels["venues.read"], labels["bookings.read"],
  ]);
  for (const permission of ["equipment.read", "technical_requests.read", "event_planning.read", "attendees.read", "clients.read"]) {
    expect(screen.queryByText(labels[permission])).toBeNull();
  }
  expect(fetchMock).toHaveBeenCalledWith("/api/internal/access", expect.objectContaining({
    headers: { Authorization: "Bearer rbac-test-token" }, cache: "no-store", signal: expect.any(AbortSignal),
  }));
});

test("[RBAC-ROLE-002] Technical Support Staff see equipment and technical responsibilities only", async () => {
  setup(["technical_support_staff"]);
  renderStaffPage();
  const list = await screen.findByRole("list");
  expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
    labels["equipment.read"], labels["technical_requests.read"],
  ]);
  for (const permission of ["venues.read", "bookings.read", "event_planning.read", "attendees.read", "clients.read"]) {
    expect(screen.queryByText(labels[permission])).toBeNull();
  }
});

test("[RBAC-ROLE-003] Event Coordinator sees the current coordination permission set", async () => {
  setup(["event_coordinator"]);
  renderStaffPage();
  const list = await screen.findByRole("list");
  expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual(Object.values(labels));
});

test("[RBAC-ROLE-004] Multiple staff roles combine responsibilities without duplicate entries", async () => {
  setup(["venue_staff", "technical_support_staff", "venue_staff", "attendee"]);
  renderStaffPage();
  const list = await screen.findByRole("list");
  expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
    labels["venues.read"], labels["bookings.read"], labels["equipment.read"], labels["technical_requests.read"],
  ]);
  expect(screen.queryByText(labels["clients.read"])).toBeNull();
});

// Real guards with test-only child content. No unfinished business pages are invented.
function ProtectedFixture({ onRender }) {
  const { user } = useAuth();
  const { resourceId } = useParams();
  onRender();
  return <section>
    <h1>Restricted fixture</h1>
    <p>Identity: {user.id}</p>
    <p>Resource: {resourceId}</p>
  </section>;
}

function renderFeature(permission, path = "/fixture/resource-b") {
  const onRender = vi.fn();
  render(<MemoryRouter initialEntries={[path]}>
    <AuthProvider>
      <Routes>
        <Route path="/sign-in" element={<SignInPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<RequirePermission permission="internal.access" />}>
            <Route element={<RequirePermission permission={permission} />}>
              <Route path="/fixture/:resourceId" element={<ProtectedFixture onRender={onRender} />} />
            </Route>
          </Route>
          <Route path="/forbidden" element={<h1>Access denied</h1>} />
        </Route>
      </Routes>
    </AuthProvider>
  </MemoryRouter>);
  return { onRender };
}

// Expected outcomes are independent fixtures, not calculated from the policy under test.
const roleMatrix = [
  { role: "venue_staff", allowed: ["venues.read", "bookings.read"] },
  { role: "technical_support_staff", allowed: ["equipment.read", "technical_requests.read"] },
  { role: "event_coordinator", allowed: ["venues.read", "bookings.read", "equipment.read", "technical_requests.read", "event_planning.read", "attendees.read", "clients.read", "event_organisers.read"] },
  { role: "event_organiser", allowed: [] },
  { role: "attendee", allowed: [] },
  { role: "event_ops_manager", allowed: ["event_organisers.read"] },
];
const guardCases = roleMatrix.flatMap(({ role, allowed }, roleIndex) =>
  Object.keys(labels).map((permission, permissionIndex) => ({
    id: `RBAC-GUARD-${String(roleIndex * 8 + permissionIndex + 1).padStart(3, "0")}`,
    title: `${role} ${allowed.includes(permission) ? "may" : "may not"} open a ${permission} page`,
    role, permission, permitted: allowed.includes(permission),
  })),
);

test.each(guardCases)("[$id] $title", async ({ role, permission, permitted }) => {
  setup([role]);
  const { onRender } = renderFeature(permission);
  if (permitted) {
    expect(await screen.findByRole("heading", { name: "Restricted fixture" })).toBeTruthy();
    expect(screen.getByText("Identity: verified-rbac-id")).toBeTruthy();
    expect(onRender).toHaveBeenCalled();
  } else {
    expect(await screen.findByRole("heading", { name: "Access denied" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Restricted fixture" })).toBeNull();
    expect(onRender).not.toHaveBeenCalled();
  }
});

test.each([
  ["RBAC-SCOPE-001", "venue_staff", "venues.read", "unassigned-venue", { venue_id: "assigned-venue" }],
  ["RBAC-SCOPE-002", "venue_staff", "venues.read", "east-location", { location: "West" }],
  ["RBAC-SCOPE-003", "technical_support_staff", "equipment.read", "microphone", { equipment_type: "projector" }],
  ["RBAC-SCOPE-004", "technical_support_staff", "equipment.read", "north-location", { location: "South" }],
])("[%s] %s page guard permits %s for %s despite unrelated profile metadata", async (_id, role, permission, resource, metadata) => {
  setup([role], { profile: metadata });
  renderFeature(permission, "/fixture/" + resource);
  expect(await screen.findByRole("heading", { name: "Restricted fixture" })).toBeTruthy();
  expect(screen.getByText("Resource: " + resource)).toBeTruthy();
  // This covers guard eligibility only; actual resource API/RLS scope needs backend tests.
});

test.each([
  ["RBAC-DENY-001", "no roles", []],
  ["RBAC-DENY-002", "unknown role", ["superadmin"]],
  ["RBAC-DENY-003", "prototype-like role", ["__proto__"]],
])("[%s] %s cannot mount a protected child", async (_id, _title, roles) => {
  setup(roles);
  const { onRender } = renderFeature("venues.read");
  await screen.findByRole("heading", { name: "Access denied" });
  expect(onRender).not.toHaveBeenCalled();
});

test("[RBAC-DENY-004] Anonymous direct access redirects before loading identity or mounting protected content", async () => {
  const { fetchMock } = setup([], { initialSession: null });
  const { onRender } = renderFeature("venues.read");
  expect(await screen.findByLabelText("Email address")).toBeTruthy();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(onRender).not.toHaveBeenCalled();
});

test("[RBAC-DENY-005] Unverified SDK role and permission claims cannot elevate the verified external user", async () => {
  setup(["attendee"], { initialSession: {
    ...session, user: { id: "unverified-sdk-id", app_metadata: { roles: ["event_coordinator"] }, permissions: ["internal.access", "venues.read"] },
  } });
  const { onRender } = renderFeature("venues.read");
  await screen.findByRole("heading", { name: "Access denied" });
  expect(onRender).not.toHaveBeenCalled();
});

test.each([
  ["RBAC-DENY-006", "missing permissions", undefined],
  ["RBAC-DENY-007", "null permissions", null],
  ["RBAC-DENY-008", "string permissions", "internal.access,venues.read"],
  ["RBAC-DENY-009", "object permissions", { "internal.access": true, "venues.read": true }],
  ["RBAC-DENY-010", "non-string permission entries", [true, { permission: "internal.access" }, ["venues.read"]]],
])("[%s] %s grant no protected page access", async (_id, _title, permissions) => {
  const { fetchMock, identity } = setup(["venue_staff"]);
  fetchMock.mockResolvedValue(response({ user: identity, permissions }));
  const { onRender } = renderFeature("venues.read");
  await screen.findByRole("heading", { name: "Access denied" });
  expect(onRender).not.toHaveBeenCalled();
});

test("[RBAC-DENY-011] Internal access alone does not grant a feature permission", async () => {
  setup(["venue_staff"], { permissions: ["internal.access"] });
  const { onRender } = renderFeature("venues.read");
  await screen.findByRole("heading", { name: "Access denied" });
  expect(onRender).not.toHaveBeenCalled();
});

test("[RBAC-DENY-012] Unknown feature permissions deny access even to coordinators", async () => {
  setup(["event_coordinator"]);
  const { onRender } = renderFeature("unknown.read");
  await screen.findByRole("heading", { name: "Access denied" });
  expect(onRender).not.toHaveBeenCalled();
});
