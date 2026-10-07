import { useEffect, useState } from "react";
import { useAuth } from "../../auth/useAuth";
import {
  fetchUnavailabilityPeriods,
  createUnavailabilityPeriod,
  updateUnavailabilityPeriod,
  deleteUnavailabilityPeriod,
} from "../venueUnavailabilityService";
import VenueUnavailabilityForm from "../components/VenueUnavailabilityForm";
import { IconAlert, IconArrowLeft } from "../components/VenueIcons";

const SLOT_LABELS = { am: "AM", pm: "PM", night: "Night" };

function PeriodRow({ period, onEdit, onDelete }) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

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
    <div className="v-card" style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
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
      setMode("list");
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
            safety checks. Existing confirmed bookings are not affected.
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
