import { useEffect, useState } from "react";
import {
  fetchCoordinatorWaitlist,
  fetchWaitlistAutoOfferSetting,
  promoteWaitlistEntry,
  updateWaitlistAutoOfferSetting,
} from "../managedEventsWaitlistService";

export default function WaitlistCoordinatorPanel({ eventId, token }) {
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [message, setMessage] = useState("");
  const [reload, setReload] = useState(0);
  const [page, setPage] = useState({ scope: "", offset: 0 });
  const scope = JSON.stringify([eventId, token]);
  const offset = page.scope === scope ? page.offset : 0;
  const key = JSON.stringify([scope, offset, reload]);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetchCoordinatorWaitlist(eventId, token, { limit: 50, offset }),
      fetchWaitlistAutoOfferSetting(eventId, token),
    ]).then(([queue, setting]) => {
      if (!active) return;
      setResult({ key, queue, setting });
    }).catch((failure) => {
      if (active) setResult({ key, error: failure.message });
    });
    return () => { active = false; };
  }, [eventId, token, offset, reload, key]);

  const current = result?.key === key ? result : null;
  const loading = !current;
  const waitlist = current?.queue;
  const enabled = current?.setting?.enabled ?? true;
  const error = actionError || current?.error;

  async function updateSetting(event) {
    const nextEnabled = event.target.checked;
    const prompt = nextEnabled
      ? "Turn automatic waitlist offers on?"
      : "Turn automatic offers off? Existing offers remain active until they expire.";
    if (!globalThis.confirm(prompt)) return;

    setBusy(true);
    setActionError("");
    setMessage("");
    try {
      const setting = await updateWaitlistAutoOfferSetting(eventId, nextEnabled, token);
      setMessage(`Automatic offers turned ${setting.enabled ? "on" : "off"}.`);
      setReload((value) => value + 1);
    } catch (failure) {
      setActionError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  async function promote(entry) {
    setBusy(true);
    setActionError("");
    setMessage("");
    try {
      const result = await promoteWaitlistEntry(eventId, entry.id, token);
      setMessage(result.outcome === "offered"
        ? `${entry.displayName} was offered a place.`
        : result.outcome === "already_promoted"
          ? `${entry.displayName} has already been promoted.`
          : `${entry.displayName} was registered over expected attendance.`);
      setReload((value) => value + 1);
    } catch (failure) {
      setActionError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="waitlist-coordinator-panel"
      aria-labelledby="coordinator-waitlist-title"
      aria-busy={loading || busy}
    >
      <div className="waitlist-coordinator-panel__header">
        <div>
          <p className="eyebrow">ATTENDEE QUEUE</p>
          <h2 id="coordinator-waitlist-title">Waitlist management</h2>
          <p>Review the queue and decide whether available places are offered automatically.</p>
        </div>
        <label className="waitlist-auto-setting">
          <input
            type="checkbox"
            aria-label="Automatically offer available places"
            checked={enabled}
            disabled={loading || busy}
            onChange={updateSetting}
          />
          <span>
            <strong>Automatic offers</strong>
            <small>{enabled ? "On · follows queue order" : "Off · paused by coordinator"}</small>
          </span>
        </label>
      </div>
      {!enabled && (
        <p className="waitlist-coordinator-panel__paused">
          Automatic offers are paused. Existing offers remain active until they expire.
        </p>
      )}
      {error && <p className="field-error" role="alert">{error}</p>}
      {message && <p className="assign-confirmation" role="status">{message}</p>}
      {loading && <p role="status">Loading waitlist…</p>}
      {!loading && !error && waitlist && (
        <>
          <div className="waitlist-coordinator-stats" aria-label="Waitlist summary">
            <div className="waitlist-coordinator-stat">
              <strong>{waitlist.total}</strong>
              <span>Active</span>
            </div>
            <div className="waitlist-coordinator-stat">
              <strong>{waitlist.queued}</strong>
              <span>Queued</span>
            </div>
            <div className="waitlist-coordinator-stat waitlist-coordinator-stat--offered">
              <strong>{waitlist.offered}</strong>
              <span>Offered</span>
            </div>
          </div>
          {waitlist.entries.length === 0
            ? (
              <p className="waitlist-coordinator-panel__empty">
                No attendees are on the waitlist yet. When a place opens, offered attendees will appear here.
              </p>
            )
            : (
              <ol className="waitlist-coordinator-list">
                {waitlist.entries.map((entry) => (
                  <li key={entry.id}>
                    <div className="waitlist-coordinator-entry">
                      <span className="waitlist-coordinator-entry__rank" aria-hidden="true">
                        {entry.position}
                      </span>
                      <div className="waitlist-coordinator-entry__person">
                        <strong>{entry.displayName}</strong>
                        <div className="waitlist-coordinator-entry__meta">
                          <span className={`waitlist-coordinator-chip waitlist-coordinator-chip--${entry.state === "offered" ? "offered" : "queued"}`}>
                            {entry.state === "offered" ? "Place offered" : "Queued"}
                          </span>
                          {entry.state === "offered" && entry.effectiveDeadline && (
                            <span className="waitlist-coordinator-entry__deadline">
                              Offered until {formatDeadline(entry.effectiveDeadline)}
                            </span>
                          )}
                          {entry.override && (
                            <span className="waitlist-coordinator-chip waitlist-coordinator-chip--override">
                              Coordinator override
                            </span>
                          )}
                        </div>
                      </div>
                      {entry.eligible && entry.state === "queued" && (
                        <button
                          className="waitlist-coordinator-entry__promote"
                          type="button"
                          disabled={busy}
                          aria-label={`Promote ${entry.displayName}`}
                          onClick={() => promote(entry)}
                        >
                          Promote
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          {waitlist.total > waitlist.limit && (
            <nav className="waitlist-coordinator-pagination" aria-label="Waitlist pages">
              <span>
                Showing {waitlist.offset + 1}–{Math.min(waitlist.offset + waitlist.limit, waitlist.total)} of {waitlist.total}
              </span>
              <div className="waitlist-coordinator-pagination__actions">
                <button
                  type="button"
                  disabled={busy || waitlist.offset === 0}
                  onClick={() => setPage({ scope, offset: Math.max(0, waitlist.offset - waitlist.limit) })}
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={busy || waitlist.offset + waitlist.entries.length >= waitlist.total}
                  onClick={() => setPage({ scope, offset: waitlist.offset + waitlist.limit })}
                >
                  Next
                </button>
              </div>
            </nav>
          )}
        </>
      )}
    </section>
  );
}

function formatDeadline(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
