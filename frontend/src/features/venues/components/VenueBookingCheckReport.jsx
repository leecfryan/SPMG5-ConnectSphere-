import { IconCheck } from "./VenueIcons";
import { formatDate } from "../venueFormat";

// SCRUM-138: the report for one event's venue bookings. Each booking is shown
// on its own — the venue's own card, its own three checks and its own reasons —
// so a problem with one venue is never hidden behind another's result.
//
// Read-only by design: this component only renders what the check found, so it
// cannot alter any booking's status.

const SLOT_LABELS = { am: "AM", pm: "PM", night: "Night" };

const CHECKS = [
  { key: "suitability", label: "Suitability" },
  { key: "availability", label: "Availability" },
  { key: "conflicts", label: "Conflicts" },
];

// Word and colour together: the outcome is readable without relying on colour.
// "Not checked" is only ever a whole booking's outcome, never one check's: a
// booking with nothing live is shown with its note instead of its checks.
const OUTCOMES = {
  passed: { label: "Passed", status: "confirmed" },
  failed: { label: "Failed", status: "rejected" },
  not_checked: { label: "Not checked", status: "unknown" },
};

// Check rows are only drawn for a booked check, and a booked check is always
// decided: a booking with nothing live is shown with its note instead.
function outcomeFor(passed) {
  return passed ? OUTCOMES.passed : OUTCOMES.failed;
}

function CheckRow({ label, check }) {
  const outcome = outcomeFor(check.passed);

  return (
    <li className="v-bcheck-row">
      <span className="v-bcheck-name">{label}</span>
      <span className={`v-status v-status-${outcome.status}`}>{outcome.label}</span>
      {check.reasons.length > 0 && (
        <ul className="v-bcheck-reasons">
          {check.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
    </li>
  );
}

function VenueCheckCard({ result }) {
  // The backend only reports one of the three outcomes; there is nothing to
  // guard against here.
  const outcome = OUTCOMES[result.overall];

  return (
    <article className="v-card v-check-card">
      <header className="v-request-header">
        <div>
          <h3 className="v-request-title">{result.venue_name}</h3>
          <p className="v-meta">
            <span>{formatDate(result.booking_date, { weekday: true, year: true })}</span>
            <span>{result.slots.map((slot) => SLOT_LABELS[slot]).join(", ")}</span>
          </p>
        </div>
        <span className={`v-status v-status-${outcome.status}`}>{outcome.label}</span>
      </header>

      {result.note ? (
        <div className="v-request-body">
          <p className="v-hint">{result.note}</p>
        </div>
      ) : (
        <div className="v-request-body">
          <ul className="v-bcheck-list">
            {CHECKS.map(({ key, label }) => (
              <CheckRow key={key} label={label} check={result[key]} />
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

function VenueBookingCheckReport({ report }) {
  if (report.results.length === 0) {
    return (
      <div className="v-card v-empty">
        <div className="v-empty-icon">
          <IconCheck size={22} />
        </div>
        <p className="v-empty-title">No bookings to check.</p>
        <p>This event has no venue booking requests yet.</p>
      </div>
    );
  }

  return (
    <div className="v-request-list">
      {report.results.map((result) => (
        <VenueCheckCard key={result.booking_id} result={result} />
      ))}
    </div>
  );
}

export default VenueBookingCheckReport;
