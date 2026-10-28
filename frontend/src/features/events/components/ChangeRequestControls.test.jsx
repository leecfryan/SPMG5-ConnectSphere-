// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { AuthContext } from "../../auth/useAuth";
import ChangeRequestControls from "./ChangeRequestControls";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const EVENT_ID = "aaaaaaaa-0036-4000-8000-000000000001";
const ok201 = (body) => ({ status: 201, ok: true, json: async () => body });
const fail = (status, body) => ({ status, ok: false, json: async () => body });

const baseEvent = {
  id: EVENT_ID,
  name: "Annual Gala",
  purpose: "Celebration",
  description: "Year-end event",
  start_time: "2099-06-01T10:00:00.000Z",
  end_time: "2099-06-01T18:00:00.000Z",
  registration_start: null,
  registration_end: null,
  expected_attendance: 100,
  venue_requirements: "Ballroom",
  accessibility_needs: null,
  equipment_needs: null,
  other_comments: null,
  status: "UNDER_REVIEW",
  pending_change_request: null,
};

function setup(eventOverrides = {}, respond = () => ok201({ event: { ...baseEvent, pending_change_request: { proposed_changes: { name: "New Gala" }, reason: "Updated branding", requested_at: "2026-10-26T10:00:00.000Z", requested_by: "alice" } } })) {
  const fetchMock = vi.fn(async () => respond());
  vi.stubGlobal("fetch", fetchMock);
  const onSubmitted = vi.fn();
  render(
    <AuthContext.Provider value={{ token: "organiser-token" }}>
      <ChangeRequestControls event={{ ...baseEvent, ...eventOverrides }} onSubmitted={onSubmitted} />
    </AuthContext.Provider>
  );
  return { fetchMock, onSubmitted, user: userEvent.setup() };
}

test("[TC-SCRUM-36-17] pending request view shows proposed changes, reason and awaiting-review status", () => {
  setup({
    status: "APPROVED",
    pending_change_request: {
      proposed_changes: { name: "Updated Gala", expected_attendance: 150 },
      reason: "Venue capacity changed",
      requested_at: "2026-10-26T10:00:00.000Z",
      requested_by: "alice",
    },
  });
  expect(screen.getByText(/awaiting review/i)).toBeInTheDocument();
  expect(screen.getByText(/venue capacity changed/i)).toBeInTheDocument();
  expect(screen.getByText("Updated Gala")).toBeInTheDocument();
  expect(screen.getByText("150")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /request a change/i })).not.toBeInTheDocument();
});

test("[TC-SCRUM-36-17b] eligible event without pending request shows Request a change button", () => {
  setup({ status: "UNDER_REVIEW" });
  expect(screen.getByRole("button", { name: /request a change/i })).toBeInTheDocument();
});

test("[TC-SCRUM-36-17c] ineligible status renders nothing", () => {
  setup({ status: "SAFETY_REVIEW" });
  expect(screen.queryByRole("button", { name: /request a change/i })).not.toBeInTheDocument();
  expect(screen.queryByText(/change request/i)).not.toBeInTheDocument();
});

test("[TC-SCRUM-36-17d] opening the form shows field inputs and a reason field", async () => {
  const { user } = setup({ status: "UNDER_REVIEW" });
  await user.click(screen.getByRole("button", { name: /request a change/i }));
  expect(screen.getByLabelText(/event name/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/reason for change/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /submit change request/i })).toBeInTheDocument();
});

test("[TC-SCRUM-36-17e] submitting a changed field and reason calls the API and invokes onSubmitted", async () => {
  const { fetchMock, onSubmitted, user } = setup({ status: "UNDER_REVIEW" });
  await user.click(screen.getByRole("button", { name: /request a change/i }));
  await user.clear(screen.getByLabelText(/event name/i));
  await user.type(screen.getByLabelText(/event name/i), "New Gala Name");
  await user.type(screen.getByLabelText(/reason for change/i), "Rebranding");
  await user.click(screen.getByRole("button", { name: /submit change request/i }));
  await waitFor(() => expect(onSubmitted).toHaveBeenCalled());
  const [, options] = fetchMock.mock.calls[0];
  const body = JSON.parse(options.body);
  expect(body.proposed_changes.name).toBe("New Gala Name");
  expect(body.reason).toBe("Rebranding");
  expect(options.method).toBe("POST");
});

test("[TC-SCRUM-36-17f] server reason error is shown against the reason field", async () => {
  const { user } = setup({ status: "UNDER_REVIEW" }, () =>
    fail(400, { errors: [{ field: "reason", message: "required" }] })
  );
  await user.click(screen.getByRole("button", { name: /request a change/i }));
  await user.clear(screen.getByLabelText(/event name/i));
  await user.type(screen.getByLabelText(/event name/i), "Changed");
  await user.type(screen.getByLabelText(/reason for change/i), " ");
  await user.click(screen.getByRole("button", { name: /submit change request/i }));
  await waitFor(() => expect(screen.getByText("required")).toBeInTheDocument());
});

test("[TC-SCRUM-36-17g] submitting with no changes shows a client-side error without calling the API", async () => {
  const { fetchMock, user } = setup({ status: "APPROVED" });
  await user.click(screen.getByRole("button", { name: /request a change/i }));
  await user.type(screen.getByLabelText(/reason for change/i), "Testing");
  await user.click(screen.getByRole("button", { name: /submit change request/i }));
  expect(screen.getByText(/change at least one field/i)).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});
