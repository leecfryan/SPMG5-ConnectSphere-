// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { Link, MemoryRouter, Route, Routes } from "react-router";
import { AuthContext } from "../../auth/useAuth";
import EventListPage from "./EventListPage";
import EventDetailPage from "./EventDetailPage";
import MyRegistrationsPage from "./MyRegistrationsPage";
import RegistrationDetailPage from "./RegistrationDetailPage";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const reply = (body, status = 200) => ({ ok: status === 200, status, json: async () => body });
const privateFields = {
  other_comments: "PRIVATE organiser planning notes",
  equipment_needs: "PRIVATE equipment plan", venue_requirements: "PRIVATE venue plan",
  coordinator_id: "PRIVATE coordinator", organiser_id: "PRIVATE organiser",
};
const event = {
  id: "public-event", name: "Community workshop", status: "APPROVED",
  description: "An attendee-facing workshop", purpose: "Meet the community",
  start_time: "2099-10-10T10:00:00Z", end_time: "2099-10-10T15:00:00Z",
  registration_fields: [{ id: "full_name", label: "Full name", type: "text", required: true }],
  ...privateFields,
};
function registration(status = "pending") {
  return {
    id: "own-registration", event_id: event.id, status,
    registration_data: { full_name: "Attendee A" },
    created_at: "2026-09-29T01:00:00Z", updated_at: "2026-09-29T01:00:00Z",
    events: event, ...privateFields,
  };
}
function mount(path, responses) {
  const fetchMock = vi.fn(async (url) => {
    if (!(url in responses)) throw new Error("Unexpected request: " + url);
    return typeof responses[url] === "function" ? responses[url]() : responses[url];
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<AuthContext.Provider value={{ token: "attendee-a-token" }}>
    <MemoryRouter initialEntries={[path]}>
      <Link to="/events/hidden-event">Try unpublished event URL</Link>
      <Link to="/registrations/me/other-registration">Try another registration ID</Link>
      <Routes>
        <Route path="/events" element={<EventListPage />} />
        <Route path="/events/:eventId" element={<EventDetailPage />} />
        <Route path="/registrations/me" element={<MyRegistrationsPage />} />
        <Route path="/registrations/me/:registrationId" element={<RegistrationDetailPage />} />
      </Routes>
    </MemoryRouter>
  </AuthContext.Provider>);
  return fetchMock;
}
function expectNoPlanningFields() {
  for (const value of Object.values(privateFields)) expect(screen.queryByText(value, { exact: false })).not.toBeInTheDocument();
}

test("[ATT-UI-001] Browse to registration-facing event details without rendering internal payload fields", async () => {
  const user = userEvent.setup();
  const fetchMock = mount("/events", {
    "/api/events": reply({ events: [event] }),
    "/api/events/public-event": reply({ event }),
  });
  const list = await screen.findByRole("list", { name: "Available events" });
  expectNoPlanningFields();
  await user.click(within(list).getByRole("link", { name: /Community workshop/ }));
  expect(await screen.findByRole("heading", { name: event.name })).toBeVisible();
  expect(screen.getByText(event.description)).toBeVisible();
  expect(screen.getByText(event.purpose)).toBeVisible();
  expect(screen.getByLabelText("Full name")).toBeVisible();
  expectNoPlanningFields();
  expect(fetchMock).toHaveBeenCalledWith("/api/events/public-event", expect.objectContaining({
    headers: { Authorization: "Bearer attendee-a-token" }, cache: "no-store",
  }));
});

test("[ATT-UI-002] An unpublished event URL clears the previous event before displaying its denial", async () => {
  const user = userEvent.setup();
  let finish;
  mount("/events/public-event", {
    "/api/events/public-event": reply({ event }),
    "/api/events/hidden-event": () => new Promise(resolve => { finish = resolve; }),
  });
  expect(await screen.findByRole("heading", { name: event.name })).toBeVisible();
  await user.click(screen.getByRole("link", { name: "Try unpublished event URL" }));
  expect(screen.getByRole("status")).toHaveTextContent("Loading event");
  expect(screen.queryByRole("heading", { name: event.name })).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Full name")).not.toBeInTheDocument();
  await act(async () => { finish(reply({ message: "Event not found." }, 404)); });
  expect(await screen.findByRole("alert")).toHaveTextContent("Event not found.");
  expect(screen.queryByRole("button", { name: "Register for this event" })).not.toBeInTheDocument();
  expectNoPlanningFields();
});

test.each([
  ["ATT-UI-003", "pending", "Pending"],
  ["ATT-UI-004", "confirmed", "Confirmed"],
  ["ATT-UI-005", "withdrawn", "Withdrawn"],
])("[%s] Own %s status agrees between registration list and detail without internal planning text", async (_id, status, label) => {
  const user = userEvent.setup();
  const own = registration(status);
  mount("/registrations/me", {
    "/api/registrations/me": reply({ registrations: [own] }),
    "/api/registrations/me/own-registration": reply({ registration: own }),
  });
  const card = await screen.findByRole("link", { name: /Community workshop/ });
  expect(card).toHaveTextContent(label);
  expectNoPlanningFields();
  await user.click(card);
  expect(await screen.findByRole("heading", { name: "Registration details" })).toBeVisible();
  expect(screen.getByText(label, { exact: true })).toBeVisible();
  expect(screen.getByText("Attendee A", { exact: true })).toBeVisible();
  expectNoPlanningFields();
});

test("[ATT-UI-006] Changing the registration ID removes the previous record while access is checked and denied", async () => {
  const user = userEvent.setup();
  let finish;
  const fetchMock = mount("/registrations/me/own-registration", {
    "/api/registrations/me/own-registration": reply({ registration: registration() }),
    "/api/registrations/me/other-registration": () => new Promise(resolve => { finish = resolve; }),
  });
  expect(await screen.findByText("Attendee A", { exact: true })).toBeVisible();
  await user.click(screen.getByRole("link", { name: "Try another registration ID" }));
  expect(screen.getByRole("status")).toHaveTextContent("Loading registration");
  expect(screen.queryByText("Attendee A", { exact: true })).not.toBeInTheDocument();
  await act(async () => { finish(reply({ message: "Registration not found." }, 404)); });
  expect(await screen.findByRole("alert")).toHaveTextContent("Registration not found.");
  expect(screen.queryByRole("heading", { name: "Your submitted details" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Withdraw registration" })).not.toBeInTheDocument();
  expect(fetchMock).toHaveBeenLastCalledWith("/api/registrations/me/other-registration", expect.objectContaining({
    headers: { Authorization: "Bearer attendee-a-token" },
  }));
});
