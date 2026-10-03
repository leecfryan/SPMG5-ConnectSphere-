import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { useAuth } from "../../auth/useAuth";
import { fetchEventRegistrationSummary, fetchManagedRegistrationWindow } from "../managedEventsService";
import RegistrationWindowEditor from "../components/RegistrationWindowEditor";
import "../../events/events.css";

// The server answers 403 for an event that belongs to someone else and for one
// that does not exist, so the browser cannot tell the two apart and does not
// need to. They share a message for that reason, not just to save a branch.
const NOT_ACCESSIBLE = "You don't have access to registration information for that event.";

export default function ManagedEventDetailPage() {
  const { eventId } = useParams();
  const { token, hasPermission } = useAuth();
  const [result, setResult] = useState(null);
  // Keyed by path and token: a session change must never leave one account's
  // counts on screen while the next request is in flight.
  const key = JSON.stringify([eventId, token]);

  useEffect(() => {
    let active = true;
    fetchEventRegistrationSummary(eventId, token)
      .then(async (summary) => {
        let window;
        let windowError;
        try {
          window = await fetchManagedRegistrationWindow(eventId, token);
        } catch (error) {
          windowError = error;
        }
        if (active) setResult({
          key,
          summary: { ...summary, ...window },
          windowError,
        });
      })
      .catch((error) => { if (active) setResult({ key, error }); });
    return () => { active = false; };
  }, [eventId, token, key]);

  const back = <Link to="/events/managed">Back to my events</Link>;

  if (result?.key !== key) return <p role="status">Loading registration information…</p>;
  if (result.error) {
    return (
      <section className="card">
        <p className="error" role="alert">
          {result.error.status === 403 || result.error.status === 404 ? NOT_ACCESSIBLE : result.error.message}
        </p>
        {back}
      </section>
    );
  }

  const summary = result.summary;
  const isFull = Number.isInteger(summary.maxEnrollment) && summary.enrolled >= summary.maxEnrollment;
  return (
    <section className="card" aria-labelledby="managed-event-title">
      <Link to="/events/managed" className="back-link">Back to my events</Link>
      <p className="eyebrow">EVENT</p>
      <h1 id="managed-event-title">{summary.name}</h1>
      <dl className="account-details">
        <div>
          <dt>Current Registrations</dt>
          <dd>
            {summary.enrolled}/{summary.maxEnrollment ?? "-"}
            {isFull && <span className="status-badge status-full"> Full</span>}
          </dd>
        </div>
        <div>
          <dt>Waiting List</dt>
          <dd>{summary.waitingList}</dd>
        </div>
      </dl>
      <p className="card-note">
        {summary.status}{summary.start_time ? ` · ${formatDate(summary.start_time)}` : ""}
      </p>
      {result.windowError && (
        <p className="error" role="alert">
          Registration window settings could not be loaded. Refresh the page before editing them.
        </p>
      )}
      {!result.windowError && typeof hasPermission === "function" && hasPermission("events.registration-window.update") && (
        <RegistrationWindowEditor
          event={summary}
          token={token}
          onSaved={(saved) => {
            setResult((current) => current?.key === key
              ? { ...current, summary: { ...current.summary, ...saved } }
              : current);
          }}
        />
      )}
    </section>
  );
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
