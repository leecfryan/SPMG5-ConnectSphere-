import { STATUS_LABELS } from "../statuses";

export default function StatusBadge({ status }) {
  const label = STATUS_LABELS[status] ?? status;
  return (
    <span className={`status-badge status-${String(status).toLowerCase()}`}>
      {label}
    </span>
  );
}
