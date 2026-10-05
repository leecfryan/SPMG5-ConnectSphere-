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

function setup(load) {
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
