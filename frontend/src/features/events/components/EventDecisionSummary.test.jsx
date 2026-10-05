// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import EventDecisionSummary from "./EventDecisionSummary";

afterEach(cleanup);

// 2099-10-10T02:30:00Z is 10:30 am on 10 Oct in Asia/Singapore (vitest.config TZ).
// The day/month order follows the machine's locale (en-SG here, often en-US in CI).
const DECIDED = { id: "aaaaaaaa-0099-4000-8000-000000000001", decided_by_name: "Ada Tan", decided_at: "2099-10-10T02:30:00Z" };

function detail(label) {
  const term = screen.getByText(label, { selector: "dt" });
  return within(term.parentElement).getByRole("definition").textContent;
}

test("[SCRUM-99-UI-004] AC3: an approval shows the decision, the approver and the time", () => {
  render(<EventDecisionSummary event={{ ...DECIDED, status: "APPROVED", decision_note: "Ready for planning." }} />);

  expect(screen.getByRole("region", { name: "Review decision" })).toBeInTheDocument();
  expect(detail("Outcome")).toBe("Approved – planning");
  expect(detail("Decided by")).toBe("Ada Tan");
  expect(detail("Decided on")).toMatch(/(10 Oct|Oct 10),? 2099.*10:30/);
  expect(detail("Note")).toBe("Ready for planning.");
});

test("[SCRUM-99-UI-005] AC3: a later status (CONFIRMED) still shows the original approval", () => {
  render(<EventDecisionSummary event={{ ...DECIDED, status: "CONFIRMED" }} />);
  expect(detail("Outcome")).toBe("Approved – planning");
});

test("[SCRUM-98-UI-008] AC3: a rejection shows the outcome and its reason", () => {
  render(<EventDecisionSummary event={{ ...DECIDED, status: "REJECTED", decision_note: "Dates clash with exams." }} />);

  expect(detail("Outcome")).toBe("Rejected");
  expect(detail("Reason")).toBe("Dates clash with exams.");
});

test("[SCRUM-99-UI-006] AC3: an approval without a note shows no note row", () => {
  render(<EventDecisionSummary event={{ ...DECIDED, status: "APPROVED", decision_note: null }} />);
  expect(screen.queryByText("Note", { selector: "dt" })).not.toBeInTheDocument();
});

test("[SCRUM-99-UI-007] boundary: an approver whose account no longer exists reads Not recorded", () => {
  render(<EventDecisionSummary event={{ ...DECIDED, status: "APPROVED", decided_by_name: null }} />);
  expect(detail("Decided by")).toBe("Not recorded");
});

test.each(["SUBMITTED", "UNDER_REVIEW"])("[SCRUM-99-UI-008] AC3: an undecided %s event shows no decision", (status) => {
  render(<EventDecisionSummary event={{ id: DECIDED.id, status, decided_at: null }} />);
  expect(screen.queryByRole("region", { name: "Review decision" })).not.toBeInTheDocument();
});
