// @vitest-environment jsdom
// Only network transport is faked; the components, service, hook and apiFetch are real.
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { AuthContext } from "../../auth/useAuth";
import ConfirmEventControls from "./ConfirmEventControls";
import SafetyCheckControls from "./SafetyCheckControls";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const EVENT_ID = "aaaaaaaa-0144-4000-8000-000000000001";
const READINESS = `/api/internal/events/${EVENT_ID}/safety-readiness`;
const CONFIRM = `/api/internal/events/${EVENT_ID}/confirm`;
const flagUrl = (kind, id) => `/api/internal/events/${EVENT_ID}/arrangements/${kind}/${id}`;
const ok = (body) => ({ status: 200, ok: true, json: async () => body });
const fail = (status, body) => ({ status, ok: false, json: async () => body });

const HALL_B = { kind: "venue", id: "vr-b", label: "Hall B · 2099-05-02", reason: "Waiting for Venue Staff to decide." };
const HALL_C = { kind: "venue", id: "vr-c", label: "Hall C · 2099-05-03", reason: "Waiting for Venue Staff to decide." };
const MIC = { kind: "equipment", id: "eq-1", label: "Microphone", reason: "Waiting for Technical Support Staff to reserve it." };
const NO_VENUE = { kind: "venue", label: "Venue", reason: "No venue booking has been approved yet." };
const READY = { ready: true, missing: [], optional: [] };

function setup(respond, { Component = ConfirmEventControls, status = "PREPARATION" } = {}) {
  const fetchMock = vi.fn(async (url, options = {}) => respond(url, options));
  vi.stubGlobal("fetch", fetchMock);
  const onChanged = vi.fn();
  render(<AuthContext.Provider value={{ token: "coordinator-token" }}>
    <Component event={{ id: EVENT_ID, status }} onChanged={onChanged} />
  </AuthContext.Provider>);
  return { fetchMock, onChanged, user: userEvent.setup() };
}

const writes = (fetchMock) => fetchMock.mock.calls.filter(([, options]) => options?.method && options.method !== "GET");
const items = (name) => within(screen.getByRole("list", { name })).getAllByRole("listitem").map((item) => item.textContent);

test("[SCRUM-144-UI-001] AC2/AC3: each essential item still outstanding is listed, venue by venue, and Confirm is disabled", async () => {
  const { fetchMock } = setup(() => ok({ ready: false, missing: [HALL_B, HALL_C, MIC], optional: [] }));

  await screen.findByRole("list", { name: "Missing arrangements" });
  expect(items("Missing arrangements")).toEqual([
    "Hall B · 2099-05-02: Waiting for Venue Staff to decide. Mark as non-essential",
    "Hall C · 2099-05-03: Waiting for Venue Staff to decide. Mark as non-essential",
    "Microphone: Waiting for Technical Support Staff to reserve it. Mark as non-essential",
  ]);
  expect(screen.getByRole("button", { name: "Confirm event" })).toBeDisabled();
  expect(fetchMock.mock.calls[0][0]).toBe(READINESS);
  expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer coordinator-token");
});

