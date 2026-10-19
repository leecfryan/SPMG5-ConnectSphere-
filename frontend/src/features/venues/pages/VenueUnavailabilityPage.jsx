import { useEffect, useState } from "react";
import { useAuth } from "../../auth/useAuth";
import {
  fetchUnavailabilityPeriods,
  fetchAffectedBookings,
  createUnavailabilityPeriod,
  updateUnavailabilityPeriod,
  deleteUnavailabilityPeriod,
} from "../venueUnavailabilityService";
import VenueUnavailabilityForm from "../components/VenueUnavailabilityForm";
import { IconAlert, IconArrowLeft } from "../components/VenueIcons";

const SLOT_LABELS = { am: "AM", pm: "PM", night: "Night" };
const SLOT_ORDER = ["am", "pm", "night"];

function PeriodRow({ venueId, token, period, onEdit, onDelete }) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  // SCRUM-136: keep the affected list accessible after the creation panel is
  // dismissed or the page reloads — re-fetch on demand per period.
  const [affected, setAffected] = useState(null);

  useEffect(() => {
    let active = true;
    fetchAffectedBookings(venueId, period.id, token)
      .then((res) => { if (active) setAffected(res.data); })
      .catch(() => { if (active) setAffected([]); });
    return () => { active = false; };
  }, [venueId, period.id, token]);

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await onDelete(period);
    } catch (err) {
      setDeleteError(err.message);
      setDeleting(false);
      setConfirming(false);
    }
  }

  return (
    <div className="v-card">
      <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontWeight: 600, marginBottom: 4 }}>{period.reason}</p>
          <p style={{ color: "var(--v-text-muted)", fontSize: 14, marginBottom: 4 }}>
            {period.start_date === period.end_date
              ? period.start_date
              : `${period.start_date} to ${period.end_date}`}
            {" · "}
            {period.slots.map((s) => SLOT_LABELS[s]).join(", ")}
          </p>
          {deleteError && (
            <p className="v-alert v-alert-error" role="alert" style={{ marginTop: 8 }}>
              <IconAlert />
              <span>{deleteError}</span>
            </p>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          {confirming ? (
            <>
              <button
                type="button"
                className="v-btn v-btn-secondary"
                onClick={() => setConfirming(false)}
                disabled={deleting}
              >
                Keep
              </button>
              <button
                type="button"
                className="v-btn v-btn-primary"
                style={{ background: "var(--v-danger)", borderColor: "var(--v-danger)" }}
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? "Deleting…" : "Confirm delete"}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="v-btn v-btn-secondary" onClick={() => onEdit(period)}>
                Edit
              </button>
              <button
                type="button"
                className="v-btn v-btn-secondary"
                onClick={() => setConfirming(true)}
              >
                Delete
              </button>
            </>
          )}
        </div>
      </div>
      {affected && affected.length > 0 && (
        <div style={{ marginTop: 12, borderTop: "1px solid var(--v-border)", paddingTop: 12 }}>
          <p style={{ fontSize: 13, color: "var(--v-text-muted)", marginBottom: 8 }}>
            {affected.length} confirmed booking{affected.length !== 1 ? "s" : ""} overlap this period — contact the assigned coordinator to arrange alternatives.
          </p>
          {affected.map((r) => {
            const slotLabel = SLOT_ORDER
              .filter((s) => r.slots.some((sl) => sl.slot === s && sl.status === "confirmed"))
              .map((s) => SLOT_LABELS[s]).join(", ");
            return (
              <div key={r.id} style={{ paddingTop: 8, borderTop: "1px solid var(--v-border)" }}>
                <p style={{ fontWeight: 600, marginBottom: 4 }}>{r.event.name}</p>
                <p style={{ color: "var(--v-text-muted)", fontSize: 14 }}>{r.booking_date} · {slotLabel}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// SCRUM-136: one row per affected confirmed booking shown after a period is created.
function AffectedBookingRow({ request }) {
  const confirmedSlots = request.slots
    .filter((s) => s.status === "confirmed")
    .map((s) => s.slot);
  const slotLabel = SLOT_ORDER.filter((s) => confirmedSlots.includes(s))
    .map((s) => SLOT_LABELS[s])
    .join(", ");

  return (
    <div className="v-card">
      <p style={{ fontWeight: 600, marginBottom: 4 }}>{request.event.name}</p>
      <p style={{ color: "var(--v-text-muted)", fontSize: 14 }}>
        {request.booking_date} · {slotLabel}
      </p>
    </div>
  );
}

// SCRUM-133: Venue Staff manage unavailability periods for a single venue.
// Receives the already-loaded venue from VenueRecordPage; fetches periods itself.
function VenueUnavailabilityPage({ venue, onBack }) {
  const { token } = useAuth();
  const [periods, setPeriods] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [mode, setMode] = useState("list"); // "list" | "create" | { edit: period }
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  useEffect(() => {
    let active = true;
    fetchUnavailabilityPeriods(venue.id, token)
      .then((res) => { if (active) setPeriods(res.data); })
      .catch((err) => { if (active) setLoadError(err.message); });
    return () => { active = false; };
  }, [venue.id, token]);

  async function handleCreate(data) {
    setIsSaving(true);
    setSaveError(null);
    try {
      const res = await createUnavailabilityPeriod(venue.id, data, token);
      setPeriods((prev) => [...(prev ?? []), res.data]);
      // SCRUM-136: if confirmed bookings overlap the new period, show them before
      // returning to the list so staff can arrange alternatives.
      if (res.affected?.length > 0) {
        setMode({ created: { period: res.data, affected: res.affected } });
      } else {
        setMode("list");
      }
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleUpdate(period, changes) {
    setIsSaving(true);
    setSaveError(null);
    try {
      const res = await updateUnavailabilityPeriod(venue.id, period.id, changes, token);
      setPeriods((prev) => (prev ?? []).map((p) => (p.id === period.id ? res.data : p)));
      setMode("list");
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(period) {
    await deleteUnavailabilityPeriod(venue.id, period.id, token);
    setPeriods((prev) => (prev ?? []).filter((p) => p.id !== period.id));
  }

  return (
    <div className="v-page-narrow">
      <button type="button" className="v-back" onClick={onBack}>
        <IconArrowLeft />
        Back to venue
      </button>

      <header className="v-page-header">
        <div>
          <p className="v-eyebrow">{venue.name}</p>
          <h1 className="v-title">Manage unavailability</h1>
          <p className="v-subtitle">
            Mark periods when the venue cannot accept new bookings — maintenance, renovation, or
            safety checks. Confirmed bookings that overlap a new period are listed so you can
            arrange alternatives.
          </p>
        </div>
        {mode === "list" && (
          <div className="v-actions">
            <button
              type="button"
              className="v-btn v-btn-primary"
              onClick={() => { setSaveError(null); setMode("create"); }}
            >
              Add period
            </button>
          </div>
        )}
      </header>

      {mode === "create" && (
        <VenueUnavailabilityForm
          onSubmit={handleCreate}
          onCancel={() => { setSaveError(null); setMode("list"); }}
          isSaving={isSaving}
          saveError={saveError}
        />
      )}

      {typeof mode === "object" && mode.created && (
        <div className="v-stack">
          <div className="v-card">
            <p style={{ fontWeight: 600, marginBottom: 4 }}>
              Period added — {mode.created.period.reason}
            </p>
            <p style={{ color: "var(--v-text-muted)", fontSize: 14, marginBottom: 8 }}>
              {mode.created.affected.length} confirmed booking
              {mode.created.affected.length !== 1 ? "s" : ""} overlap this period.
            </p>
            <p style={{ color: "var(--v-text-muted)", fontSize: 14 }}>
              Contact the assigned coordinator for each event to arrange alternatives.
              The bookings below have not been changed.
            </p>
          </div>
          {mode.created.affected.map((r) => (
            <AffectedBookingRow key={r.id} request={r} />
          ))}
          <div className="v-card v-action-bar">
            <div className="v-form-actions">
              <button
                type="button"
                className="v-btn v-btn-primary"
                onClick={() => setMode("list")}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {mode !== "create" && typeof mode === "object" && mode.edit && (
        <VenueUnavailabilityForm
          initialData={mode.edit}
          onSubmit={(changes) => handleUpdate(mode.edit, changes)}
          onCancel={() => { setSaveError(null); setMode("list"); }}
          isSaving={isSaving}
          saveError={saveError}
        />
      )}

      {mode === "list" && (
        <>
          {loadError && (
            <p className="v-alert v-alert-error" role="alert">
              <IconAlert />
              <span>Could not load periods: {loadError}</span>
            </p>
          )}

          {!loadError && periods === null && (
            <p role="status">Loading periods…</p>
          )}

          {!loadError && periods !== null && periods.length === 0 && (
            <div className="v-card v-empty">
              <p className="v-empty-title">No unavailability periods recorded.</p>
              <p>Add a period to block new bookings during maintenance or other closures.</p>
            </div>
          )}

          {!loadError && periods !== null && periods.length > 0 && (
            <div className="v-stack">
              {periods.map((p) => (
                <PeriodRow
                  key={p.id}
                  venueId={venue.id}
                  token={token}
                  period={p}
                  onEdit={(period) => { setSaveError(null); setMode({ edit: period }); }}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default VenueUnavailabilityPage;
