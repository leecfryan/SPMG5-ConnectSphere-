import { useState, useEffect } from "react";
import { fetchBookingRequests } from "../../../lib/api";
import "./VenueBookingRequest.css";

// SCRUM-88: submitted requests available to Venue Staff for review.
// Approving and rejecting are a later story. This view only makes every request
// and its details visible.

const SLOT_LABELS = { am: "AM", pm: "PM", night: "Night" };
const SLOT_ORDER = ["am", "pm", "night"];

const STATUS_FILTERS = [
  { value: "", label: "All" },
  { value: "pending", label: "Pending review" },
  { value: "confirmed", label: "Confirmed" },
  { value: "rejected", label: "Rejected" },
  { value: "cancelled", label: "Cancelled" },
  { value: "mixed", label: "Partly decided" },
];

const STATUS_LABELS = {
  pending: "Pending review",
  confirmed: "Confirmed",
  rejected: "Rejected",
  cancelled: "Cancelled",
  mixed: "Partly decided",
  unknown: "Unknown",
};

const VENUE_TIME_ZONE = "Asia/Singapore";

function formatDateTime(instant) {
  return new Date(instant).toLocaleString("en-SG", {
    timeZone: VENUE_TIME_ZONE,
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function slotSummary(slotRows) {
  const slots = slotRows.map((row) => row.slot);
  if (slots.length === SLOT_ORDER.length) return "Full day (AM, PM, Night)";
  return SLOT_ORDER.filter((slot) => slots.includes(slot))
    .map((slot) => SLOT_LABELS[slot])
    .join(", ");
}

function listOrNone(items) {
  return items.length > 0 ? items.join(", ") : "None";
}

function VenueBookingRequestList({ onBack }) {
  const [status, setStatus] = useState("pending");
  const [requests, setRequests] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setIsLoading(true);
    setError(null);

    fetchBookingRequests({ status })
      .then((data) => setRequests(data))
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [status]);

  return (
    <div className="venue-booking-requests">
      <button type="button" onClick={onBack}>
        Back to catalogue
      </button>

      <h2>Venue booking requests</h2>
      <p>For Venue Staff to review</p>

      <label>
        Show
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUS_FILTERS.map((filter) => (
            <option key={filter.value} value={filter.value}>
              {filter.label}
            </option>
          ))}
        </select>
      </label>

      {isLoading && <p>Loading requests...</p>}
      {error && <p className="venue-error">Could not load requests: {error}</p>}
      {!isLoading && !error && requests.length === 0 && (
        <p>No requests to show.</p>
      )}

      {!isLoading && !error && requests.map((request) => (
        <article key={request.id} className="venue-request-card">
          <header>
            <h3>{request.event.name}</h3>
            <span className={`venue-request-status venue-request-status-${request.status}`}>
              {STATUS_LABELS[request.status] || request.status}
            </span>
          </header>

          <dl className="venue-request-summary">
            {/* SCRUM-85 */}
            <dt>Venue</dt>
            <dd>
              {request.venue.name}, {request.venue.city}
            </dd>

            {/* SCRUM-86: what was asked for, next to when the event actually runs */}
            <dt>Requested</dt>
            <dd>
              {request.booking_date}, {slotSummary(request.slots)}
            </dd>
            <dt>Event timing</dt>
            <dd>
              {request.event.start_time && request.event.end_time
                ? `${formatDateTime(request.event.start_time)} to ${formatDateTime(request.event.end_time)}`
                : "No timing recorded"}
            </dd>

            {/* SCRUM-87 */}
            <dt>Attendees</dt>
            <dd>
              {request.expected_attendees} of {request.venue.capacity} capacity
            </dd>
            <dt>Room layout</dt>
            <dd>{request.room_layout}</dd>
            <dt>Facilities</dt>
            <dd>{listOrNone(request.required_facilities)}</dd>
            <dt>Accessibility</dt>
            <dd>{listOrNone(request.accessibility_requirements)}</dd>
            <dt>Other requirements</dt>
            <dd>{request.additional_requirements || "None"}</dd>

            <dt>Submitted</dt>
            <dd>{formatDateTime(request.submitted_at)}</dd>
            <dt>Reference</dt>
            <dd className="venue-request-reference">{request.id}</dd>
          </dl>
        </article>
      ))}
    </div>
  );
}

export default VenueBookingRequestList;
