// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { getAuthClient } from "./lib/supabase";
import App from "./App";

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

function setup(initialSession = null) {
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
  const fetchMock = vi.fn().mockResolvedValue(reply(200, { user: verifiedUser }));
  vi.stubGlobal("fetch", fetchMock);
  return { auth, fetchMock, unsubscribe, emit: (event, value) => onAuthChange(event, value) };
}

test("AC1/AC3: sign-in displays only the identity verified by the backend", async () => {
  const { auth, fetchMock } = setup();
  const user = userEvent.setup();
  render(<App />);
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
  render(<App />);
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
  render(<App />);
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.queryByText("You’re signed in")).toBeNull();
  expect(screen.queryByText("unverified@client.sg")).toBeNull();
  expect(screen.queryByText("Private upstream details")).toBeNull();
});

test("AC1: restored sessions are verified again; sign-out and reload remove the account", async () => {
  const { auth, fetchMock, unsubscribe } = setup(session);
  const user = userEvent.setup();
  const view = render(<App />);
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
  render(<App />);
  expect(await screen.findByLabelText("Email address")).toBeTruthy();
  expect(next.fetchMock).not.toHaveBeenCalled();
});

test("AC2: token refresh hides the previous account until the new token is verified", async () => {
  const { emit, fetchMock } = setup(session);
  render(<App />);
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
  render(<App />);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  act(() => emit("SIGNED_OUT", null));
  await act(async () => { finish(reply(200, { user: verifiedUser })); });
  expect(screen.getByLabelText("Email address")).toBeTruthy();
  expect(screen.queryByText("Welcome, Verified Person.")).toBeNull();
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
});
