// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AuthContext } from "../auth/useAuth";
import NotificationCentrePage from "./pages/NotificationCentrePage";
import NotificationReadButton from "./components/NotificationReadButton";
import NotificationInbox from "./components/NotificationInbox";

const sdk = vi.hoisted(() => ({ inbox: vi.fn(), counts: vi.fn(), feed: vi.fn(), content: vi.fn(), notification: null, client: { clearCache: vi.fn(), socket: { disconnect: vi.fn() } } }));
vi.mock("@novu/react", () => ({
  Inbox: props => { sdk.inbox(props); return props.children; },
  useNovu: () => sdk.client,
  InboxContent: props => { sdk.content(props); return <><p>Fixture notification history</p>{props.renderDefaultActions(sdk.notification)}</>; },
}));
vi.mock("@novu/react/hooks", () => ({ useCounts: sdk.counts, useNotifications: sdk.feed }));

const alice = { id: "alice", roles: [] };
const bob = { id: "bob", roles: [] };
const config = id => ({ applicationIdentifier: "fixture-app", subscriberId: id, subscriberHash: "signature-for-" + id });
const reply = (status, data) => ({ ok: status === 200, status, json: async () => data });
let fetchMock;

beforeEach(() => {
  sdk.notification = { isRead: true };
  sdk.counts.mockReturnValue({ counts: [{ count: 3 }], isLoading: false });
  sdk.feed.mockReturnValue({ notifications: [], isLoading: false });
  fetchMock = vi.fn().mockResolvedValue(reply(200, config("alice")));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetAllMocks(); });

function view(user = alice, token = "alice-token") {
  return <AuthContext.Provider value={{ user, token }}><NotificationCentrePage /></AuthContext.Provider>;
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("[TC-SCRUM-143-08] Verified account uses only its signed backend inbox config", async () => {
  render(view());
  expect(screen.getByRole("status").textContent).toContain("Loading");
  expect(sdk.inbox).not.toHaveBeenCalled();
  await screen.findByText("Unread notifications: 3");
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/notifications/inbox-config", expect.objectContaining({
    headers: { Authorization: "Bearer alice-token" }, cache: "no-store", signal: expect.any(AbortSignal),
  }));
  expect(sdk.inbox.mock.lastCall[0]).toMatchObject({
    applicationIdentifier: "fixture-app", subscriber: "alice", subscriberHash: "signature-for-alice",
  });
  expect(sdk.inbox.mock.lastCall[0]).not.toHaveProperty("secretKey");
  expect(sdk.counts).toHaveBeenCalledWith({ filters: [{ read: false, archived: false }] });
  expect(sdk.feed).toHaveBeenCalledWith({ archived: false });
  expect(screen.getByText("Fixture notification history")).toBeTruthy();
});

test.each([0, 25, 101])("[TC-SCRUM-143-09] Displays the SDK unread count %s without truncation", async count => {
  sdk.counts.mockReturnValue({ counts: [{ count }], isLoading: false });
  render(view());
  expect(await screen.findByText("Unread notifications: " + count)).toBeTruthy();
  expect(sdk.inbox.mock.lastCall[0].localization["notifications.emptyNotice"]).toBe("You have no notifications yet.");
});

test.each([[true, false], [false, true]])("[TC-SCRUM-143-09] Waits for count (%s) and feed (%s) without a misleading zero", async (counterLoading, feedLoading) => {
  sdk.counts.mockReturnValue({ isLoading: counterLoading });
  sdk.feed.mockReturnValue({ isLoading: feedLoading });
  render(view());
  await waitFor(() => expect(sdk.inbox).toHaveBeenCalled());
  expect(screen.getByRole("status").textContent).toContain("Loading");
  expect(sdk.content).not.toHaveBeenCalled();
  expect(screen.queryByText(/Unread notifications:/)).toBeNull();
});