test("[SCRUM-144-UI-002] AC1: with nothing essential outstanding the coordinator confirms and the confirmed event is handed back", async () => {
  const { fetchMock, onChanged, user } = setup((url) => url === READINESS ? ok(READY) : ok({ event: { id: EVENT_ID, status: "CONFIRMED" } }));

  expect(await screen.findByText("Every essential arrangement is complete.")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Confirm event", disabled: false }));

  await waitFor(() => expect(onChanged).toHaveBeenCalledWith({ id: EVENT_ID, status: "CONFIRMED" }));
  expect(writes(fetchMock).map(([url, options]) => [url, options.method])).toEqual([[CONFIRM, "POST"]]);
});

test("[SCRUM-144-UI-003] AC3: a confirm refused because something changed shows why and the fresh list", async () => {
  let readinessCalls = 0;
  const { onChanged, user } = setup((url) => {
    if (url === CONFIRM) return fail(409, { message: "This event cannot be confirmed yet. Finish the essential arrangements listed.", missing: [MIC] });
    readinessCalls += 1;
    return ok(readinessCalls === 1 ? READY : { ready: false, missing: [MIC], optional: [] });
  });

  await user.click(await screen.findByRole("button", { name: "Confirm event", disabled: false }));

  expect(await screen.findByRole("alert")).toHaveTextContent("This event cannot be confirmed yet.");
  expect(await screen.findByRole("list", { name: "Missing arrangements" })).toHaveTextContent("Microphone");
  expect(screen.getByRole("button", { name: "Confirm event" })).toBeDisabled();
  expect(onChanged).not.toHaveBeenCalled();
});

test("[SCRUM-144-UI-004] AC4: marking an outstanding item non-essential moves it out of the blocking list and enables Confirm", async () => {
  let marked = false;
  const { fetchMock, user } = setup((url, options) => {
    if (url === flagUrl("equipment", "eq-1")) { marked = true; return ok({ arrangement: { id: "eq-1", is_essential: false } }); }
    expect(options.method ?? "GET").toBe("GET");
    return ok(marked ? { ready: true, missing: [], optional: [MIC] } : { ready: false, missing: [MIC], optional: [] });
  });

  await user.click(await screen.findByRole("button", { name: "Mark Microphone as non-essential" }));

  expect(await screen.findByRole("list", { name: "Non-essential arrangements" })).toHaveTextContent("Microphone");
  expect(screen.queryByRole("list", { name: "Missing arrangements" })).not.toBeInTheDocument();
  expect(screen.getByText("Outstanding but marked non-essential, so they do not block:")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Confirm event" })).toBeEnabled();
  const [[url, options]] = writes(fetchMock);
  expect(url).toBe(flagUrl("equipment", "eq-1"));
  expect(options.method).toBe("PATCH");
  expect(JSON.parse(options.body)).toEqual({ is_essential: false });
});

test("[SCRUM-144-UI-005] AC4: a non-essential item can be marked essential again, which blocks once more", async () => {
  let marked = true;
  const { fetchMock, user } = setup((url) => {
    if (url === flagUrl("venue", "vr-b")) { marked = false; return ok({ arrangement: { id: "vr-b", is_essential: true } }); }
    return ok(marked ? { ready: true, missing: [], optional: [HALL_B] } : { ready: false, missing: [HALL_B], optional: [] });
  });

  await user.click(await screen.findByRole("button", { name: "Mark Hall B · 2099-05-02 as essential" }));

  expect(await screen.findByRole("list", { name: "Missing arrangements" })).toHaveTextContent("Hall B");
  expect(screen.getByRole("button", { name: "Confirm event" })).toBeDisabled();
  expect(JSON.parse(writes(fetchMock)[0][1].body)).toEqual({ is_essential: true });
});

test("[SCRUM-144-UI-006] AC4 boundary: 'no venue approved yet' has no request behind it, so it cannot be marked", async () => {
  setup(() => ok({ ready: false, missing: [NO_VENUE], optional: [HALL_B] }));

  const missing = await screen.findByRole("list", { name: "Missing arrangements" });
  expect(within(missing).getByRole("listitem")).toHaveTextContent("Venue: No venue booking has been approved yet.");
  expect(within(missing).queryByRole("button")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Confirm event" })).toBeDisabled();
});

test("[SCRUM-144-UI-007] AC4: a refused mark shows the server's message and keeps the list", async () => {
  const { user } = setup((url) => url === READINESS
    ? ok({ ready: false, missing: [MIC], optional: [] })
    : fail(409, { message: "Arrangements can only be marked while the event is in planning or preparation." }));

  await user.click(await screen.findByRole("button", { name: "Mark Microphone as non-essential" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Arrangements can only be marked while the event is in planning or preparation.");
  expect(screen.getByRole("list", { name: "Missing arrangements" })).toHaveTextContent("Microphone");
});

test("[SCRUM-144-UI-008] a readiness check that fails says so safely, Confirm stays disabled, and it can be retried", async () => {
  let attempt = 0;
  const { user } = setup(() => (attempt++ === 0 ? fail(500, { message: "Something went wrong. Please try again." }) : ok(READY)));

  expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong. Please try again.");
  expect(screen.getByRole("button", { name: "Confirm event" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Try again" }));

  expect(await screen.findByText("Every essential arrangement is complete.")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("[SCRUM-144-UI-009] while readiness loads and while confirming, Confirm is disabled", async () => {
  let answer;
  const { user } = setup((url) => url === READINESS ? ok(READY) : new Promise((resolve) => { answer = resolve; }));

  expect(screen.getByRole("status")).toHaveTextContent("Checking arrangements…");
  expect(screen.getByRole("button", { name: "Confirm event" })).toBeDisabled();
  await user.click(await screen.findByRole("button", { name: "Confirm event", disabled: false }));

  expect(screen.getByRole("button", { name: "Confirming…" })).toBeDisabled();
  answer(ok({ event: { id: EVENT_ID, status: "CONFIRMED" } }));
});

test("[SCRUM-144-UI-010] AC4: during planning the safety-check list offers the same marking, and submission follows it", async () => {
  let marked = false;
  const { user } = setup((url) => {
    if (url === flagUrl("equipment", "eq-1")) { marked = true; return ok({ arrangement: { id: "eq-1", is_essential: false } }); }
    return ok(marked ? { ready: true, missing: [], optional: [MIC] } : { ready: false, missing: [MIC], optional: [] });
  }, { Component: SafetyCheckControls, status: "APPROVED" });

  expect(screen.getByRole("heading", { name: "Operational Safety Check" })).toBeInTheDocument();
  await user.click(await screen.findByRole("button", { name: "Mark Microphone as non-essential" }));

  expect(await screen.findByRole("list", { name: "Non-essential arrangements" })).toHaveTextContent("Microphone");
  expect(screen.getByRole("button", { name: "Submit for safety check" })).toBeEnabled();
});

test("[SCRUM-144-UI-014] AC4: every mark button is disabled while a mark is being saved", async () => {
  let answer;
  const { user } = setup((url) => url === READINESS
    ? ok({ ready: false, missing: [HALL_B, MIC], optional: [] })
    : new Promise((resolve) => { answer = resolve; }));

  await user.click(await screen.findByRole("button", { name: "Mark Microphone as non-essential" }));

  expect(screen.getByRole("button", { name: "Mark Microphone as non-essential" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Mark Hall B · 2099-05-02 as non-essential" })).toBeDisabled();
  answer(ok({ arrangement: { id: "eq-1", is_essential: false } }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Mark Hall B · 2099-05-02 as non-essential" })).toBeEnabled());
});
