// @vitest-environment jsdom
// SCRUM-37: event.significant_edit gets a friendly label instead of the raw
// action string; the note itself (which fields actually changed) comes from
// apply_organiser_event_edit (SQL) and is rendered as-is.
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";
import EventActivityHistory from "./EventActivityHistory";

afterEach(cleanup);

function entries(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: `a${i}`, action: "event.ordinary_edit", created_at: `2026-10-${22 - i}T10:00:00Z`,
    note: `Changed: field${i}. No re-approval needed.`,
  }));
}

test("a significant-edit entry shows a friendly label and the specific fields that changed", () => {
  render(<EventActivityHistory activity={[{
    id: "a1", action: "event.significant_edit", created_at: "2026-10-22T10:00:00Z",
    note: "Changed: start time, venue requirements. Sent back for the coordinator's re-approval.",
  }]} />);

  expect(screen.getByText(/Significant change/)).toBeInTheDocument();
  expect(screen.getByText(/Changed: start time, venue requirements/)).toBeInTheDocument();
  expect(screen.queryByText(/event\.significant_edit/)).not.toBeInTheDocument();
});

test("an ordinary-edit entry shows a friendly label and names the changed fields, no re-approval wording", () => {
  render(<EventActivityHistory activity={[{
    id: "a2", action: "event.ordinary_edit", created_at: "2026-10-22T10:00:00Z",
    note: "Changed: description. No re-approval needed.",
  }]} />);

  expect(screen.getByText(/Normal change/)).toBeInTheDocument();
  expect(screen.getByText(/Changed: description\. No re-approval needed/)).toBeInTheDocument();
});

test("an unmapped action falls back to the raw string rather than hiding it", () => {
  render(<EventActivityHistory activity={[{ id: "a1", action: "something.unexpected", created_at: null, note: null }]} />);

  expect(screen.getByText(/something\.unexpected/)).toBeInTheDocument();
});

test("only the three most recent entries show by default when there are more", () => {
  render(<EventActivityHistory activity={entries(5)} />);

  expect(screen.getByText(/field0/)).toBeInTheDocument();
  expect(screen.getByText(/field2/)).toBeInTheDocument();
  expect(screen.queryByText(/field3/)).not.toBeInTheDocument();
  expect(screen.queryByText(/field4/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Show 2 more" })).toBeInTheDocument();
});

test("expanding reveals every entry and the button flips to collapse it again", async () => {
  const user = userEvent.setup();
  render(<EventActivityHistory activity={entries(5)} />);

  await user.click(screen.getByRole("button", { name: "Show 2 more" }));

  expect(screen.getByText(/field4/)).toBeInTheDocument();
  const collapseButton = screen.getByRole("button", { name: "Show fewer" });
  expect(collapseButton).toHaveAttribute("aria-expanded", "true");

  await user.click(collapseButton);

  expect(screen.queryByText(/field4/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Show 2 more" })).toBeInTheDocument();
});

test("no expand button when there are three or fewer entries", () => {
  render(<EventActivityHistory activity={entries(3)} />);

  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
