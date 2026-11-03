// @vitest-environment jsdom
// SCRUM-150 AC2: proves the two new badge states this story adds - the
// "Needs re-review" status label and the "Not available for these dates"
// sub-label, shown only on a REVIEW_REQUIRED line when available_for_window
// is false. Scoped to just these new lines, the same way SCRUM-149's TC-149-15
// scoped its own new-file decision to the one status case it needed, rather
// than building a harness for the card's full existing behaviour (status
// selects, saving state, the clarification thread). Only `fetch` is stubbed
// (ClarificationThread fetches messages once expanded); the component itself
// is real.
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import EventEquipmentCard from "./EventEquipmentCard";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubFetch() {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) })));
}

function baseLine(overrides) {
  return {
    id: "req-1", equipment_id: "eq-1", equipment_type: "Projector", quantity_requested: 1,
    borrow_start: "2026-01-01T09:00:00Z", borrow_end: "2026-01-01T17:00:00Z",
    status: "REVIEW_REQUIRED",
    ...overrides,
  };
}

function renderCard(lines, overrides = {}) {
  return render(
    <EventEquipmentCard
      eventId="evt-1"
      eventName="Test Event"
      requestedByNames={["Coordinator"]}
      lines={lines}
      onStatusChange={() => {}}
      savingId={null}
      onReserve={() => {}}
      reservingGroupId={null}
      reserveError={null}
      token="test-token"
      currentUserId="tech-1"
      {...overrides}
    />,
  );
}

function groupLine(overrides) {
  return {
    id: "r1", group_id: "g1", equipment_type: "Projector", quantity_requested: 1,
    is_essential: false, status: "PENDING",
    borrow_start: "2026-01-01T09:00:00Z", borrow_end: "2026-01-01T17:00:00Z",
    ...overrides,
  };
}

test("[TC-150-frontend-01] REVIEW_REQUIRED renders the Needs re-review status badge", async () => {
  stubFetch();
  const { container } = renderCard([baseLine()]);
  await userEvent.click(screen.getByRole("button", { expanded: false }));
  // "Needs re-review" also appears as the select's disabled option text, so
  // this targets the status badge specifically, not just any matching text.
  expect(container.querySelector(".eq-status-review_required")).toHaveTextContent("Needs re-review");
});

test("[TC-150-frontend-02] available_for_window: false shows the unavailable sub-label", async () => {
  stubFetch();
  renderCard([baseLine({ available_for_window: false })]);
  await userEvent.click(screen.getByRole("button", { expanded: false }));
  expect(screen.getByText("Not available for these dates")).toBeInTheDocument();
});

test("[TC-150-frontend-03] available_for_window: true shows no unavailable sub-label", async () => {
  stubFetch();
  renderCard([baseLine({ available_for_window: true })]);
  await userEvent.click(screen.getByRole("button", { expanded: false }));
  expect(screen.queryByText("Not available for these dates")).not.toBeInTheDocument();
});

test("[TC-150-frontend-04] the sub-label never renders for a non-REVIEW_REQUIRED line, even if available_for_window were somehow set", async () => {
  stubFetch();
  renderCard([baseLine({ status: "APPROVED", available_for_window: false })]);
  await userEvent.click(screen.getByRole("button", { expanded: false }));
  expect(screen.queryByText("Not available for these dates")).not.toBeInTheDocument();
});

// --- SCRUM-31: grouped display + Reserve ---

test("TC-13: a group of siblings shows one summary line with the reserved/unfulfilled counts and an essential badge", async () => {
  stubFetch();
  renderCard([
    groupLine({ id: "r1", status: "APPROVED" }),
    groupLine({ id: "r2", status: "APPROVED" }),
    groupLine({ id: "r3", status: "UNFULFILLED" }),
    groupLine({ id: "r4", status: "UNFULFILLED" }),
    groupLine({ id: "r5", status: "UNFULFILLED", is_essential: true }),
  ]);
  await userEvent.click(screen.getByRole("button", { expanded: false }));
  expect(screen.getByText("Projector × 5")).toBeInTheDocument();
  expect(screen.getByText("2 reserved, 3 unfulfilled")).toBeInTheDocument();
  expect(screen.getByText("Essential")).toBeInTheDocument();
});

test("TC-13: the Reserve button appears only while a group still has a PENDING sibling", async () => {
  stubFetch();
  renderCard([groupLine({ id: "r1", status: "APPROVED" }), groupLine({ id: "r2", status: "UNFULFILLED" })]);
  await userEvent.click(screen.getByRole("button", { expanded: false }));
  expect(screen.queryByRole("button", { name: "Reserve" })).not.toBeInTheDocument();
});

test("clicking Reserve calls onReserve with that group's id", async () => {
  stubFetch();
  const onReserve = vi.fn();
  renderCard([groupLine({ id: "r1", status: "PENDING" })], { onReserve });
  await userEvent.click(screen.getByRole("button", { expanded: false }));
  await userEvent.click(screen.getByRole("button", { name: "Reserve" }));
  expect(onReserve).toHaveBeenCalledWith("g1");
});

test("Reserve is disabled and reads Reserving… while its own group is reserving", async () => {
  stubFetch();
  renderCard([groupLine({ id: "r1", status: "PENDING" })], { reservingGroupId: "g1" });
  await userEvent.click(screen.getByRole("button", { expanded: false }));
  expect(screen.getByRole("button", { name: "Reserving…" })).toBeDisabled();
});

test("a reserve error shows only against the group it belongs to", async () => {
  stubFetch();
  renderCard(
    [groupLine({ id: "r1", group_id: "g1", status: "PENDING" }), groupLine({ id: "r2", group_id: "g2", status: "PENDING" })],
    { reserveError: { groupId: "g1", message: "Not enough units available to fully reserve this essential item (needs 2, 1 available)." } },
  );
  await userEvent.click(screen.getByRole("button", { expanded: false }));
  expect(screen.getByText(/not enough units available/i)).toBeInTheDocument();
});

// SCRUM-31 TC-10: a still-PENDING sibling (no unit assigned) can't be picked
// straight to Assigned through this selector - the server would 409 it.
test("TC-10: Assigned is disabled on the status select for a sibling with no equipment_id yet", async () => {
  stubFetch();
  renderCard([groupLine({ id: "r1", status: "PENDING" })]);
  await userEvent.click(screen.getByRole("button", { expanded: false }));
  expect(screen.getByRole("option", { name: "Assigned" })).toBeDisabled();
});

test("Assigned is selectable on the status select once a unit is actually assigned", async () => {
  stubFetch();
  renderCard([groupLine({ id: "r1", status: "APPROVED", equipment_id: "unit-1" })]);
  await userEvent.click(screen.getByRole("button", { expanded: false }));
  expect(screen.getByRole("option", { name: "Assigned" })).toBeEnabled();
});
