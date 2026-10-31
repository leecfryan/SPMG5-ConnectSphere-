// @vitest-environment jsdom
import { createRequire } from "node:module";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { MemoryRouter } from "react-router";
import App from "../../../App";
import { getAuthClient } from "../../../lib/supabase";

const require = createRequire(import.meta.url);
const { getPermissions } = require("../../../../../backend/src/auth/permissions.js");
vi.mock("../../../lib/supabase", () => ({ getAuthClient: vi.fn() }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetAllMocks(); });
const response = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const events = [
  { id: "own", name: "Own workshop", organiser_id: "organiser-a", status: "SUBMITTED", coordinator_id: null },
  { id: "peer", name: "Colleague conference", organiser_id: "organiser-b", status: "APPROVED", coordinator_id: "coordinator-a" },
];

function setup(load, loadDrafts = () => response(200, { drafts: [] })) {
  getAuthClient.mockResolvedValue({ auth: {
    onAuthStateChange: callback => {
      queueMicrotask(() => callback("INITIAL_SESSION", { access_token: "organiser-token", user: { id: "sdk-id" } }));
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    },
    signOut: vi.fn().mockResolvedValue({ error: null }),
  } });
  const fetchMock = vi.fn(async url => {
    if (url === "/api/auth/me") return response(200, {
      user: { id: "organiser-a", roles: ["event_organiser"], fullName: "Client A", accountTypes: ["external"] },
      permissions: getPermissions(["event_organiser"]),
    });
    if (url === "/api/event-workspace/organiser") return load();
    if (url === "/api/events/drafts") return loadDrafts();
    throw new Error("Unexpected request: " + url);
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<MemoryRouter initialEntries={["/my-event-requests"]}><App /></MemoryRouter>);
  return fetchMock;
}

test("[SCRUM-100-UI-007] Own and colleague events appear in separate groups and search only filters returned events", async () => {
  const fetchMock = setup(() => response(200, { events }));
  const ownGroup = await screen.findByRole("region", { name: "Events you are responsible for" });
  const peerGroup = screen.getByRole("region", { name: "Other organisers’ event requests" });
  expect(within(peerGroup).getByText("View-only requests from other organisers in your company.")).toBeTruthy();
  expect(within(ownGroup).getByRole("link", { name: "Own workshop" }).getAttribute("href")).toBe("/my-event-requests/own");
  expect(within(ownGroup).getByText(/You are responsible/)).toBeTruthy();
  expect(within(peerGroup).getByText(/View only/)).toBeTruthy();
  expect(within(peerGroup).queryByRole("link", { name: "Own workshop" })).toBeNull();
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Search events"), "  CONFERENCE  ");
  expect(screen.queryByRole("link", { name: "Own workshop" })).toBeNull();
  expect(screen.getByRole("link", { name: "Colleague conference" })).toBeTruthy();
  await user.clear(screen.getByLabelText("Search events"));
  await user.type(screen.getByLabelText("Search events"), "Unrelated client secret");
  expect(screen.getByText("No events match your search.")).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Colleague conference" })).toBeNull();
  expect(fetchMock.mock.calls.filter(([url]) => url === "/api/event-workspace/organiser")).toHaveLength(1);
});

test("[SCRUM-100-UI-008] Pending scoped lookup shows a loading state and no previous records", async () => {
  let finish;
  setup(() => new Promise(resolve => { finish = resolve; }));
  await screen.findByText("Loading events…");
  expect(screen.queryByRole("link", { name: "Own workshop" })).toBeNull();
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  await act(async () => finish(response(200, { events })));
  await screen.findByRole("link", { name: "Own workshop" });
  expect(screen.queryByText("Loading events…")).toBeNull();
});

test("[SCRUM-100-UI-009] An organiser with no events sees an empty state and can submit a request", async () => {
  setup(() => response(200, { events: [] }));
  await screen.findByText("No events to show yet.");
  expect(screen.queryByText("No events match your search.")).toBeNull();
  expect(screen.getByRole("link", { name: "Submit an event request" }).getAttribute("href")).toBe("/events/new");
});

test("[SCRUM-100-UI-010] A failed scoped lookup offers retry without showing any records", async () => {
  let failed = true;
  setup(() => failed ? response(503, { message: "Unable to load events. Please try again." }) : response(200, { events }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Unable to load events. Please try again."));
  expect(screen.queryByRole("link", { name: "Own workshop" })).toBeNull();
  failed = false;
  await userEvent.setup().click(screen.getByRole("button", { name: "Refresh events" }));
  await screen.findByRole("link", { name: "Own workshop" });
  expect(screen.queryByRole("alert")).toBeNull();
});

const drafts = [{ id: "draft-1", name: "Half-planned gala", organiser_id: "organiser-a", status: "DRAFT", created_at: "2026-10-19T02:00:00.000Z" }];

test("[SCRUM-147-UI-001] AC3: the organiser's drafts are listed apart from submitted events and open in the request form", async () => {
  setup(() => response(200, { events }), () => response(200, { drafts }));
  const draftGroup = await screen.findByRole("region", { name: "Your drafts" });
  expect(within(draftGroup).getByText("Only you can see your drafts. Open one to continue editing and submit it.")).toBeTruthy();
  const draftLink = await within(draftGroup).findByRole("link", { name: "Half-planned gala" });
  expect(draftLink.getAttribute("href")).toBe("/events/new?draft=draft-1");
  expect(within(draftLink).getByText("Draft", { exact: true })).toBeTruthy();
  expect(within(draftLink).getByText(/^Started\s+\S/)).toBeTruthy();
  const ownGroup = await screen.findByRole("region", { name: "Events you are responsible for" });
  expect(within(ownGroup).queryByRole("link", { name: "Half-planned gala" })).toBeNull();
});

test("[SCRUM-147-UI-002] AC3: an organiser without drafts sees an empty state", async () => {
  setup(() => response(200, { events }));
  const draftGroup = await screen.findByRole("region", { name: "Your drafts" });
  await within(draftGroup).findByText("You have no drafts.");
});

test("[SCRUM-147-UI-003] AC3: the drafts list shows loading, then a safe error that leaves the events list working", async () => {
  let finish;
  setup(() => response(200, { events }), () => new Promise(resolve => { finish = resolve; }));
  const draftGroup = await screen.findByRole("region", { name: "Your drafts" });
  expect(within(draftGroup).getByText("Loading drafts…")).toBeTruthy();
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  await act(async () => finish(response(500, { message: "Could not load your drafts. Please try again." })));
  expect(within(draftGroup).getByRole("alert").textContent).toBe("Could not load your drafts. Please try again.");
  expect(await screen.findByRole("link", { name: "Own workshop" })).toBeTruthy();
});
