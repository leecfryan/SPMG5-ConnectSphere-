import { useAuth } from "../../auth/useAuth";
import { useEffect, useMemo, useState } from "react";
import {
  fetchTechSupportDashboard,
  updateEquipmentRequestStatus,
  reserveEquipmentRequestGroup,
} from "../../../lib/api";
import EventEquipmentCard from "../components/EventEquipmentCard";
import ErrorModal from "../../../components/ui/ErrorModal";
import "../equipment.css";

// Scrum-28-Scrum63 (AC1): Technical Support Staff review every event's
// equipment requests from one dashboard. Scrum-28-Scrum64 (AC2): update
// each line's status as arrangements are made. SCRUM-31: reserve a whole
// group at once (AC1/AC2/AC5).
const EMPTY_REQUESTS = [];

function TechnicalSupportDashboardPage() {
  const { token, user } = useAuth();
  const currentUserId = user.id;
  const [result, setResult] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [forbiddenMessage, setForbiddenMessage] = useState(null);
  const [savingId, setSavingId] = useState(null);
  const [reservingGroupId, setReservingGroupId] = useState(null);
  const [reserveError, setReserveError] = useState(null);
  const current = result?.token === token;
  const requests = current ? result.requests : EMPTY_REQUESTS;
  const isLoading = !current;
  const loadError = current ? result.error || actionError : null;
  useEffect(() => {
    let active = true;
    fetchTechSupportDashboard(token)
      .then((requests) => { if (active) setResult({ token, requests }); })
      .catch((error) => { if (active) setResult({ token, requests: [], error: error.message }); });
    return () => { active = false; };
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
        setResult((prev) => ({ ...prev, requests: prev.requests.map((r) => (r.id === requestId ? { ...r, status: updated.status } : r)) }));
      })
      .catch((err) => {
        if (err.status === 403 || err.status === 401) {
          setForbiddenMessage(err.message);
          setResult({ token, requests: [], error: err.message });
        }
        else setActionError(err.message);
      })
      .finally(() => setSavingId(null));
  }

  // SCRUM-31: merges the reserved/unfulfilled rows the server actually wrote
  // back into the dashboard's own list - a 409 (essential group short of
  // stock) changes nothing server-side, so nothing is merged for it either,
  // just the error shown against that one group.
  function handleReserve(groupId) {
    setReservingGroupId(groupId);
    setReserveError(null);
    reserveEquipmentRequestGroup(groupId, token)
      .then(({ reserved, unfulfilled }) => {
        const updatedById = new Map([...reserved, ...unfulfilled].map((row) => [row.id, row]));
        setResult((prev) => ({
          ...prev,
          requests: prev.requests.map((r) => updatedById.get(r.id) ?? r),
        }));
      })
      .catch((err) => {
        if (err.status === 403 || err.status === 401) {
          setForbiddenMessage(err.message);
          setResult({ token, requests: [], error: err.message });
        } else {
          setReserveError({ groupId, message: err.message });
        }
      })
      .finally(() => setReservingGroupId(null));
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
              onReserve={handleReserve}
              reservingGroupId={reservingGroupId}
              reserveError={reserveError}
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
