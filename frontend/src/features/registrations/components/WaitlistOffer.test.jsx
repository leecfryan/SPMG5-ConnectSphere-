// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { AuthContext } from "../../auth/useAuth";
import WaitlistOffer from "./WaitlistOffer";
import {
  acceptWaitlistOffer,
  declineWaitlistOffer,
  updateWaitlistDetails,
} from "../waitlistService";

vi.mock("../waitlistService", () => ({
  acceptWaitlistOffer: vi.fn(),
  declineWaitlistOffer: vi.fn(),
  updateWaitlistDetails: vi.fn(),
}));

const OFFER = {
  id: "offer-1",
  event_id: "event-1",
  registration_data: {},
  effective_deadline: new Date(Date.now() + 3 * 86400000).toISOString(),
  server_time: new Date().toISOString(),
  event: {
    name: "Community Dinner",
    registration_fields: [],
  },
};

function renderOffer(offer = OFFER, callbacks = {}) {
  return render(
    <AuthContext.Provider value={{ token: "attendee-token" }}>
      <WaitlistOffer offer={offer} {...callbacks} />
    </AuthContext.Provider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("an open offer is distinct and acceptance refreshes the caller's registrations", async () => {
  const onAccepted = vi.fn();
  acceptWaitlistOffer.mockResolvedValue({});
  renderOffer(OFFER, { onAccepted });

  expect(screen.getByText("Place Offered")).toBeInTheDocument();
  expect(screen.getByText("Community Dinner")).toBeInTheDocument();
  expect(screen.getByTestId("waitlist-offer-countdown")).toHaveTextContent("3 days");
  fireEvent.click(screen.getByRole("button", { name: "Accept offer" }));

  await waitFor(() => expect(onAccepted).toHaveBeenCalledOnce());
  expect(acceptWaitlistOffer).toHaveBeenCalledWith("event-1", "attendee-token");
});

test("declining an offer refreshes the caller's registrations", async () => {
  const onRemoved = vi.fn();
  declineWaitlistOffer.mockResolvedValue(null);
  renderOffer(OFFER, { onRemoved });

  fireEvent.click(screen.getByRole("button", { name: "Decline offer" }));
  await waitFor(() => expect(onRemoved).toHaveBeenCalledOnce());
});

test("required registration details must be saved before accepting", async () => {
  updateWaitlistDetails.mockResolvedValue({
    entry: { registration_data: { dietary: "Vegetarian" } },
    effective_deadline: OFFER.effective_deadline,
    server_time: OFFER.server_time,
  });
  acceptWaitlistOffer.mockResolvedValue({});
  renderOffer({
    ...OFFER,
    event: {
      ...OFFER.event,
      registration_fields: [{ id: "dietary", label: "Dietary requirements", required: true }],
    },
  });

  fireEvent.change(await screen.findByLabelText("Dietary requirements"), {
    target: { value: "Vegetarian" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save details" }));
  await waitFor(() => expect(updateWaitlistDetails).toHaveBeenCalledOnce());
  fireEvent.click(await screen.findByRole("button", { name: "Accept offer" }));
  await waitFor(() => expect(acceptWaitlistOffer).toHaveBeenCalledOnce());
});

test("details-required and capacity-conflict errors are shown explicitly", async () => {
  acceptWaitlistOffer.mockRejectedValueOnce(Object.assign(
    new Error("Complete the required registration details before accepting this offer."),
    { code: "details_required", status: 409 },
  ));
  renderOffer(OFFER);

  fireEvent.click(screen.getByRole("button", { name: "Accept offer" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Complete the required registration details");
  expect(await screen.findByRole("button", { name: "Save details" })).toBeInTheDocument();

  cleanup();
  acceptWaitlistOffer.mockRejectedValueOnce(Object.assign(
    new Error("This event no longer has an available place for this offer."),
    { code: "capacity_unavailable", status: 409 },
  ));
  renderOffer(OFFER);

  fireEvent.click(screen.getByRole("button", { name: "Accept offer" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("This event no longer has an available place");
});

test("an expired offer displays its state and refreshes the offer list", async () => {
  const onRemoved = vi.fn();
  renderOffer({
    ...OFFER,
    effective_deadline: new Date(Date.now() - 1000).toISOString(),
    server_time: new Date().toISOString(),
  }, { onRemoved });

  expect(await screen.findByText("This offer has expired.")).toBeInTheDocument();
  await waitFor(() => expect(onRemoved).toHaveBeenCalledOnce());
});
