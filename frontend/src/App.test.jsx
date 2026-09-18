// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
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

test("AC1/AC3: sign-in displays only the identity verified by the backend", async () => {
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

test("AC2: rejected credentials never request protected account information", async () => {
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

test.each([401, 503])("AC2: a restored session denied with %s reveals no account data", async (status) => {
  const { fetchMock } = setup(session);
  fetchMock.mockResolvedValue(reply(status, { message: "Private upstream details" }));
  renderApp();
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.queryByText("You’re signed in")).toBeNull();
  expect(screen.queryByText("unverified@client.sg")).toBeNull();
  expect(screen.queryByText("Private upstream details")).toBeNull();
});

test("AC1: restored sessions are verified again; sign-out and reload remove the account", async () => {
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

test("AC2: token refresh hides the previous account until the new token is verified", async () => {
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

test("AC2: a late verification response cannot restore account data after sign-out", async () => {
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

test("routing: direct staff link signs in and returns to the requested URL", async () => {
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
  ["external user", verifiedUser, []],
  ["internal classification alone", staffUser, []],
  ["unrecognised permission", staffUser, ["administrator"]],
  ["existing manager policy", { ...staffUser, roles: ["event_ops_manager"] }, ["event_organisers.read"]],
])("RBAC: %s cannot access a staff page by URL", async (_name, identity, permissions) => {
  const { fetchMock } = setup(session, identity, permissions);
  renderApp(["/staff/responsibilities"]);
  expect(await screen.findByRole("heading", { name: "Access denied" })).toBeTruthy();
  expect(screen.getByTestId("location").textContent).toBe("/forbidden");
  expect(screen.queryByRole("link", { name: "Responsibilities" })).toBeNull();
  expect(fetchMock).not.toHaveBeenCalledWith("/api/internal/access", expect.anything());
});

test("RBAC: sign-in to a forbidden return URL still enforces permission", async () => {
  const { fetchMock } = setup();
  renderApp(["/staff/responsibilities"]);
  await submitSignIn();
  expect(await screen.findByRole("heading", { name: "Access denied" })).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("routing: navigation and browser history share one verified identity", async () => {
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

test("routing: sign-out on a staff page prevents back navigation from exposing it", async () => {
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

test("RBAC: re-verification of the same token removes revoked navigation and page access", async () => {
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

test("RBAC: the server can reject staff data even when navigation was previously allowed", async () => {
  const { fetchMock } = setup(session, staffUser, ["internal.access"]);
  fetchMock.mockImplementation(async (url) => url === "/api/auth/me"
    ? reply(200, { user: staffUser, permissions: ["internal.access"] })
    : reply(403, { message: "private record details" }));
  renderApp(["/staff/responsibilities"]);
  expect((await screen.findByRole("alert")).textContent).toMatch(/staff access is unavailable/);
  expect(screen.queryByText("private record details")).toBeNull();
  expect(screen.queryByText("Venue information and availability")).toBeNull();
});

test("AC2: backend outage keeps protected routes hidden and supports retry", async () => {
  const { fetchMock } = setup(session);
  fetchMock.mockResolvedValueOnce(reply(503, {}));
  const user = userEvent.setup();
  renderApp(["/account"]);
  await screen.findByRole("alert");
  expect(screen.queryByRole("navigation")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("Welcome, Verified Person.")).toBeTruthy();
});

test("connection initialization can be retried without a page reload", async () => {
  setup();
  getAuthClient.mockRejectedValueOnce(new Error("Private connection details"));
  const user = userEvent.setup();
  renderApp(["/sign-in"]);
  expect((await screen.findByRole("alert")).textContent).toMatch(/couldn’t connect/);
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByLabelText("Email address")).toBeTruthy();
});

test("failed sign-out displays a safe error and allows retry", async () => {
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

test.each(["https://outside.example", "//outside.example", "/\\outside.example", "/SIGN-IN/", "/a/../sign-in"])(
  "routing: unsafe or looping return destination %s falls back to account", async (from) => {
    setup(session);
    renderApp([{ pathname: "/sign-in", state: { from } }]);
    await screen.findByText("Welcome, Verified Person.");
    expect(screen.getByTestId("location").textContent).toBe("/account");
  },
);

test("routing: unknown URLs show a usable not-found page", async () => {
  setup();
  const user = userEvent.setup();
  renderApp(["/does-not-exist"]);
  expect(screen.getByRole("heading", { name: "Page not found" })).toBeTruthy();
  await user.click(screen.getByRole("link", { name: "Go to home" }));
  expect(await screen.findByLabelText("Email address")).toBeTruthy();
});

test("session subscription survives StrictMode cleanup without stale listeners", async () => {
  const { unsubscribe } = setup(session);
  const view = renderApp(["/account"], true);
  expect(await screen.findByText("Welcome, Verified Person.")).toBeTruthy();
  view.unmount();
  expect(unsubscribe).toHaveBeenCalled();
});
