// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { useRegistrationResource } from "./hooks/useRegistrationResource";
import { useEventRegistration } from "./hooks/useEventRegistration";
import { AuthContext } from "../auth/useAuth";
import EventListPage from "./pages/EventListPage";
import EventDetailPage from "./pages/EventDetailPage";

vi.mock("./hooks/useRegistrationResource", () => ({
  useRegistrationResource: vi.fn(),
}));

vi.mock("./hooks/useEventRegistration", () => ({
  useEventRegistration: vi.fn(),
}));

const EVENT = {
  id: "aaaaaaaa-0001-0000-0000-000000000000",
  name: "Annual Alumni Gala",
  description: "An evening event.",
  purpose: "Celebrate alumni.",
  start_time: null,
  end_time: null,
  status: "APPROVED",
  enrolled_attendees: 7,
  expected_attendance: 10,
  registration_fields: [],
};

beforeEach(() => {
  useEventRegistration.mockReturnValue({
    register: vi.fn(),
    busy: false,
    error: "",
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("event browsing shows the number of registration slots remaining", () => {
  useRegistrationResource.mockReturnValue({ data: { events: [EVENT] } });
  render(<MemoryRouter><EventListPage /></MemoryRouter>);

  expect(screen.getByText("Slots left: 3")).toBeInTheDocument();
});

test("event registration details show slots remaining alongside event information", () => {
  useRegistrationResource.mockReturnValue({ data: { event: EVENT } });
  render(
    <MemoryRouter initialEntries={[`/events/${EVENT.id}`]}>
      <Routes>
        <Route path="/events/:eventId" element={<EventDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );

  expect(screen.getByText("Slots left: 3")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /register for this event/i })).toBeInTheDocument();
});

test("full events show zero slots and do not display the registration form", () => {
  useRegistrationResource.mockReturnValue({
    data: { event: { ...EVENT, enrolled_attendees: 10 } },
  });
  render(
    <AuthContext.Provider value={{ token: null }}>
      <MemoryRouter initialEntries={[`/events/${EVENT.id}`]}>
        <Routes>
          <Route path="/events/:eventId" element={<EventDetailPage />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );

  expect(screen.getByText("0 slots left · Full")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Event waitlist" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /register for this event/i })).not.toBeInTheDocument();
});

test("uncapped events display unlimited availability", () => {
  useRegistrationResource.mockReturnValue({
    data: { event: { ...EVENT, expected_attendance: null } },
  });
  render(
    <MemoryRouter initialEntries={[`/events/${EVENT.id}`]}>
      <Routes>
        <Route path="/events/:eventId" element={<EventDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );

  expect(screen.getByText("Slots left: Unlimited")).toBeInTheDocument();
});
