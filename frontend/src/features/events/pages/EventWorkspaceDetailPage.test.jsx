// @vitest-environment jsdom
import { createRequire } from "node:module";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { MemoryRouter } from "react-router";
import App from "../../../App";
import { getAuthClient } from "../../../lib/supabase";

const require = createRequire(import.meta.url);
const { getPermissions } = require("../../../../../backend/src/auth/permissions.js");
vi.mock("../../../lib/supabase", () => ({ getAuthClient: vi.fn() }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetAllMocks(); });
const eventId = "10000000-0000-0000-0000-000000000001";
const endpoint = `/api/event-workspace/organiser/${eventId}`;
const response = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

function setup({ owner = "organiser-a", patchResponse } = {}) {
  const event = {
    id: eventId, organiser_id: owner, coordinator_id: null, status: "APPROVED", name: "Own event",
    purpose: "Workshop", description: "An accessible workshop", expected_attendance: 20,
    start_time: "2099-01-01T01:00:12.345Z", end_time: "2099-01-01T03:00:12.345Z",
    venue_requirements: "One room", equipment_needs: "Projector",
  };
  const identity = { id: "organiser-a", roles: ["event_organiser"], fullName: "Organiser A", accountTypes: ["external"] };
  let authListener;
  const session = { access_token: "organiser-token", user: { id: "sdk-id" } };
  getAuthClient.mockResolvedValue({ auth: {
    onAuthStateChange: callback => {
      authListener = callback;
      queueMicrotask(() => callback("INITIAL_SESSION", session));
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    },
    signOut: vi.fn().mockResolvedValue({ error: null }),
  } });
  const fetchMock = vi.fn(async (url, options = {}) => {
    if (url === "/api/auth/me") return response(200, {
      user: { ...identity },
      permissions: getPermissions(["event_organiser"]),
    });
    if (url === endpoint && options.method === "PATCH") {
      if (patchResponse) return patchResponse;
      Object.assign(event, JSON.parse(options.body));
      return response(200, { event: { ...event } });
    }
    if (url === endpoint) return response(200, { event: { ...event } });
    throw new Error("Unexpected request: " + url);
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<MemoryRouter initialEntries={[`/my-event-requests/${eventId}`]}><App /></MemoryRouter>);
  return { event, fetchMock, switchAccount: () => {
    identity.id = "organiser-b";
    authListener("SIGNED_IN", { access_token: "other-organiser-token", user: { id: "unverified-b" } });
  } };
}

test("[SCRUM-100-UI-001] The responsible organiser saves only changed fields and sees the refreshed event", async () => {
  const { event, fetchMock } = setup();
  const before = structuredClone(event);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Edit event" }));
  expect(screen.getByRole("button", { name: "Save changes" }).disabled).toBe(true);
  const input = screen.getByLabelText(/Event name/);
  await user.clear(input);
  await user.type(input, "Revised event");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByRole("heading", { name: "Revised event" });
  expect(screen.getByText("Event changes saved.")).toBeTruthy();
  const calls = fetchMock.mock.calls.filter(([, options]) => options?.method === "PATCH");
  expect(calls).toHaveLength(1);
  expect(JSON.parse(calls[0][1].body)).toEqual({ name: "Revised event" });
  expect(event).toEqual({ ...before, name: "Revised event" });
});

test("[SCRUM-100-UI-002] A colleague's event has a view-only explanation and no edit controls", async () => {
  const { fetchMock } = setup({ owner: "organiser-b" });
  await screen.findByRole("heading", { name: "Own event" });
  expect(screen.getByText("View only. Only the responsible organiser can edit this event.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Edit event" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
  expect(fetchMock.mock.calls.filter(([, options]) => options?.method === "PATCH")).toHaveLength(0);
});

test("[SCRUM-100-UI-003] Cancelling an edit discards form input without sending any update", async () => {
  const { fetchMock } = setup();
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Edit event" }));
  await user.type(screen.getByLabelText(/Event name/), "Discard this");
  await user.click(screen.getByRole("button", { name: "Cancel editing" }));
  expect(screen.getByRole("button", { name: "Edit event" })).toBeTruthy();
  expect(fetchMock.mock.calls.filter(([, options]) => options?.method === "PATCH")).toHaveLength(0);
});

test("[SCRUM-100-UI-004] API validation errors retain entered values and allow correction", async () => {
  setup({ patchResponse: response(400, { errors: [{ field: "name", message: "required" }], message: "Check the event details and try again." }) });
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Edit event" }));
  await user.clear(screen.getByLabelText(/Event name/));
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByText("required")).toBeTruthy();
  expect(screen.getByLabelText(/Event name/).value).toBe("");
  expect(screen.getByLabelText(/Event name/).getAttribute("aria-invalid")).toBe("true");
});

test("[SCRUM-100-UI-005] A server denial of an already open edit retains input and leaves stored data unchanged", async () => {
  const { event } = setup({ patchResponse: response(403, { message: "You can only edit events you are responsible for." }) });
  const before = structuredClone(event);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Edit event" }));
  await user.type(screen.getByLabelText(/Event name/), "Denied change");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("You can only edit events you are responsible for."));
  expect(event).toEqual(before);
  expect(screen.getByLabelText(/Event name/).value).toBe("Own eventDenied change");
});

test("[SCRUM-100-UI-006] Late event data cannot restore a previous account's records after an account switch", async () => {
  const { fetchMock, event, switchAccount } = setup();
  await screen.findByRole("heading", { name: "Own event" });
  const original = fetchMock.getMockImplementation();
  let finishOldRequest;
  fetchMock.mockImplementation((url, options) => {
    if (url === endpoint && options.headers.Authorization === "Bearer organiser-token") {
      return new Promise(resolve => { finishOldRequest = resolve; });
    }
    if (url === endpoint) return Promise.resolve(response(404, { message: "Event not found." }));
    return original(url, options);
  });
  await userEvent.setup().click(screen.getByRole("button", { name: "Refresh event" }));
  await waitFor(() => expect(finishOldRequest).toBeTypeOf("function"));
  await act(async () => switchAccount());
  await screen.findByText("Event not found.");
  await act(async () => finishOldRequest(response(200, { event })));
  expect(screen.queryByRole("heading", { name: "Own event" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Edit event" })).toBeNull();
});
