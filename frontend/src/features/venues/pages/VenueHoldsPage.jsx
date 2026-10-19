// SCRUM-146: Venue Staff place and view tentative holds on a venue.
import { useState, useEffect } from "react";
import { useAuth } from "../../auth/useAuth";
import { fetchHolds, createHold } from "../venueHoldsService";
import { IconAlert, IconArrowLeft } from "../components/VenueIcons";

const SLOTS = ["am", "pm", "night"];
const SLOT_LABELS = { am: "AM (08:00 – 12:00)", pm: "PM (12:00 – 18:00)", night: "Night (18:00 – 23:00)" };

function isExpired(hold) {
  return new Date(hold.expires_at) <= new Date();
}

function HoldRow({ hold }) {
  const expired = isExpired(hold);
  return (
    <div className="v-card" style={{ opacity: expired ? 0.6 : 1 }}>
      <p style={{ fontWeight: 600, marginBottom: 4 }}>
        {hold.event_name}
        {expired && <span className="v-tag" style={{ marginLeft: 8 }}>Expired</span>}
      </p>
      <p style={{ color: "var(--v-text-muted)", fontSize: 14, marginBottom: 2 }}>
        {hold.booking_date} · {SLOTS.filter((s) => s === hold.slot).map((s) => SLOT_LABELS[s]).join(", ") || hold.slot}
      </p>
      <p style={{ color: "var(--v-text-muted)", fontSize: 14 }}>
        Expires {new Date(hold.expires_at).toLocaleString()}
      </p>
    </div>
  );
}

function HoldForm({ venueId, onCreated, onCancel }) {
  const { token } = useAuth();
  const [eventName, setEventName] = useState("");
  const [bookingDate, setBookingDate] = useState("");
  const [slots, setSlots] = useState(() => new Set());
  const [expiresAt, setExpiresAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  function toggleSlot(slot) {
    setSlots((prev) => {
      const next = new Set(prev);
      next.has(slot) ? next.delete(slot) : next.add(slot);
      return next;
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createHold(venueId, {
        event_name: eventName.trim(),
        booking_date: bookingDate,
        slots: SLOTS.filter((s) => slots.has(s)),
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : "",
      }, token);
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const canSubmit = eventName.trim() && bookingDate && slots.size > 0 && expiresAt && !saving;

  return (
    <form className="v-card v-stack" onSubmit={handleSubmit}>
      <div className="v-card-header">
        <h2 className="v-card-title">Place a hold</h2>
        <p className="v-card-desc">
          The held slots will appear as tentative on the calendar and block new booking requests
          until the hold expires.
        </p>
      </div>

      <div className="v-field">
        <label className="v-label" htmlFor="hold-event-name">Event name</label>
        <input
          id="hold-event-name"
          className="v-input"
          type="text"
          value={eventName}
          onChange={(e) => setEventName(e.target.value)}
          required
        />
      </div>

      <div className="v-field">
        <label className="v-label" htmlFor="hold-date">Date</label>
        <input
          id="hold-date"
          className="v-input"
          type="date"
          value={bookingDate}
          onChange={(e) => setBookingDate(e.target.value)}
          required
        />
      </div>

      <div className="v-field">
        <p className="v-label">Slots</p>
        <div className="v-chip-group">
          {SLOTS.map((slot) => (
            <button
              key={slot}
              type="button"
              className={`v-chip v-chip-toggle${slots.has(slot) ? " is-selected" : ""}`}
              onClick={() => toggleSlot(slot)}
            >
              {SLOT_LABELS[slot]}
            </button>
          ))}
        </div>
      </div>

      <div className="v-field">
        <label className="v-label" htmlFor="hold-expires">Hold expires at</label>
        <input
          id="hold-expires"
          className="v-input"
          type="datetime-local"
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
          required
        />
      </div>

      {error && (
        <p className="v-alert v-alert-error" role="alert">
          <IconAlert />
          <span>{error}</span>
        </p>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" className="v-btn v-btn-primary" disabled={!canSubmit}>
          {saving ? "Placing hold…" : "Place hold"}
        </button>
        <button type="button" className="v-btn v-btn-secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function VenueHoldsPage({ venue, onBack }) {
  const { token } = useAuth();
  const [holds, setHolds] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    fetchHolds(venue.id, token)
      .then((data) => { if (active) { setHolds(data.data); setLoadError(null); } })
      .catch((err) => { if (active) setLoadError(err.message); });
    return () => { active = false; };
  }, [venue.id, token, reloadKey]);

  const active = holds ? holds.filter((h) => !isExpired(h)) : [];
  const expired = holds ? holds.filter(isExpired) : [];

  return (
    <div className="v-stack">
      <button type="button" className="v-back" onClick={onBack}>
        <IconArrowLeft />
        Back to venue
      </button>

      <header className="v-page-header">
        <div>
          <h1 className="v-title">Holds — {venue.name}</h1>
          <p className="v-subtitle">
            Tentative holds reserve slots while a coordinator finalises arrangements.
            Expired holds are kept for history.
          </p>
        </div>
        {!showForm && (
          <div className="v-actions">
            <button type="button" className="v-btn v-btn-primary" onClick={() => setShowForm(true)}>
              Place hold
            </button>
          </div>
        )}
      </header>

      {showForm && (
        <HoldForm
          venueId={venue.id}
          onCreated={() => { setShowForm(false); setReloadKey((k) => k + 1); }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {loadError && (
        <p className="v-alert v-alert-error" role="alert">
          <IconAlert />
          <span>{loadError}</span>
        </p>
      )}

      {holds === null && !loadError && <p role="status">Loading holds…</p>}

      {holds !== null && (
        <>
          <section>
            <h2 className="v-section-title">Active holds ({active.length})</h2>
            {active.length === 0
              ? <p className="v-none">No active holds.</p>
              : active.map((h) => <HoldRow key={h.id} hold={h} />)
            }
          </section>

          {expired.length > 0 && (
            <section>
              <h2 className="v-section-title">Expired holds</h2>
              {expired.map((h) => <HoldRow key={h.id} hold={h} />)}
            </section>
          )}
        </>
      )}
    </div>
  );
}