test.each([401, 503])("[TC-SCRUM-143-10] Config HTTP %s hides provider details and can retry", async status => {
  fetchMock.mockResolvedValueOnce(reply(status, { message: "PRIVATE upstream credentials" }));
  render(view());
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe("Your notifications could not be loaded. Please try again.");
  expect(screen.queryByText(/PRIVATE/)).toBeNull();
  expect(sdk.inbox).not.toHaveBeenCalled();
  await userEvent.setup().click(screen.getByRole("button", { name: "Retry notifications" }));
  await screen.findByText("Unread notifications: 3");
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("[TC-SCRUM-143-10] A network failure can recover without showing transport details", async () => {
  fetchMock.mockRejectedValueOnce(new Error("PRIVATE network host"));
  render(view());
  await screen.findByRole("alert");
  expect(screen.queryByText(/PRIVATE/)).toBeNull();
  await userEvent.setup().click(screen.getByRole("button", { name: "Retry notifications" }));
  await screen.findByText("Unread notifications: 3");
});

test.each(["counts", "feed"])("[TC-SCRUM-143-11] Novu %s failure hides stale content and retries the signed session", async source => {
  sdk[source].mockReturnValue({ isLoading: false, error: new Error("PRIVATE Novu failure") });
  render(view());
  await screen.findByRole("alert");
  expect(sdk.content).not.toHaveBeenCalled();
  expect(screen.queryByText(/PRIVATE/)).toBeNull();
  expect(screen.queryByText(/Unread notifications:/)).toBeNull();
  sdk.counts.mockReturnValue({ counts: [{ count: 3 }], isLoading: false });
  sdk.feed.mockReturnValue({ notifications: [], isLoading: false });
  await userEvent.setup().click(screen.getByRole("button", { name: "Retry notifications" }));
  await screen.findByText("Unread notifications: 3");
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("[TC-SCRUM-143-12] Switching accounts removes history before the next signed config arrives", async () => {
  const pending = deferred();
  const rendered = render(view());
  await screen.findByText("Fixture notification history");
  const oldSignal = fetchMock.mock.calls[0][1].signal;
  fetchMock.mockReturnValueOnce(pending.promise);
  rendered.rerender(view(bob, "bob-token"));
  expect(screen.queryByText("Fixture notification history")).toBeNull();
  expect(screen.queryByText(/Unread notifications:/)).toBeNull();
  expect(oldSignal.aborted).toBe(true);
  expect(sdk.client.clearCache).toHaveBeenCalledOnce();
  expect(sdk.client.socket.disconnect).toHaveBeenCalledOnce();
  await act(async () => pending.resolve(reply(200, config("bob"))));
  await screen.findByText("Fixture notification history");
  expect(sdk.inbox.mock.lastCall[0]).toMatchObject({ subscriber: "bob", subscriberHash: "signature-for-bob" });
  expect(fetchMock.mock.lastCall[1].headers.Authorization).toBe("Bearer bob-token");
});

test.each(["resolve", "reject"])("[TC-SCRUM-143-12] Ignores an obsolete config that later %ss", async settlement => {
  const old = deferred();
  fetchMock.mockReturnValueOnce(old.promise);
  const rendered = render(view());
  fetchMock.mockResolvedValueOnce(reply(200, config("bob")));
  rendered.rerender(view(bob, "bob-token"));
  await screen.findByText("Unread notifications: 3");
  await act(async () => settlement === "resolve" ? old.resolve(reply(200, config("alice"))) : old.reject(new Error("old failure")));
  expect(sdk.inbox.mock.calls.every(([props]) => props.subscriber === "bob")).toBe(true);
  expect(screen.queryByRole("alert")).toBeNull();
});

test("[TC-SCRUM-143-12] Refreshing a token resets the inbox and unmount cancels the pending request", async () => {
  const rendered = render(view());
  await screen.findByText("Fixture notification history");
  fetchMock.mockReturnValueOnce(deferred().promise);
  rendered.rerender(view(alice, "refreshed-token"));
  expect(screen.queryByText("Fixture notification history")).toBeNull();
  const request = fetchMock.mock.lastCall[1];
  expect(request.headers.Authorization).toBe("Bearer refreshed-token");
  rendered.unmount();
  expect(request.signal.aborted).toBe(true);
});

test("[TC-SCRUM-143-13] A config for another subscriber fails closed", async () => {
  fetchMock.mockResolvedValue(reply(200, config("bob")));
  render(view());
  await screen.findByRole("alert");
  expect(sdk.inbox).not.toHaveBeenCalled();
});


test("[TC-SCRUM-143-17] Read action is labelled, prevents a duplicate click and does not activate the parent", async () => {
  const pending = deferred();
  const read = vi.fn().mockReturnValue(pending.promise);
  const parent = vi.fn();
  render(<div onClick={parent}><NotificationReadButton notification={{ isRead: false, read }} onReadError={vi.fn()} /></div>);
  const button = screen.getByRole("button", { name: "Mark as read" });
  await userEvent.setup().click(button);
  expect(screen.getByRole("button", { name: "Marking as read…" }).disabled).toBe(true);
  await userEvent.setup().click(button);
  expect(read).toHaveBeenCalledOnce();
  expect(parent).not.toHaveBeenCalled();
  await act(async () => pending.resolve({ data: undefined }));
  expect(screen.getByRole("button", { name: "Mark as read" }).disabled).toBe(false);
  expect(screen.queryByRole("alert")).toBeNull();
});

test.each(["result", "exception"])("[TC-SCRUM-143-17] Failed read (%s) reports failure to the stable inbox and can retry", async failure => {
  const onReadError = vi.fn();
  const read = failure === "result" ? vi.fn().mockResolvedValueOnce({ error: new Error("PRIVATE") }) : vi.fn().mockRejectedValueOnce(new Error("PRIVATE"));
  read.mockResolvedValue({ data: undefined });
  render(<NotificationReadButton notification={{ isRead: false, read }} onReadError={onReadError} />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Mark as read" }));
  expect(onReadError).toHaveBeenLastCalledWith(true);
  await userEvent.setup().click(screen.getByRole("button", { name: "Mark as read" }));
  expect(onReadError).toHaveBeenLastCalledWith(false);
  expect(read).toHaveBeenCalledTimes(2);
});

test("[TC-SCRUM-143-17] The inbox displays a safe read error independently of SDK action remounts", async () => {
  sdk.notification = { isRead: false, read: vi.fn().mockResolvedValue({ error: new Error("PRIVATE") }) };
  render(view());
  await userEvent.setup().click(await screen.findByRole("button", { name: "Mark as read" }));
  expect((await screen.findByRole("alert")).textContent).toBe("This notification could not be marked as read. Please reload your notifications.");
  expect(screen.queryByText(/PRIVATE/)).toBeNull();
});

test("[TC-SCRUM-143-12] Stable account rerenders preserve the inbox while count updates remain visible", async () => {
  const rendered = render(view());
  await screen.findByText("Unread notifications: 3");
  rendered.rerender(view());
  expect(screen.getByText("Unread notifications: 3")).toBeTruthy();
  expect(sdk.client.clearCache).not.toHaveBeenCalled();
  expect(fetchMock).toHaveBeenCalledOnce();
  sdk.counts.mockReturnValue({ counts: [{ count: 4 }], isLoading: false });
  rendered.rerender(view({ ...alice, fullName: "Alice" }));
  expect(screen.getByText("Unread notifications: 4")).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledOnce();
});


test.each(["loading", "error"])("[TC-SCRUM-143-11] A stable %s state stays private across rerenders", async mode => {
  sdk.counts.mockReturnValue(mode === "loading" ? { isLoading: true } : { error: new Error("PRIVATE"), isLoading: false });
  const rendered = render(view());
  await waitFor(() => expect(sdk.inbox).toHaveBeenCalled());
  rendered.rerender(view({ ...alice, fullName: "Updated name" }));
  if (mode === "loading") expect(screen.getByRole("status").textContent).toContain("Loading");
  else expect(screen.getByRole("alert").textContent).toBe("Your notifications could not be loaded. Please try again.");
  expect(screen.queryByText("Fixture notification history")).toBeNull();
  expect(fetchMock).toHaveBeenCalledOnce();
});


test("[TC-SCRUM-143-09] SDK loading transitions and repeated count results keep the displayed state accurate", () => {
  sdk.counts.mockReturnValue({ isLoading: true });
  const reload = vi.fn();
  const rendered = render(<NotificationInbox reload={reload} />);
  expect(screen.getByRole("status").textContent).toContain("Loading");
  sdk.counts.mockReturnValue({ counts: [{ count: 3 }], isLoading: false });
  sdk.feed.mockReturnValue({ isLoading: true });
  rendered.rerender(<NotificationInbox reload={reload} />);
  expect(screen.getByRole("status").textContent).toContain("Loading");
  sdk.feed.mockReturnValue({ notifications: [], isLoading: false });
  rendered.rerender(<NotificationInbox reload={reload} />);
  expect(screen.getByText("Unread notifications: 3")).toBeTruthy();
  rendered.rerender(<NotificationInbox reload={reload} />);
  expect(screen.getByText("Unread notifications: 3")).toBeTruthy();
});
