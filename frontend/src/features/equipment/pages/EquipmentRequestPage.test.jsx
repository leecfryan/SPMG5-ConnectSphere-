// @vitest-environment jsdom
// SCRUM-150 AC2: proves this page's one new line - the "Not available for
// these dates" sub-label on a REVIEW_REQUIRED request whose
// available_for_window is false - the same scope SCRUM-149's TC-149-15 chose
// for a single new status case, not a full harness for the page's existing
// behaviour (form submission, availability filtering, the clarification
// thread). Only `fetch` is stubbed, routed by URL; AuthContext is provided
// directly rather than mocking the whole auth module.
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { AuthContext } from "../../auth/useAuth";
import EquipmentRequestPage from "./EquipmentRequestPage";

const EVENT_ID = "evt-1";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubFetch(requests) {
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    const path = String(url);
    if (path.includes("/api/equipment/events")) return ok({ data: [{ id: EVENT_ID, name: "Test Event" }] });
    if (path.includes(`/api/events/${EVENT_ID}/equipment-requests`)) return ok({ data: requests });
    if (path.includes("/api/equipment")) return ok({ data: [{ id: "eq-1", type: "Projector", status: "AVAILABLE" }] });
    return ok({ data: [] });
  }));
}
function ok(body) {
  return { ok: true, json: async () => body };
}

function renderPage(requests) {
  stubFetch(requests);
  return render(
    <MemoryRouter initialEntries={[`/equipment/requests?event=${EVENT_ID}`]}>
      <AuthContext.Provider value={{ token: "test-token", user: { id: "coord-1" } }}>
        <EquipmentRequestPage />
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

test("[TC-150-frontend-05] a REVIEW_REQUIRED row with available_for_window: false shows the unavailable sub-label", async () => {
  renderPage([{
    id: "req-1", equipment_id: "eq-1", quantity_requested: 1, status: "REVIEW_REQUIRED",
    borrow_start: "2026-01-01T09:00:00Z", borrow_end: "2026-01-01T17:00:00Z",
    available_for_window: false,
  }]);
  expect(await screen.findByText("Not available for these dates")).toBeInTheDocument();
});

test("[TC-150-frontend-06] a REVIEW_REQUIRED row with available_for_window: true shows no unavailable sub-label", async () => {
  renderPage([{
    id: "req-1", equipment_id: "eq-1", quantity_requested: 1, status: "REVIEW_REQUIRED",
    borrow_start: "2026-01-01T09:00:00Z", borrow_end: "2026-01-01T17:00:00Z",
    available_for_window: true,
  }]);
  await screen.findByText("Needs re-review");
  expect(screen.queryByText("Not available for these dates")).not.toBeInTheDocument();
});

// SCRUM-169: the two cases below need their own fetch routing (full
// catalogue vs this window's filtered list return different data), which
// the shared stubFetch() above doesn't distinguish - each builds its own.
function stubWindowAwareFetch({ fullCatalogue, windowed, windowedOk = true }) {
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    const path = String(url);
    if (path.includes("/api/equipment/events")) return ok({ data: [{ id: EVENT_ID, name: "Test Event" }] });
    if (path.includes(`/api/events/${EVENT_ID}/equipment-requests`)) return ok({ data: [] });
    if (path.includes("/api/equipment?")) {
      return windowedOk ? ok({ data: windowed }) : { ok: false, json: async () => ({ message: "boom" }) };
    }
    if (path.includes("/api/equipment")) return ok({ data: fullCatalogue });
    return ok({ data: [] });
  }));
}

test("[TC-SCRUM-169-07] a type with real catalogue units but none free for this window still reaches the dropdown", async () => {
  stubWindowAwareFetch({
    fullCatalogue: [
      { id: "eq-1", type: "Projector", status: "AVAILABLE" },
      { id: "eq-2", type: "Screen", status: "UNAVAILABLE" },
    ],
    windowed: [{ id: "eq-1", type: "Projector", status: "AVAILABLE" }], // Screen has zero units free here
  });
  render(
    <MemoryRouter initialEntries={[`/equipment/requests?event=${EVENT_ID}`]}>
      <AuthContext.Provider value={{ token: "test-token", user: { id: "coord-1" } }}>
        <EquipmentRequestPage />
      </AuthContext.Provider>
    </MemoryRouter>,
  );

  expect(await screen.findByRole("option", { name: "Screen" })).toBeInTheDocument();
});

test("[TC-SCRUM-169-05] a failed window-filtered availability fetch shows the existing error banner, not a false Out of Stock", async () => {
  stubWindowAwareFetch({
    fullCatalogue: [{ id: "eq-1", type: "Projector", status: "AVAILABLE" }],
    windowed: [],
    windowedOk: false,
  });
  render(
    <MemoryRouter initialEntries={[`/equipment/requests?event=${EVENT_ID}`]}>
      <AuthContext.Provider value={{ token: "test-token", user: { id: "coord-1" } }}>
        <EquipmentRequestPage />
      </AuthContext.Provider>
    </MemoryRouter>,
  );

  expect(await screen.findByText(/Could not check equipment availability: boom/i)).toBeInTheDocument();
  await userEvent.setup().selectOptions(screen.getByLabelText("Equipment type"), "Projector");
  expect(screen.queryByText("Out of Stock")).not.toBeInTheDocument();
  expect(screen.queryByText(/available now/i)).not.toBeInTheDocument();
});
