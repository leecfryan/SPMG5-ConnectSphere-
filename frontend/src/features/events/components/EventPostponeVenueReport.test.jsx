// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import EventPostponeVenueReport from "./EventPostponeVenueReport";

afterEach(cleanup);

const REPORT = [
  { booking_id: "req-1", venue_name: "Marina Hall", new_booking_date: "2099-07-08", slots: ["am", "pm"], passed: true, reasons: [] },
  { booking_id: "req-2", venue_name: "Garden Room", new_booking_date: "2099-07-08", slots: ["night"], passed: false,
    reasons: ["Night is already taken by another event (Reserved event)."] },
];

test("[TC-SCRUM-170-21][TC-SCRUM-170-22] each venue says whether it moved to the new date or was released, and why", () => {
  render(<EventPostponeVenueReport report={REPORT} />);

  const items = within(screen.getByRole("region", { name: "Venues for the new date" })).getAllByRole("listitem");
  expect(items[0]).toHaveTextContent(/Marina Hall \((8 Jul|Jul 8),? 2099, AM, PM\): moved to the new date and waiting for Venue Staff to approve it again\./);
  expect(items[1]).toHaveTextContent(/Garden Room \(.*Night\): released\. Night is already taken by another event \(Reserved event\)\./);
});

test("[TC-SCRUM-170-21] an event with no venue bookings says there was nothing to move", () => {
  render(<EventPostponeVenueReport report={[]} />);
  expect(screen.getByRole("region", { name: "Venues for the new date" })).toHaveTextContent("The event had no venue bookings to move.");
});

test("[TC-SCRUM-170-21] no report is shown when no new date was given", () => {
  render(<EventPostponeVenueReport report={null} />);
  expect(screen.queryByRole("region", { name: "Venues for the new date" })).not.toBeInTheDocument();
});
