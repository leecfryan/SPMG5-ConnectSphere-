// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import StatusBadge from "./StatusBadge";

afterEach(cleanup);

// SCRUM-97 AC4: every lifecycle status is shown to the user as words, never
// as colour alone. "Approved – planning" is the agreed display for APPROVED.
const EXPECTED_LABELS = [
  ["DRAFT", "Draft"],
  ["SUBMITTED", "Submitted"],
  ["UNDER_REVIEW", "Under review"],
  ["APPROVED", "Approved – planning"],
  ["CONFIRMED", "Confirmed"],
  ["COMPLETED", "Completed"],
  ["CANCELLED", "Cancelled"],
  ["REJECTED", "Rejected"],
];

describe("StatusBadge", () => {
  it.each(EXPECTED_LABELS)("[SCRUM-97-UI-001] shows %s as \"%s\"", (status, label) => {
    render(<StatusBadge status={status} />);
    expect(screen.getByText(label)).toHaveClass("status-badge", `status-${status.toLowerCase()}`);
  });

  it("[SCRUM-97-UI-002] shows an unknown status as-is rather than hiding it", () => {
    render(<StatusBadge status="ON_HOLD" />);
    expect(screen.getByText("ON_HOLD")).toBeInTheDocument();
  });
});
