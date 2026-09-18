// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { getAuthClient } from "./lib/supabase";
import App from "./App";
import { StrictMode } from "react";
import { MemoryRouter, useLocation, useNavigate } from "react-router";

vi.mock("./lib/supabase", () => ({ getAuthClient: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

const session = { access_token: "test-session-token", user: { email: "unverified@client.sg" } };
const verifiedUser = {
  id: "verified-user", email: "verified@client.sg", fullName: "Verified Person",
  roles: ["attendee"], accountTypes: ["external"],
};
const reply = (status, body) => ({ status, ok: status === 200, json: async () => body });

function setup(initialSession = null, identity = verifiedUser, permissions = []) {
  let onAuthChange;
  const unsubscribe = vi.fn();
  const auth = {
    onAuthStateChange: vi.fn((callback) => {
      onAuthChange = callback;
      queueMicrotask(() => callback("INITIAL_SESSION", initialSession));
      return { data: { subscription: { unsubscribe } } };
    }),
    signInWithPassword: vi.fn(async () => {
      onAuthChange("SIGNED_IN", session);
      return { error: null };
    }),
    signOut: vi.fn(async () => {
      onAuthChange("SIGNED_OUT", null);
      return { error: null };
    }),
  };
  getAuthClient.mockResolvedValue({ auth });
  const fetchMock = vi.fn().mockImplementation(async (url) => {
    if (url === "/api/auth/me") return reply(200, { user: identity, permissions });
    if (url === "/api/internal/access") return reply(200, {
      responsibilities: [{ permission: "venues.read", label: "Venue information and availability", requiresRecordCheck: false }],
    });
    throw new Error("Unexpected API request: " + url);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { auth, fetchMock, unsubscribe, emit: (event, value) => onAuthChange(event, value) };
}

function NavigationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return <>
    <output data-testid="location">{location.pathname + location.search + location.hash}</output>
    <button onClick={() => navigate(-1)}>Browser back</button>
    <button onClick={() => navigate(1)}>Browser forward</button>
  </>;
}

function renderApp(entries = ["/"], strict = false) {
  const content = <MemoryRouter initialEntries={entries}><App /><NavigationProbe /></MemoryRouter>;
  return render(strict ? <StrictMode>{content}</StrictMode> : content);
}

const staffUser = { ...verifiedUser, roles: ["venue_staff"], accountTypes: ["internal"] };

async function submitSignIn() {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Email address"), "user@client.sg");
  await user.type(screen.getByLabelText("Password", { exact: true }), "SomePassword!");
  await user.click(screen.getByRole("button", { name: "Sign in", exact: true }));
}

test("[AUTH-FLOW-001] Valid sign-in displays the backend-verified identity", async () => {
  const { auth, fetchMock } = setup();
  const user = userEvent.setup();
  renderApp();
  await user.type(await screen.findByLabelText("Email address"), "user@client.sg");
  await user.type(screen.getByLabelText("Password", { exact: true }), "SomePassword!");
  await user.click(screen.getByRole("button", { name: "Sign in", exact: true }));

  expect(await screen.findByText("Welcome, Verified Person.")).toBeTruthy();
  expect(auth.signInWithPassword).toHaveBeenCalledExactlyOnceWith({ email: "user@client.sg", password: "SomePassword!" });
  expect(fetchMock).toHaveBeenCalledWith("/api/auth/me", expect.objectContaining({
    headers: { Authorization: "Bearer test-session-token" }, cache: "no-store",
  }));
  expect(screen.getByText("verified@client.sg")).toBeTruthy();
  expect(screen.queryByText("unverified@client.sg")).toBeNull();
});

test("[AUTH-FLOW-002] Rejected credentials leave protected account information inaccessible", async () => {
  const { auth, fetchMock } = setup();
  auth.signInWithPassword.mockResolvedValue({ error: { status: 400 } });
  const user = userEvent.setup();
  renderApp();
  await user.type(await screen.findByLabelText("Email address"), "user@client.sg");
  await user.type(screen.getByLabelText("Password", { exact: true }), "WrongPassword!");
  await user.click(screen.getByRole("button", { name: "Sign in", exact: true }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(screen.queryByText("You’re signed in")).toBeNull();
});

test.each([["AUTH-FLOW-003", 401], ["AUTH-FLOW-004", 503]])("[%s] Restored session denied with HTTP %s reveals no account data", async (_id, status) => {
  const { fetchMock } = setup(session);
  fetchMock.mockResolvedValue(reply(status, { message: "Private upstream details" }));
  renderApp();
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.queryByText("You’re signed in")).toBeNull();
  expect(screen.queryByText("unverified@client.sg")).toBeNull();
  expect(screen.queryByText("Private upstream details")).toBeNull();
});

test("[AUTH-FLOW-005] Session restoration verifies identity and sign-out survives a simulated reload", async () => {
  const { auth, fetchMock, unsubscribe } = setup(session);
  const user = userEvent.setup();
  const view = renderApp();
  expect(await screen.findByText("Welcome, Verified Person.")).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "Sign out", exact: true }));
  expect(await screen.findByLabelText("Email address")).toBeTruthy();
  expect(auth.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" });
  expect(screen.queryByText("Welcome, Verified Person.")).toBeNull();
  view.unmount();
  expect(unsubscribe).toHaveBeenCalledTimes(1);

  // Simulate the SDK restoring no session after sign-out on a subsequent mount.
  const next = setup(null);
  renderApp();
  expect(await screen.findByLabelText("Email address")).toBeTruthy();
  expect(next.fetchMock).not.toHaveBeenCalled();
});

test("[AUTH-FLOW-006] Token refresh hides the previous identity until verification succeeds", async () => {
  const { emit, fetchMock } = setup(session);
  renderApp();
  expect(await screen.findByText("Welcome, Verified Person.")).toBeTruthy();
  let finish;
  fetchMock.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  act(() => emit("TOKEN_REFRESHED", { access_token: "refreshed-token" }));
  expect(screen.queryByText("Welcome, Verified Person.")).toBeNull();
  expect(screen.getByText("Confirming your access…")).toBeTruthy();
  await act(async () => { finish(reply(401, {})); });
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(screen.queryByText("You’re signed in")).toBeNull();
});

test("[AUTH-FLOW-007] Late verification cannot restore protected content after sign-out", async () => {
  const { emit, fetchMock } = setup(session);
  let finish;
  fetchMock.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  renderApp();
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  act(() => emit("SIGNED_OUT", null));
  await act(async () => { finish(reply(200, { user: verifiedUser })); });
  expect(screen.getByLabelText("Email address")).toBeTruthy();
  expect(screen.queryByText("Welcome, Verified Person.")).toBeNull();
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
});

test("[ROUTE-001] Successful sign-in returns to the requested staff URL", async () => {
  const { fetchMock } = setup(null, staffUser, ["internal.access", "venues.read"]);
  renderApp(["/staff/responsibilities?view=all#list"]);
  await screen.findByLabelText("Email address");
  expect(screen.getByTestId("location").textContent).toBe("/sign-in");
  expect(fetchMock).not.toHaveBeenCalled();
  await submitSignIn();
  expect(await screen.findByText("Venue information and availability")).toBeTruthy();
  expect(screen.getByTestId("location").textContent).toBe("/staff/responsibilities?view=all#list");
});

test.each([
  ["RBAC-ACCESS-001", "external user", verifiedUser, []],
  ["RBAC-ACCESS-002", "internal classification alone", staffUser, []],
  ["RBAC-ACCESS-003", "unrecognised permission", staffUser, ["administrator"]],
  ["RBAC-ACCESS-004", "existing manager policy", { ...staffUser, roles: ["event_ops_manager"] }, ["event_organisers.read"]],
])("[%s] %s cannot access a staff page by URL", async (_id, _name, identity, permissions) => {
  const { fetchMock } = setup(session, identity, permissions);
  renderApp(["/staff/responsibilities"]);
  expect(await screen.findByRole("heading", { name: "Access denied" })).toBeTruthy();
  expect(screen.getByTestId("location").textContent).toBe("/forbidden");
  expect(screen.queryByRole("link", { name: "Responsibilities" })).toBeNull();
  expect(fetchMock).not.toHaveBeenCalledWith("/api/internal/access", expect.anything());
});

test("[RBAC-ACCESS-005] Sign-in to a forbidden return URL still enforces permission", async () => {
  const { fetchMock } = setup();
  renderApp(["/staff/responsibilities"]);
  await submitSignIn();
  expect(await screen.findByRole("heading", { name: "Access denied" })).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("[ROUTE-002] Page navigation and Back/Forward share one verified identity", async () => {
  const { auth, fetchMock } = setup(session, staffUser, ["internal.access", "venues.read"]);
  const user = userEvent.setup();
  renderApp(["/account"]);
  await screen.findByText("Welcome, Verified Person.");
  await user.click(screen.getByRole("link", { name: "Responsibilities" }));
  await screen.findByText("Venue information and availability");
  expect(screen.getByTestId("location").textContent).toBe("/staff/responsibilities");
  await user.click(screen.getByRole("button", { name: "Browser back" }));
  expect(await screen.findByText("Welcome, Verified Person.")).toBeTruthy();
  expect(screen.getByTestId("location").textContent).toBe("/account");
  await user.click(screen.getByRole("button", { name: "Browser forward" }));
  expect(await screen.findByText("Venue information and availability")).toBeTruthy();
  expect(fetchMock.mock.calls.filter(([url]) => url === "/api/auth/me")).toHaveLength(1);
  expect(auth.onAuthStateChange).toHaveBeenCalledTimes(1);
});

test("[ROUTE-003] Browser Back after sign-out cannot reveal protected staff content", async () => {
  setup(session, staffUser, ["internal.access"]);
  const user = userEvent.setup();
  renderApp(["/account"]);
  await user.click(await screen.findByRole("link", { name: "Responsibilities" }));
  await screen.findByText("Venue information and availability");
  await user.click(screen.getByRole("button", { name: "Sign out", exact: true }));
  await screen.findByLabelText("Email address");
  await user.click(screen.getByRole("button", { name: "Browser back" }));
  expect(await screen.findByLabelText("Email address")).toBeTruthy();
  expect(screen.queryByText("Venue information and availability")).toBeNull();
  expect(screen.getByTestId("location").textContent).toBe("/sign-in");
});

test("[RBAC-ACCESS-006] Re-verification removes revoked navigation and page access", async () => {
  const { emit, fetchMock } = setup(session, staffUser, ["internal.access"]);
  renderApp(["/staff/responsibilities"]);
  await screen.findByText("Venue information and availability");
  let finish;
  fetchMock.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  act(() => emit("SIGNED_IN", session));
  expect(screen.queryByText("Venue information and availability")).toBeNull();
  expect(screen.queryByRole("link", { name: "Responsibilities" })).toBeNull();
  await act(async () => { finish(reply(200, { user: verifiedUser, permissions: [] })); });
  expect(await screen.findByRole("heading", { name: "Access denied" })).toBeTruthy();
});

test("[RBAC-ACCESS-007] Backend denial hides staff data despite previously allowed navigation", async () => {
  const { fetchMock } = setup(session, staffUser, ["internal.access"]);
  fetchMock.mockImplementation(async (url) => url === "/api/auth/me"
    ? reply(200, { user: staffUser, permissions: ["internal.access"] })
    : reply(403, { message: "private record details" }));
  renderApp(["/staff/responsibilities"]);
  expect((await screen.findByRole("alert")).textContent).toMatch(/staff access is unavailable/);
  expect(screen.queryByText("private record details")).toBeNull();
  expect(screen.queryByText("Venue information and availability")).toBeNull();
});

test("[AUTH-FLOW-008] Verification outage hides protected routes and permits retry", async () => {
  const { fetchMock } = setup(session);
  fetchMock.mockResolvedValueOnce(reply(503, {}));
  const user = userEvent.setup();
  renderApp(["/account"]);
  await screen.findByRole("alert");
  expect(screen.queryByRole("navigation")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("Welcome, Verified Person.")).toBeTruthy();
});

test("[AUTH-FLOW-009] Authentication initialization failure supports retry", async () => {
  setup();
  getAuthClient.mockRejectedValueOnce(new Error("Private connection details"));
  const user = userEvent.setup();
  renderApp(["/sign-in"]);
  expect((await screen.findByRole("alert")).textContent).toMatch(/couldn’t connect/);
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByLabelText("Email address")).toBeTruthy();
});

test("[AUTH-FLOW-010] Failed sign-out displays a safe message and supports retry", async () => {
  const { auth } = setup(session);
  auth.signOut.mockResolvedValueOnce({ error: new Error("Private provider details") });
  const user = userEvent.setup();
  renderApp(["/account"]);
  await screen.findByText("Welcome, Verified Person.");
  await user.click(await screen.findByRole("button", { name: "Sign out", exact: true }));
  expect((await screen.findByRole("alert")).textContent).toMatch(/couldn’t sign you out/);
  await user.click(screen.getByRole("button", { name: "Sign out", exact: true }));
  expect(await screen.findByLabelText("Email address")).toBeTruthy();
});

test.each([["ROUTE-004", "https://outside.example"], ["ROUTE-005", "//outside.example"], ["ROUTE-006", "/\\outside.example"], ["ROUTE-007", "/SIGN-IN/"], ["ROUTE-008", "/a/../sign-in"]])(
  "[%s] Unsafe or looping return destination %s falls back to account", async (_id, from) => {
    setup(session);
    renderApp([{ pathname: "/sign-in", state: { from } }]);
    await screen.findByText("Welcome, Verified Person.");
    expect(screen.getByTestId("location").textContent).toBe("/account");
  },
);

test("[ROUTE-009] Unknown URL displays a usable not-found page", async () => {
  setup();
  const user = userEvent.setup();
  renderApp(["/does-not-exist"]);
  expect(screen.getByRole("heading", { name: "Page not found" })).toBeTruthy();
  await user.click(screen.getByRole("link", { name: "Go to home" }));
  expect(await screen.findByLabelText("Email address")).toBeTruthy();
});

test("[AUTH-FLOW-011] StrictMode initialization and cleanup preserve session handling", async () => {
  const { unsubscribe } = setup(session);
  const view = renderApp(["/account"], true);
  expect(await screen.findByText("Welcome, Verified Person.")).toBeTruthy();
  view.unmount();
  expect(unsubscribe).toHaveBeenCalled();
});

test("[AUTH-FLOW-012] Successful SDK sign-in waits for backend verification before granting access", async () => {
  const { fetchMock } = setup();
  let finish;
  fetchMock.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  renderApp(["/account"]);
  await submitSignIn();
  expect(screen.getByText("Confirming your access…")).toBeTruthy();
  expect(screen.queryByText("Welcome, Verified Person.")).toBeNull();
  expect(screen.queryByRole("navigation", { name: "Workspace" })).toBeNull();
  expect(screen.queryByText("unverified@client.sg")).toBeNull();

  await act(async () => { finish(reply(200, { user: verifiedUser, permissions: [] })); });
  expect(await screen.findByText("Welcome, Verified Person.")).toBeTruthy();
  expect(screen.getByTestId("location").textContent).toBe("/account");
});

test("[AUTH-FLOW-013] Rejected backend verification blocks access after SDK sign-in succeeds", async () => {
  const { fetchMock } = setup();
  fetchMock.mockResolvedValue(reply(401, { message: "Private rejection details" }));
  renderApp(["/account"]);
  await submitSignIn();
  expect((await screen.findByRole("alert")).textContent).toMatch(/session is no longer valid/);
  expect(screen.queryByRole("navigation", { name: "Workspace" })).toBeNull();
  expect(screen.queryByText("You’re signed in")).toBeNull();
  expect(screen.queryByText("Private rejection details")).toBeNull();
});

test.each([
  ["AUTH-FLOW-014", "missing user", { user: null }],
  ["AUTH-FLOW-015", "missing user ID", { user: { ...verifiedUser, id: undefined } }],
  ["AUTH-FLOW-016", "malformed roles", { user: { ...verifiedUser, roles: "venue_staff" } }],
  ["AUTH-FLOW-017", "malformed account types", { user: { ...verifiedUser, accountTypes: "internal" } }],
])("[%s] A successful HTTP response with %s cannot establish identity", async (_id, _title, body) => {
  const { fetchMock } = setup(session);
  fetchMock.mockResolvedValue(reply(200, body));
  renderApp(["/account"]);
  expect((await screen.findByRole("alert")).textContent).toMatch(/couldn’t verify/);
  expect(screen.queryByText("You’re signed in")).toBeNull();
  expect(screen.queryByRole("navigation", { name: "Workspace" })).toBeNull();
});

test("[AUTH-FLOW-018] A verification network error hides protected content without leaking details", async () => {
  const { fetchMock } = setup(session);
  fetchMock.mockRejectedValue(new Error("Private network trace"));
  renderApp(["/account"]);
  expect((await screen.findByRole("alert")).textContent).toMatch(/couldn’t verify/);
  expect(screen.queryByText("Private network trace")).toBeNull();
  expect(screen.queryByRole("navigation", { name: "Workspace" })).toBeNull();
});

test("[AUTH-FLOW-019] Invalid verification JSON cannot establish an authenticated identity", async () => {
  const { fetchMock } = setup(session);
  fetchMock.mockResolvedValue({ status: 200, ok: true, json: async () => { throw new Error("Private parser details"); } });
  renderApp(["/account"]);
  expect((await screen.findByRole("alert")).textContent).toMatch(/couldn’t verify/);
  expect(screen.queryByText("Private parser details")).toBeNull();
  expect(screen.queryByText("You’re signed in")).toBeNull();
});

test("[AUTH-FLOW-020] A late previous-account response cannot replace the current identity", async () => {
  const { fetchMock, emit } = setup(session);
  let finishOld;
  fetchMock.mockReturnValueOnce(new Promise((resolve) => { finishOld = resolve; }));
  const nextIdentity = { ...verifiedUser, id: "next-id", fullName: "Next Person", email: "next@client.sg" };
  fetchMock.mockResolvedValueOnce(reply(200, { user: nextIdentity, permissions: [] }));
  renderApp(["/account"]);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  act(() => emit("SIGNED_IN", { access_token: "next-token" }));
  expect(await screen.findByText("Welcome, Next Person.")).toBeTruthy();
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);

  await act(async () => { finishOld(reply(200, { user: staffUser, permissions: ["internal.access"] })); });
  expect(screen.getByText("Welcome, Next Person.")).toBeTruthy();
  expect(screen.queryByText("Welcome, Verified Person.")).toBeNull();
  expect(screen.queryByRole("link", { name: "Responsibilities" })).toBeNull();
});

test("[AUTH-FLOW-021] Successful token refresh uses the new token for subsequent authorised requests", async () => {
  const { fetchMock, emit } = setup(session, staffUser, ["internal.access"]);
  const user = userEvent.setup();
  renderApp(["/account"]);
  await screen.findByText("Welcome, Verified Person.");
  act(() => emit("TOKEN_REFRESHED", { access_token: "new-token" }));
  await screen.findByText("Welcome, Verified Person.");
  await user.click(screen.getByRole("link", { name: "Responsibilities" }));
  await screen.findByText("Venue information and availability");
  expect(fetchMock).toHaveBeenCalledWith("/api/auth/me", expect.objectContaining({ headers: { Authorization: "Bearer new-token" } }));
  expect(fetchMock).toHaveBeenCalledWith("/api/internal/access", expect.objectContaining({ headers: { Authorization: "Bearer new-token" } }));
});

test("[AUTH-FLOW-022] Duplicate sign-out clicks send one request and clear access after success", async () => {
  const { auth } = setup(session);
  let finish;
  // No SDK event: successful sign-out must still clear the provider's local identity.
  auth.signOut.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  renderApp(["/account"]);
  await screen.findByText("Welcome, Verified Person.");
  const button = screen.getByRole("button", { name: "Sign out", exact: true });
  act(() => { fireEvent.click(button); fireEvent.click(button); });
  expect(auth.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" });
  expect(screen.getByRole("button", { name: "Signing out…" }).disabled).toBe(true);
  await act(async () => { finish({ error: null }); });
  expect(await screen.findByLabelText("Email address")).toBeTruthy();
  expect(screen.queryByRole("navigation", { name: "Workspace" })).toBeNull();
});
