import { useAuth } from "../../auth/useAuth";
import { useState, useEffect } from "react";
import { decideBookingRequest, fetchBookingRequests } from "../../../lib/api";
import {
  IconAlert,
  IconArrowLeft,
  IconCalendar,
  IconClock,
  IconInbox,
  IconMapPin,
  IconUsers,
  IconCheck,
} from "./VenueIcons";
import { formatDate, formatDateTime } from "../venueFormat";

// SCRUM-88: submitted requests available to Venue Staff for review.
// SCRUM-22: Venue Staff decide them here. Approving confirms every slot on the
// request; rejecting records the decision and changes no booking, because any
// resulting change is the Event Coordinator's to make.

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

function slotSummary(slotRows) {
  const slots = slotRows.map((row) => row.slot);
  if (slots.length === SLOT_ORDER.length) return "Full day (AM, PM, Night)";
  return SLOT_ORDER.filter((slot) => slots.includes(slot))
    .map((slot) => SLOT_LABELS[slot])
    .join(", ");
}

function ChipsOrNone({ items }) {
  if (items.length === 0) return <p className="v-none">None</p>;
  return (
    <ul className="v-chips">
      {items.map((item) => (
        <li key={item} className="v-chip">
          {item}
        </li>
      ))}
    </ul>
  );
}

