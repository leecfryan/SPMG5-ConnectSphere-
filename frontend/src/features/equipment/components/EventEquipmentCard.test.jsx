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

function renderCard(lines) {
  return render(
    <EventEquipmentCard
      eventId="evt-1"
      eventName="Test Event"
      requestedByNames={["Coordinator"]}
      lines={lines}
      onStatusChange={() => {}}
      savingId={null}
      token="test-token"
      currentUserId="tech-1"
    />,
  );
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
