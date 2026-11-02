// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import EventPostponedNotice from "./EventPostponedNotice";

afterEach(cleanup);

const POSTPONED = { id: "aaaaaaaa-0170-4000-8000-000000000001", status: "POSTPONED", postponement_reason: "Speaker unavailable." };

test("[TC-SCRUM-170-12] a postponed event says it is postponed, has no new date, released its venues, and why", () => {
  render(<EventPostponedNotice event={POSTPONED} />);

  const notice = screen.getByRole("region", { name: "This event is postponed" });
  expect(notice).toHaveTextContent("No new date has been set yet.");
  expect(notice).toHaveTextContent("Its venue bookings and holds were released");
  expect(notice).toHaveTextContent("Speaker unavailable.");
});

test("[TC-SCRUM-170-12] a postponed event with no recorded reason still shows the notice, without an empty quote", () => {
  const { container } = render(<EventPostponedNotice event={{ ...POSTPONED, postponement_reason: null }} />);

  expect(screen.getByRole("region", { name: "This event is postponed" })).toBeInTheDocument();
  expect(container.querySelector("blockquote")).toBeNull();
});

test("[TC-SCRUM-170-20] a postponement that gave a new date shows it, and says fitting venues moved", () => {
  render(<EventPostponedNotice event={{ ...POSTPONED, activity: [
    { id: "a2", action: "EVENT_POSTPONED", new_start: "2099-07-08T01:00:00Z" },
    { id: "a1", action: "CHANGES_REQUESTED" },
  ] }} />);

  const notice = screen.getByRole("region", { name: "This event is postponed" });
  expect(notice).toHaveTextContent(/New date: (8 Jul|Jul 8),? 2099.*9:00/);
  expect(notice).toHaveTextContent("moved to the new date for Venue Staff to approve again");
  expect(notice).not.toHaveTextContent("No new date has been set yet.");
});

test.each(["SUBMITTED", "UNDER_REVIEW", "CHANGES_REQUESTED", "APPROVED", "SAFETY_REVIEW", "PREPARATION", "CONFIRMED", "CANCELLED"])(
  "[TC-SCRUM-170-12] a %s event shows no postponed notice", (status) => {
    render(<EventPostponedNotice event={{ ...POSTPONED, status }} />);
    expect(screen.queryByRole("region", { name: "This event is postponed" })).not.toBeInTheDocument();
  });
