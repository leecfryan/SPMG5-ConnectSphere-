const statusConfig = {
  pending:   { label: "Pending" },
  confirmed: { label: "Confirmed" },
  withdrawn: { label: "Withdrawn" },
};

export default function RegistrationStatusBadge({ status }) {
  const config = statusConfig[status] ?? { label: status };
  return (
    <span className={`registration-status registration-status--${status}`}>
      {config.label}
    </span>
  );
}
