import { useEffect, useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { fetchConflictFlags } from "../venueConflictsService";
import { IconAlert, IconArrowLeft, IconCalendar } from "../components/VenueIcons";
import { formatDate } from "../venueFormat";

// SCRUM-135: Venue Staff view confirmed bookings whose setup or turnaround
// buffer now overlaps another booking after a venue time-setting change.

const SLOT_LABELS = { am: "AM", pm: "PM", night: "Night" };
const SLOT_ORDER = ["am", "pm", "night"];

const STATUS_LABELS = {
  pending: "Pending review",
  confirmed: "Confirmed",
  rejected: "Rejected",
  cancelled: "Cancelled",
  mixed: "Partly decided",
  unknown: "Unknown",
};

function slotSummary(slotRows) {
  const slots = slotRows.map((r) => r.slot);
  if (slots.length === SLOT_ORDER.length) return "Full day (AM, PM, Night)";
  return SLOT_ORDER.filter((s) => slots.includes(s))
    .map((s) => SLOT_LABELS[s])
    .join(", ");
}

function ConflictCard({ request }) {
  return (
    <article className="v-card">
      <header className="v-request-header">
        <div>
          <h2 className="v-request-title">{request.event.name}</h2>
          <p className="v-meta">
            <IconCalendar size={14} />
            {formatDate(request.booking_date, { weekday: true, year: true })}
            {" · "}
            {slotSummary(request.slots)}
          </p>
        </div>
        <span className={`v-status v-status-${request.status}`}>
          {STATUS_LABELS[request.status] || request.status}
        </span>
      </header>

      <ul className="v-stack" style={{ marginTop: 12, listStyle: "none", padding: 0 }}>
        {request.conflict_flags.map((flag, i) => (
          <li key={i} className="v-alert v-alert-error" role="alert">
            <IconAlert />
            <span>{flag.reason}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

function VenueConflictsPage({ venue, onBack }) {
  const { token } = useAuth();
  const [requests, setRequests] = useState(null);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    let active = true;
    fetchConflictFlags(venue.id, token)
      .then((res) => { if (active) setRequests(res.data); })
      .catch((err) => { if (active) setLoadError(err.message); });
    return () => { active = false; };
  }, [venue.id, token]);

  return (
    <div className="v-page-narrow">
      <button type="button" className="v-back" onClick={onBack}>
        <IconArrowLeft />
        Back to venue
      </button>

      <header className="v-page-header">
        <div>
          <p className="v-eyebrow">{venue.name}</p>
          <h1 className="v-title">Conflict flags</h1>
          <p className="v-subtitle">
            Confirmed bookings whose setup or turnaround buffer now overlaps
            another booking. No booking has been changed — resolve each conflict
            deliberately.
          </p>
        </div>
      </header>

      {loadError && (
        <p className="v-alert v-alert-error" role="alert">
          <IconAlert />
          <span>Could not load conflict flags: {loadError}</span>
        </p>
      )}

      {!loadError && requests === null && (
        <p role="status">Loading conflict flags…</p>
      )}

      {!loadError && requests !== null && requests.length === 0 && (
        <div className="v-card v-empty">
          <p className="v-empty-title">No conflict flags.</p>
          <p>
            All confirmed bookings are compatible with the current setup and
            turnaround times.
          </p>
        </div>
      )}

      {!loadError && requests !== null && requests.length > 0 && (
        <div className="v-stack">
          {requests.map((r) => (
            <ConflictCard key={r.id} request={r} />
          ))}
        </div>
      )}
    </div>
  );
}

export default VenueConflictsPage;
