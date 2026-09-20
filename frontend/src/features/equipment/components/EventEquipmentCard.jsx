import { useState } from "react";
import ClarificationThread from "./ClarificationThread";

// Scrum-28-Scrum64 (AC2): the API only ever accepts APPROVED/REJECTED as a
// target (PENDING is a starting state, never selectable - see
// equipment.validation.js's REVIEW_STATUSES), so "Unattended" stays a
// disabled option: it can be the current value, never a choice.
const STATUS_LABEL = { PENDING: "Unattended", APPROVED: "Assigned", REJECTED: "Issues" };

function formatWindow(startIso, endIso) {
  const fmt = (iso) =>
    new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  return `${fmt(startIso)} – ${fmt(endIso)}`;
}

// Scrum-28-Scrum63 (AC1): one event's requests, collapsed to a summary card
// until clicked. Scrum-28-Scrum64 (AC2): each line's status select.
// Scrum-28-Scrum65/66 (AC3/AC4): the clarification thread, shown once
// expanded, below the equipment lines.
function EventEquipmentCard({
  eventId,
  eventName,
  requestedByNames,
  lines,
  onStatusChange,
  savingId,
  token,
  currentUserId,
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <li className="eq-card eq-event-card" data-event-id={eventId}>
      <button
        type="button"
        className="eq-event-summary"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <div>
          <p className="eq-request-title">{eventName || "Untitled event"}</p>
          <p className="eq-request-detail">Requested by {requestedByNames.join(", ") || "Unknown"}</p>
        </div>
        <span className="eq-badge">{lines.length} {lines.length === 1 ? "request" : "requests"}</span>
      </button>

      {expanded && (
        <ul className="eq-line-list">
          {lines.map((line) => (
            <li key={line.id} className="eq-line-row">
              <div>
                <p className="eq-request-title">
                  {line.equipment_type || line.equipment_id} × {line.quantity_requested}
                </p>
                <p className="eq-request-detail">{formatWindow(line.borrow_start, line.borrow_end)}</p>
                {line.technical_requirement && (
                  <p className="eq-request-detail">{line.technical_requirement}</p>
                )}
              </div>

              <div className="eq-line-status">
                <span className={`eq-status eq-status-${line.status.toLowerCase()}`}>
                  {STATUS_LABEL[line.status]}
                </span>
                <span className="eq-select-wrap">
                  <select
                    aria-label={`Status for ${line.equipment_type || line.equipment_id}`}
                    value={line.status}
                    disabled={savingId === line.id}
                    onChange={(e) => onStatusChange(line.id, e.target.value)}
                  >
                    <option value="PENDING" disabled>Unattended</option>
                    <option value="APPROVED">Assigned</option>
                    <option value="REJECTED">Issues</option>
                  </select>
                  <svg className="eq-field-icon" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
                    <path d="M5 7l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {expanded && (
        <div className="eq-event-card-thread">
          <ClarificationThread
            eventId={eventId}
            lines={lines.map((l) => ({ id: l.id, label: l.equipment_type || l.equipment_id }))}
            token={token}
            currentUserId={currentUserId}
          />
        </div>
      )}
    </li>
  );
}

export default EventEquipmentCard;
