import { useEffect, useMemo, useState } from "react";
import {
  fetchTechSupportDashboard,
  updateEquipmentRequestStatus,
  fetchCurrentUser,
} from "../../../lib/api";
import EventEquipmentCard from "../components/EventEquipmentCard";
import ErrorModal from "../../../components/ui/ErrorModal";
import "../equipment.css";

// Scrum-28-Scrum63 (AC1): Technical Support Staff review every event's
// equipment requests from one dashboard. Scrum-28-Scrum64 (AC2): update
// each line's status as arrangements are made.
function TechnicalSupportDashboardPage({ token }) {
  const [requests, setRequests] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [forbiddenMessage, setForbiddenMessage] = useState(null);
  // This page mounts for every signed-in user (App.jsx has no client-side
  // role check), so a plain Event Coordinator loading it is expected to
  // 403 here - that's not an action they took being denied, just a section
  // that isn't theirs. Tracked separately from forbiddenMessage/ErrorModal
  // (reserved for the status-change action below, a real user action) so
  // it renders nothing instead of popping a blocking <dialog> that makes
  // the rest of the page inert for a user who never asked to see this.
  const [isForbidden, setIsForbidden] = useState(false);
  const [savingId, setSavingId] = useState(null);
  const [currentUserId, setCurrentUserId] = useState(null);

  useEffect(() => {
    if (!token) return;
    setIsLoading(true);
    setLoadError(null);

    fetchTechSupportDashboard(token)
      .then((data) => setRequests(data))
      .catch((err) => {
        if (err.status === 403) setIsForbidden(true);
        else setLoadError(err.message);
      })
      .finally(() => setIsLoading(false));
  }, [token]);

  // Scrum-28-Scrum65 (AC3): the thread's "is this my message" edit check
  // needs the signed-in user's id, which this page doesn't otherwise fetch.
  useEffect(() => {
    if (!token) return;
    fetchCurrentUser(token)
      .then((user) => setCurrentUserId(user.id))
      .catch(() => {});
  }, [token]);

  const cards = useMemo(() => {
    const byEvent = new Map();
    for (const r of requests) {
      if (!byEvent.has(r.event_id)) {
        byEvent.set(r.event_id, { eventName: r.event_name, requestedByNames: new Set(), lines: [] });
      }
      const card = byEvent.get(r.event_id);
      if (r.requested_by_name) card.requestedByNames.add(r.requested_by_name);
      card.lines.push(r);
    }
    return [...byEvent.entries()].map(([eventId, card]) => ({
      eventId,
      eventName: card.eventName,
      requestedByNames: [...card.requestedByNames],
      lines: card.lines,
    }));
  }, [requests]);

  function handleStatusChange(requestId, status) {
    setSavingId(requestId);
    updateEquipmentRequestStatus(requestId, status, token)
      .then((updated) => {
        setRequests((prev) => prev.map((r) => (r.id === requestId ? { ...r, status: updated.status } : r)));
      })
      .catch((err) => {
        if (err.status === 403) setForbiddenMessage(err.message);
        else setLoadError(err.message);
      })
      .finally(() => setSavingId(null));
  }

  if (!token) {
    return (
      <div className="eq-page">
        <p className="eq-eyebrow">EQUIPMENT & LOGISTICS</p>
        <h1>Technical support dashboard</h1>
        <div className="eq-card">
          <p>Sign in to review equipment requests.</p>
        </div>
      </div>
    );
  }

  if (isForbidden) return null;

  return (
    <div className="eq-page">
      <p className="eq-eyebrow">EQUIPMENT & LOGISTICS</p>
      <h1>Technical support dashboard</h1>
      <p className="eq-subheading">
        Review what each event requested and record arrangements as they're made.
      </p>

      <div className="eq-card">
        <div className="eq-card-header">
          <h2>Requests by event</h2>
          <span className="eq-badge">{cards.length} events</span>
        </div>

        {loadError && <p className="eq-error">Could not load: {loadError}</p>}
        {isLoading && <p className="eq-hint">Loading requests…</p>}
        {!isLoading && cards.length === 0 && !loadError && (
          <p className="eq-hint">No equipment requests yet.</p>
        )}

        <ul className="eq-event-list">
          {cards.map((card) => (
            <EventEquipmentCard
              key={card.eventId}
              eventId={card.eventId}
              eventName={card.eventName}
              requestedByNames={card.requestedByNames}
              lines={card.lines}
              onStatusChange={handleStatusChange}
              savingId={savingId}
              token={token}
              currentUserId={currentUserId}
            />
          ))}
        </ul>
      </div>

      <ErrorModal
        open={forbiddenMessage !== null}
        title="Access denied"
        message={forbiddenMessage}
        onClose={() => setForbiddenMessage(null)}
      />
    </div>
  );
}

export default TechnicalSupportDashboardPage;
