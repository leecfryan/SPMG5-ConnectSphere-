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
const response = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

// Times are written against the UTC+8 zone pinned in vitest.config.js.
const draft = {
  id: "draft-1", name: "Half-planned gala", status: "DRAFT", organiser_id: "organiser-a",
  purpose: "Reconnect alumni", description: null, start_time: "2030-01-02T02:00:00.000Z", end_time: null,
  registration_start: "2029-12-01T01:00:00.000Z", registration_end: null, expected_attendance: 120,
  venue_requirements: null, accessibility_needs: null, equipment_needs: null, other_comments: null,
};

// `routes` answers each API call by "METHOD url"; anything else fails the test.
function setup(path, routes) {
  getAuthClient.mockResolvedValue({ auth: {
    onAuthStateChange: callback => {
      queueMicrotask(() => callback("INITIAL_SESSION", { access_token: "organiser-token", user: { id: "sdk-id" } }));
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    },
    signOut: vi.fn().mockResolvedValue({ error: null }),
  } });
  const fetchMock = vi.fn(async (url, options = {}) => {
    if (url === "/api/auth/me") return response(200, {
      user: { id: "organiser-a", roles: ["event_organiser"], fullName: "Client A", accountTypes: ["external"] },
      permissions: getPermissions(["event_organiser"]),
    });
    const answer = routes[`${options.method || "GET"} ${url}`];
    if (!answer) throw new Error(`Unexpected request: ${options.method || "GET"} ${url}`);
    return answer(options.body && JSON.parse(options.body));
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
  return fetchMock;
}

const sent = (fetchMock, call) => {
  const match = fetchMock.mock.calls.find(([url, options]) => `${options?.method || "GET"} ${url}` === call);
  return match && JSON.parse(match[1].body);
};

test("[SCRUM-147-UI-004] AC1/AC2: a request with only a name is saved as a draft and continues as that draft", async () => {
  const fetchMock = setup("/events/new", {
    "POST /api/events/drafts": body => response(201, { event: { ...draft, ...body, id: "draft-1" } }),
    "GET /api/events/drafts/draft-1": () => response(200, { event: { ...draft, name: "Gala idea", purpose: null, start_time: null, registration_start: null, expected_attendance: null } }),
  });
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText(/Event name/), "Gala idea");
  await user.click(screen.getByRole("button", { name: "Save draft" }));

  expect(sent(fetchMock, "POST /api/events/drafts")).toMatchObject({ name: "Gala idea", purpose: "", start_time: "", expected_attendance: "" });
  expect((await screen.findByRole("status")).textContent).toMatch(/^Draft saved at .+\. Only you can see it\.$/);
  expect(await screen.findByDisplayValue("Gala idea")).toBeTruthy();
  expect(screen.getByText("DRAFT EVENT REQUEST")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});

test("[SCRUM-147-UI-005] AC1: a draft without a name shows the server's error against the name field", async () => {
  setup("/events/new", {
    "POST /api/events/drafts": () => response(400, { message: "Check the event details and try again.", errors: [{ field: "name", message: "required" }] }),
  });
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Save draft" }));

  expect(await screen.findByText("required")).toBeTruthy();
  expect(screen.getByLabelText(/Event name/).getAttribute("aria-invalid")).toBe("true");
  expect(screen.getByRole("alert").textContent).toBe("Check the highlighted field and try again.");
});

test("[SCRUM-147-UI-006] AC3: an opened draft is pre-filled in local time and its edits are saved to the same draft", async () => {
  const fetchMock = setup("/events/new?draft=draft-1", {
    "GET /api/events/drafts/draft-1": () => response(200, { event: draft }),
    "PATCH /api/events/drafts/draft-1": body => response(200, { event: { ...draft, ...body } }),
  });
  expect(await screen.findByDisplayValue("Half-planned gala")).toBeTruthy();
  expect(screen.getByLabelText(/Purpose/).value).toBe("Reconnect alumni");
  expect(screen.getByLabelText(/Starts/).value).toMatch(/^2030-01-02T10:00/);
  expect(screen.getByLabelText("Registration opens").value).toMatch(/^2029-12-01T09:00/);
  expect(screen.getByLabelText(/Expected attendance/).value).toBe("120");

  const user = userEvent.setup();
  await user.clear(screen.getByLabelText(/Purpose/));
  await user.type(screen.getByLabelText(/Description/), "Dinner and awards");
  await user.click(screen.getByRole("button", { name: "Save draft" }));

  await screen.findByText(/^Draft saved at/);
  expect(sent(fetchMock, "PATCH /api/events/drafts/draft-1")).toMatchObject({
    name: "Half-planned gala", purpose: "", description: "Dinner and awards", start_time: "2030-01-02T02:00:00.000Z",
  });
  expect(fetchMock.mock.calls.some(([url, options]) => url === "/api/events/drafts" && options?.method === "POST")).toBe(false);
});

test("[SCRUM-147-UI-007] AC3: submitting an opened draft submits that draft, not a new request", async () => {
  const fetchMock = setup("/events/new?draft=draft-1", {
    "GET /api/events/drafts/draft-1": () => response(200, { event: draft }),
    "POST /api/events/drafts/draft-1/submit": body => response(200, { event: { ...draft, ...body, status: "SUBMITTED" } }),
  });
  const user = userEvent.setup();
  await screen.findByDisplayValue("Half-planned gala");
  await user.click(screen.getByRole("button", { name: "Submit request" }));

  expect(await screen.findByRole("heading", { name: "Request submitted" })).toBeTruthy();
  expect(sent(fetchMock, "POST /api/events/drafts/draft-1/submit")).toMatchObject({ name: "Half-planned gala" });
  expect(fetchMock.mock.calls.some(([url]) => url === "/api/events")).toBe(false);

  await user.click(screen.getByRole("button", { name: "Submit another request" }));
  expect(await screen.findByText("NEW EVENT REQUEST")).toBeTruthy();
  expect(screen.getByLabelText(/Event name/).value).toBe("");
});

test("[SCRUM-147-UI-008] AC2: an incomplete draft is not submitted; each missing field is shown and the draft stays open", async () => {
  setup("/events/new?draft=draft-1", {
    "GET /api/events/drafts/draft-1": () => response(200, { event: draft }),
    "POST /api/events/drafts/draft-1/submit": () => response(400, {
      message: "Check the event details and try again.",
      errors: [{ field: "description", message: "required" }, { field: "end_time", message: "required" }],
    }),
  });
  const user = userEvent.setup();
  await screen.findByDisplayValue("Half-planned gala");
  await user.click(screen.getByRole("button", { name: "Submit request" }));

  expect((await screen.findByRole("alert")).textContent).toBe("Check the highlighted fields and try again.");
  expect(screen.getByLabelText(/Description/).getAttribute("aria-invalid")).toBe("true");
  expect(screen.getByLabelText(/Ends/).getAttribute("aria-invalid")).toBe("true");
  expect(screen.getByDisplayValue("Half-planned gala")).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Request submitted" })).toBeNull();
});

test("[SCRUM-147-UI-009] AC4: a draft that is not the organiser's shows a safe message and no form", async () => {
  setup("/events/new?draft=someone-elses", {
    "GET /api/events/drafts/someone-elses": () => response(404, { message: "Draft not found." }),
  });
  expect((await screen.findByRole("alert")).textContent).toBe("Draft not found.");
  expect(screen.getByRole("link", { name: "Back to your event requests" }).getAttribute("href")).toBe("/my-event-requests");
  expect(screen.queryByRole("button", { name: "Save draft" })).toBeNull();
});

test("[SCRUM-147-UI-010] AC3: the draft shows a loading state, and both buttons lock while a save is in flight", async () => {
  let finishLoad;
  let finishSave;
  setup("/events/new?draft=draft-1", {
    "GET /api/events/drafts/draft-1": () => new Promise(resolve => { finishLoad = resolve; }),
    "PATCH /api/events/drafts/draft-1": () => new Promise(resolve => { finishSave = resolve; }),
  });
  expect(await screen.findByText("Loading your draft…")).toBeTruthy();
  await waitFor(() => expect(finishLoad).toBeTypeOf("function"));
  await act(async () => finishLoad(response(200, { event: draft })));

  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Save draft" }));
  expect(screen.getByRole("button", { name: "Saving draft…" }).disabled).toBe(true);
  expect(screen.getByRole("button", { name: "Submit request" }).disabled).toBe(true);
  await waitFor(() => expect(finishSave).toBeTypeOf("function"));
  await act(async () => finishSave(response(200, { event: draft })));
  expect(await screen.findByRole("button", { name: "Save draft" })).toBeTruthy();
});

test("[SCRUM-147-UI-011] AC2: a registration window problem does not stop a draft from being saved", async () => {
  const fetchMock = setup("/events/new", {
    "POST /api/events/drafts": body => response(201, { event: { ...draft, ...body, id: "draft-1" } }),
    "GET /api/events/drafts/draft-1": () => response(200, { event: draft }),
  });
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText(/Event name/), "Gala idea");
  await user.type(screen.getByLabelText("Registration opens"), "2030-01-02T12:00");
  await user.type(screen.getByLabelText("Registration closes"), "2030-01-02T11:00");
  expect(screen.getByLabelText("Registration closes").value).toBe("2030-01-02T11:00");
  await user.click(screen.getByRole("button", { name: "Save draft" }));

  await screen.findByText(/^Draft saved at/);
  expect(sent(fetchMock, "POST /api/events/drafts")).toMatchObject({ name: "Gala idea" });
});
