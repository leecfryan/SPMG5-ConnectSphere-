// @vitest-environment jsdom
// SCRUM-31: the dashboard's new Reserve wiring - the reserved/unfulfilled
// rows the server actually writes get merged back into the list, a 409
// (essential shortfall) changes nothing and surfaces against the right
// group only, and a 403 reuses the existing forbidden-access modal. Only
// `fetch` is stubbed, routed by URL/method; the component itself is real,
// same pattern as EquipmentRequestPage.test.jsx.
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { AuthContext } from "../../auth/useAuth";
import TechnicalSupportDashboardPage from "./TechnicalSupportDashboardPage";

// jsdom doesn't implement <dialog>'s imperative methods; no existing test
// exercises the forbidden-access ErrorModal path, so this is the first file
// that needs the polyfill.
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function ok(body) {
  return { ok: true, json: async () => body };
}
function fail(status, body) {
  return { ok: false, status, json: async () => body };
}

const GROUP = [
  { id: "r1", event_id: "evt-1", event_name: "Demo Event", group_id: "g1", equipment_type: "Projector", quantity_requested: 1, status: "PENDING", is_essential: false, borrow_start: "2026-01-01T09:00:00Z", borrow_end: "2026-01-01T17:00:00Z", requested_by_name: "Coordinator" },
  { id: "r2", event_id: "evt-1", event_name: "Demo Event", group_id: "g1", equipment_type: "Projector", quantity_requested: 1, status: "PENDING", is_essential: false, borrow_start: "2026-01-01T09:00:00Z", borrow_end: "2026-01-01T17:00:00Z", requested_by_name: "Coordinator" },
];

function renderPage({ initial = GROUP, onReserve } = {}) {
  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    const path = String(url);
    if (path.includes("/api/technical-support/equipment-requests")) return ok({ data: initial });
    if (path.includes("/reserve") && options?.method === "PATCH") return onReserve ? onReserve() : ok({ data: { reserved: [], unfulfilled: [] } });
    return ok({ data: [] });
  }));
  return render(
    <AuthContext.Provider value={{ token: "test-token", user: { id: "tech-1" } }}>
      <TechnicalSupportDashboardPage />
    </AuthContext.Provider>,
  );
}

async function expandAndReserve() {
  await userEvent.click(await screen.findByRole("button", { expanded: false }));
  await userEvent.click(screen.getByRole("button", { name: "Reserve" }));
}

test("a successful reserve merges the reserved/unfulfilled rows into the list", async () => {
  // The real reserveGroup returns the full updated row (group_id,
  // equipment_type etc. included, via .select()) - a partial row here would
  // drop out of its group on merge, which is exactly the kind of mismatch
  // this test exists to catch.
  renderPage({
    onReserve: () => ok({
      data: {
        reserved: [{ ...GROUP[0], status: "APPROVED", equipment_id: "unit-1" }],
        unfulfilled: [{ ...GROUP[1], status: "UNFULFILLED" }],
      },
    }),
  });
  await expandAndReserve();

  expect(await screen.findByText("1 reserved, 1 unfulfilled")).toBeInTheDocument();
  // The group no longer has a PENDING sibling, so Reserve disappears.
  expect(screen.queryByRole("button", { name: "Reserve" })).not.toBeInTheDocument();
});

test("a 409 essential shortfall changes nothing and shows the error against that group", async () => {
  renderPage({
    onReserve: () => fail(409, { error: "Not enough units available to fully reserve this essential item (needs 2, 1 available)." }),
  });
  await expandAndReserve();

  expect(await screen.findByText(/not enough units available/i)).toBeInTheDocument();
  // Nothing changed - the group still has its two PENDING siblings and Reserve still shows.
  expect(screen.getByText("0 reserved, 0 unfulfilled, 2 pending")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Reserve" })).toBeInTheDocument();
});

test("a 403 on reserve shows the access-denied modal, same as the status-change path", async () => {
  renderPage({ onReserve: () => fail(403, { message: "You are not allowed to do that." }) });
  await expandAndReserve();

  expect(await screen.findByText("You are not allowed to do that.")).toBeInTheDocument();
});
