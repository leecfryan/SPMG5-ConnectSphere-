// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AuthContext } from "../../auth/useAuth";
import WaitlistPanel from "./WaitlistPanel";
import {
  acceptWaitlistOffer,
  getWaitlistPosition,
  joinWaitlist,
  updateWaitlistDetails,
} from "../waitlistService";

vi.mock("../waitlistService", () => ({
  acceptWaitlistOffer: vi.fn(),
  declineWaitlistOffer: vi.fn(),
  getWaitlistPosition: vi.fn(),
  joinWaitlist: vi.fn(),
  updateWaitlistDetails: vi.fn(),
  withdrawFromWaitlist: vi.fn(),
}));

const EVENT_ID = "event-1";
const ENTRY = {
  id: "entry-1",
  event_id: EVENT_ID,
  status: "active",
  offer_state: null,
};

function renderPanel(fields = []) {
  return render(
    <AuthContext.Provider value={{ token: "attendee-token" }}>
      <WaitlistPanel eventId={EVENT_ID} fields={fields} />
    </AuthContext.Provider>,
  );
}

beforeEach(() => {
  getWaitlistPosition.mockResolvedValue({
    entry: null,
    position: null,
    effective_deadline: null,
    server_time: null,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("joining with registration fields saves the attendee's details and shows their position", async () => {
  joinWaitlist.mockResolvedValue({ entry: ENTRY, position: 1 });
  renderPanel([{ id: "dietary", label: "Dietary requirements", required: true }]);

  fireEvent.change(await screen.findByLabelText("Dietary requirements"), {
    target: { value: "Vegetarian" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Join waitlist" }));

  await screen.findByText("Your waitlist position: 1.");
  expect(joinWaitlist).toHaveBeenCalledWith(EVENT_ID, "attendee-token", {
    dietary: "Vegetarian",
  });
});

test("an offered attendee sees the deadline countdown and can accept", async () => {
  const serverTime = new Date();
  getWaitlistPosition.mockResolvedValue({
    entry: { ...ENTRY, offer_state: "offered", registration_data: {} },
    position: 1,
    effective_deadline: new Date(serverTime.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    server_time: serverTime.toISOString(),
  });
  acceptWaitlistOffer.mockResolvedValue({});
  renderPanel();

  expect(await screen.findByTestId("waitlist-offer-countdown")).toHaveTextContent("3 days");
  fireEvent.click(screen.getByRole("button", { name: "Accept offer" }));

  expect(await screen.findByText("Registration confirmed.")).toBeInTheDocument();
  expect(acceptWaitlistOffer).toHaveBeenCalledWith(EVENT_ID, "attendee-token");
});

test("a legacy offer can save missing required details before acceptance", async () => {
  const serverTime = new Date();
  const deadline = new Date(serverTime.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString();
  getWaitlistPosition.mockResolvedValue({
    entry: { ...ENTRY, offer_state: "offered", registration_data: null },
    position: 1,
    effective_deadline: deadline,
    server_time: serverTime.toISOString(),
  });
  updateWaitlistDetails.mockResolvedValue({
    entry: {
      ...ENTRY,
      offer_state: "offered",
      registration_data: { dietary: "No restrictions" },
    },
    effective_deadline: deadline,
    server_time: serverTime.toISOString(),
  });
  acceptWaitlistOffer.mockResolvedValue({});
  renderPanel([{ id: "dietary", label: "Dietary requirements", required: true }]);

  fireEvent.change(await screen.findByLabelText("Dietary requirements"), {
    target: { value: "No restrictions" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save details" }));
  await waitFor(() => expect(updateWaitlistDetails).toHaveBeenCalledWith(
    EVENT_ID,
    "attendee-token",
    { dietary: "No restrictions" },
  ));
  fireEvent.click(await screen.findByRole("button", { name: "Accept offer" }));
  expect(await screen.findByText("Registration confirmed.")).toBeInTheDocument();
});
