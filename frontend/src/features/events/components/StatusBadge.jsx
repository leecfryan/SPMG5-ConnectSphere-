import { statusLabels } from "../statuses";

export default function StatusBadge({ status }) {
  const label = statusLabels[status] ?? status;
  return (
    <span className={`status-badge status-${String(status).toLowerCase()}`}>
      {label}
    </span>
  );
}
