// Labels for events.status, one per status in backend lifecycle.js (SCRUM-97).
// APPROVED reads "Approved – planning": the stored value stays APPROVED because
// other lanes query it. An unknown status shows as-is rather than blank, so a
// new backend state is visible instead of hidden.
const LABELS = Object.freeze({
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under review",
  APPROVED: "Approved – planning",
  SAFETY_REVIEW: "Safety review",
  CONFIRMED: "Confirmed",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  REJECTED: "Rejected",
});

export default function StatusBadge({ status }) {
  const label = LABELS[status] ?? status;
  return (
    <span className={`status-badge status-${String(status).toLowerCase()}`}>
      {label}
    </span>
  );
}
