// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import EventCancellationSummary from "./EventCancellationSummary";

afterEach(cleanup);

// 2099-10-10T02:30:00Z is 10:30 am on 10 Oct in Asia/Singapore (vitest.config TZ).
const CANCELLED = {
  id: "aaaaaaaa-0148-4000-8000-000000000002", status: "CANCELLED",
  cancelled_by_name: "Ada Tan", cancelled_at: "2099-10-10T02:30:00Z", cancellation_reason: "Venue flooded.",
};

function detail(label) {
  const term = screen.getByText(label, { selector: "dt" });
  return within(term.parentElement).getByRole("definition").textContent;
}

test("[TC-148-17] a cancelled event shows who cancelled it, when, and why", () => {
  render(<EventCancellationSummary event={CANCELLED} />);

  expect(screen.getByRole("region", { name: "Cancellation" })).toBeInTheDocument();
  expect(detail("Cancelled by")).toBe("Ada Tan");
  expect(detail("Cancelled on")).toMatch(/(10 Oct|Oct 10),? 2099.*10:30/);
  expect(detail("Reason")).toBe("Venue flooded.");
});

test("[TC-148-17] a canceller whose account no longer exists reads Not recorded", () => {
  render(<EventCancellationSummary event={{ ...CANCELLED, cancelled_by_name: null }} />);
  expect(detail("Cancelled by")).toBe("Not recorded");
});

test.each(["SUBMITTED", "UNDER_REVIEW", "APPROVED", "CONFIRMED"])(
  "[TC-148-17] an un-cancelled %s event shows no cancellation summary", (status) => {
    render(<EventCancellationSummary event={{ id: CANCELLED.id, status, cancelled_at: null }} />);
    expect(screen.queryByRole("region", { name: "Cancellation" })).not.toBeInTheDocument();
  });