// SCRUM-22. Shown only to reviewers who hold bookings.decide, and only while
// the request is still awaiting a decision.
function DecisionPanel({ request, onDecided }) {
  const { token } = useAuth();
  const [isRejecting, setIsRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  // SCRUM-20: a clash is kept apart from an ordinary failure, because it is an
  // answer about the booking rather than something that went wrong.
  const [conflict, setConflict] = useState(null);

  const requestId = request.id;
  // SCRUM-102: read during render rather than inside the handler, so the
  // disabled state and the hint both follow what is typed.
  const hasReason = note.trim() !== "";

  function decide(decision) {
    setBusy(decision);
    setError(null);

    decideBookingRequest(requestId, decision, note.trim() === "" ? null : note.trim(), token)
      .then(onDecided)
      .catch((err) => {
        // 409 means the database refused the approval because a slot is
        // already confirmed elsewhere. The request is untouched and still
        // pending, so the decide buttons are replaced by a refresh rather
        // than inviting the reviewer to try the same thing again.
        if (err.status === 409) setConflict(err.message);
        else setError(err.message);
      })
      .finally(() => setBusy(null));
  }

  // SCRUM-20: nothing was written, so the only useful next step is to look at
  // what is actually committed now.
  if (conflict) {
    return (
      <div className="v-decision">
        <p className="v-alert v-alert-error" role="alert">
          <IconAlert />
          <span>{conflict}</span>
        </p>
        <p className="v-hint">
          This request has not been changed and is still pending. It cannot be
          approved while another event holds the slot.
        </p>
        <div className="v-decision-actions">
          <button type="button" className="v-btn v-btn-primary" onClick={onDecided}>
            Refresh list
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="v-decision">
      {isRejecting && (
        <label className="v-field">
          {/* SCRUM-102: required on a rejection, and the same box carries the
              suggested alternative. */}
          <span className="v-label">Reason, and a suggested alternative if you have one</span>
          <textarea
            className="v-input"
            rows="2"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. already held for another event, try Orchard Seminar Room 3"
            required
          />
          <span className="v-hint">
            {hasReason
              ? "Shared with the coordinator, who makes any resulting booking change."
              : "A reason is required to reject. It is shared with the coordinator, who makes any resulting booking change."}
          </span>
        </label>
      )}

      {error && (
        <p className="v-alert v-alert-error" role="alert">
          <IconAlert />
          <span>{error}</span>
        </p>
      )}

      <div className="v-decision-actions">
        {isRejecting ? (
          <>
            <button
              type="button"
              className="v-btn v-btn-secondary"
              onClick={() => { setIsRejecting(false); setNote(""); setError(null); }}
              disabled={busy !== null}
            >
              Cancel
            </button>
            <button
              type="button"
              className="v-btn v-btn-danger"
              onClick={() => decide("rejected")}
              disabled={busy !== null || !hasReason}
              title={hasReason ? undefined : "Type a reason first"}
            >
              {busy === "rejected" ? "Rejecting..." : "Confirm rejection"}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="v-btn v-btn-secondary"
              onClick={() => setIsRejecting(true)}
              disabled={busy !== null}
            >
              <IconAlert />
              Reject
            </button>
            <button
              type="button"
              className="v-btn v-btn-primary"
              onClick={() => decide("confirmed")}
              disabled={busy !== null}
            >
              <IconCheck />
              {busy === "confirmed" ? "Approving..." : "Approve"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function RequestCard({ request, canDecide, onDecided }) {
  const hasTiming = Boolean(request.event.start_time && request.event.end_time);

  return (
    <article className="v-card v-request">
      <header className="v-request-header">
        <div>
          <h2 className="v-request-title">{request.event.name}</h2>
          {/* SCRUM-85 */}
          <p className="v-meta">
            <span>
              <IconMapPin size={14} />
              {request.venue.name}, {request.venue.city}
            </span>
          </p>
        </div>
        <span className={`v-status v-status-${request.status}`}>
          {STATUS_LABELS[request.status] || request.status}
        </span>
      </header>

      <div className="v-request-body">
        {/* SCRUM-86: what was asked for, next to when the event actually runs */}
        <div className="v-facts">
          <div className="v-fact">
            <p className="v-fact-label">
              <IconCalendar size={13} />
              Requested
            </p>
            <p className="v-fact-value">{formatDate(request.booking_date, { weekday: true, year: true })}</p>
            <p className="v-fact-sub">{slotSummary(request.slots)}</p>
          </div>

          <div className="v-fact">
            <p className="v-fact-label">
              <IconClock size={13} />
              Event timing
            </p>
            {hasTiming ? (
              <>
                <p className="v-fact-value">{formatDateTime(request.event.start_time)}</p>
                <p className="v-fact-sub">to {formatDateTime(request.event.end_time)}</p>
              </>
            ) : (
              <p className="v-fact-value">No timing recorded</p>
            )}
          </div>

          {/* SCRUM-87 */}
          <div className="v-fact">
            <p className="v-fact-label">
              <IconUsers size={13} />
              Attendees
            </p>
            <p className="v-fact-value">
              {request.expected_attendees} of {request.venue.capacity} capacity
            </p>
            <p className="v-fact-sub">{request.room_layout} layout</p>
          </div>
        </div>

        <div className="v-request-requirements">
          <div>
            <p className="v-subheading">Facilities</p>
            <ChipsOrNone items={request.required_facilities} />
          </div>
          <div>
            <p className="v-subheading">Accessibility</p>
            <ChipsOrNone items={request.accessibility_requirements} />
          </div>
          <div>
            <p className="v-subheading">Other requirements</p>
            <p className={request.additional_requirements ? "v-notes" : "v-none"}>
              {request.additional_requirements || "None"}
            </p>
          </div>
        </div>
      </div>

      {/* SCRUM-22: only pending requests are still open to a decision */}
      {canDecide && request.status === "pending" && (
        <div className="v-request-body">
          <DecisionPanel request={request} onDecided={onDecided} />
        </div>
      )}

      {request.decided_at && (
        <div className="v-request-body">
          <p className="v-subheading">Decision</p>
          <p className="v-fact-value">
            {STATUS_LABELS[request.status] || request.status} on{" "}
            {formatDateTime(request.decided_at)}
          </p>
          {request.decision_note && <p className="v-notes">{request.decision_note}</p>}
        </div>
      )}

      <footer className="v-request-footer">
        <span>Submitted {formatDateTime(request.submitted_at)}</span>
        <span>
          Reference <span className="v-mono">{request.id}</span>
        </span>
      </footer>
    </article>
  );
}

function VenueBookingRequestList({ onBack }) {
  const { token, hasPermission } = useAuth();
  const canDecide = hasPermission("bookings.decide");
  const [status, setStatus] = useState("pending");
  const [result, setResult] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const queryKey = JSON.stringify([status, token, refreshKey]);
  const current = result?.key === queryKey;
  const requests = current ? result.requests : [];
  const isLoading = !current;
  const error = current ? result.error : null;

  useEffect(() => {
    let active = true;
    fetchBookingRequests({ status }, token)
      .then((requests) => { if (active) setResult({ key: queryKey, requests }); })
      .catch((err) => { if (active) setResult({ key: queryKey, requests: [], error: err.message }); });
    return () => { active = false; };
  }, [status, token, queryKey]);

  return (
    <div className="venue-booking-requests">
      <button type="button" className="v-back" onClick={onBack}>
        <IconArrowLeft />
        Back to catalogue
      </button>

      <header className="v-page-header">
        <div>
          <p className="v-eyebrow">For Venue Staff to review</p>
          <h1 className="v-title">Venue booking requests</h1>
          <p className="v-subtitle">
            Requests submitted by event coordinators, with the event timing and
            venue requirements needed to assess them.
          </p>
        </div>

        <label className="v-filter-field">
          Show
          <select
            className="v-input"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {STATUS_FILTERS.map((filter) => (
              <option key={filter.value} value={filter.value}>
                {filter.label}
              </option>
            ))}
          </select>
        </label>
      </header>

      {error && (
        <p className="v-alert v-alert-error" role="alert">
          <IconAlert />
          <span>Could not load requests: {error}</span>
        </p>
      )}

      {isLoading && (
        <div className="v-request-list" aria-label="Loading requests...">
          {[0, 1].map((key) => (
            <div key={key} className="v-card v-skeleton-card">
              <div className="v-skeleton" style={{ width: "40%", height: 20 }} />
              <div className="v-skeleton" style={{ width: "25%", height: 14 }} />
              <div className="v-skeleton" style={{ height: 76 }} />
            </div>
          ))}
        </div>
      )}

      {!isLoading && !error && requests.length === 0 && (
        <div className="v-card v-empty">
          <div className="v-empty-icon">
            <IconInbox size={22} />
          </div>
          <p className="v-empty-title">No requests to show.</p>
          <p>New requests appear here as soon as a coordinator submits them.</p>
        </div>
      )}

      {!isLoading && !error && requests.length > 0 && (
        <>
          <p className="v-results-count">
            {requests.length} {requests.length === 1 ? "request" : "requests"}
          </p>
          <div className="v-request-list">
            {requests.map((request) => (
              <RequestCard
                key={request.id}
                request={request}
                canDecide={canDecide}
                onDecided={() => setRefreshKey((key) => key + 1)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default VenueBookingRequestList;
