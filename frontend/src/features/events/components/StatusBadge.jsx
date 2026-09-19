// Labels for events.status. DRAFT is listed though phase one never sets it, so
// the badge is ready when US-13 adds drafts. An unknown status shows as-is
// rather than blank, so a new backend state is visible instead of hidden.
const LABELS = Object.freeze({
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
});

export default function StatusBadge({ status }) {
  const label = LABELS[status] ?? status;
  return (
    <span className={`status-badge status-${String(status).toLowerCase()}`}>
      {label}
    </span>
  );
}
