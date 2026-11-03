import { useContext, useEffect, useRef, useState } from "react";
import { AuthContext } from "../../auth/useAuth";
import {
  acceptWaitlistOffer,
  declineWaitlistOffer,
  updateWaitlistDetails,
} from "../waitlistService";

export function RegistrationDetailsForm({
  fields,
  initialData,
  busy,
  submitLabel,
  onSubmit,
  idPrefix = "waitlist-reg",
}) {
  const [values, setValues] = useState(() =>
    Object.fromEntries(fields.map((field) => [field.id, initialData?.[field.id] ?? ""]))
  );

  function handleSubmit(event) {
    event.preventDefault();
    if (busy) return;
    onSubmit(Object.fromEntries(
      fields.map((field) => [field.id, values[field.id]?.trim() || null])
    ));
  }

  return (
    <form onSubmit={handleSubmit} aria-busy={busy}>
      {fields.map((field) => (
        <div key={field.id}>
          <label htmlFor={`${idPrefix}-${field.id}`}>{field.label}</label>
          <input
            id={`${idPrefix}-${field.id}`}
            type={field.type ?? "text"}
            required={field.required}
            maxLength={500}
            disabled={busy}
            value={values[field.id] ?? ""}
            onChange={(event) => setValues((previous) => ({
              ...previous,
              [field.id]: event.target.value,
            }))}
          />
        </div>
      ))}
      <button className="btn btn-primary" type="submit" disabled={busy}>
        {busy ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}

function needsRequiredDetails(fields, registrationData) {
  return fields.some((field) => field.required &&
    (typeof registrationData?.[field.id] !== "string" || !registrationData[field.id].trim()));
}

function formatCountdown(milliseconds) {
  const totalMinutes = Math.max(0, Math.ceil(milliseconds / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  return `${days} days, ${hours} hours, ${minutes} minutes`;
}

function offerErrorMessage(error) {
  if (error.code === "details_required") {
    return "Complete the required registration details before accepting this offer.";
  }
  if (error.code === "capacity_unavailable") {
    return "This event no longer has an available place for this offer.";
  }
  if (error.code === "expired") return "This waitlist offer has expired.";
  return error.message || "Unable to process your waitlist offer. Please try again.";
}

export default function WaitlistOffer({ offer, onAccepted, onRemoved }) {
  const auth = useContext(AuthContext);
  const token = auth?.token;
  const fields = offer.event?.registration_fields ?? [];
  const [registrationData, setRegistrationData] = useState(offer.registration_data ?? {});
  const [deadline, setDeadline] = useState(offer.effective_deadline);
  const [serverTime, setServerTime] = useState(offer.server_time);
  const [serverTimeReceivedAt, setServerTimeReceivedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [detailsRequired, setDetailsRequired] = useState(false);
  const [error, setError] = useState("");
  const expiryRefreshStarted = useRef(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const serverNow = serverTime
    ? Date.parse(serverTime) + now - serverTimeReceivedAt
    : now;
  const deadlineTime = Date.parse(deadline);
  const countdownMilliseconds = deadlineTime - serverNow;
  const missingDetails = needsRequiredDetails(fields, registrationData);
  const expired = countdownMilliseconds <= 0;

  useEffect(() => {
    if (countdownMilliseconds > 0 || expiryRefreshStarted.current) return;
    expiryRefreshStarted.current = true;
    onRemoved?.();
  }, [countdownMilliseconds, onRemoved]);

  async function handleAccept() {
    setBusy(true);
    setError("");
    try {
      await acceptWaitlistOffer(offer.event_id, token);
      await onAccepted?.();
    } catch (failure) {
      setError(offerErrorMessage(failure));
      if (failure.code === "details_required") setDetailsRequired(true);
      if (failure.code === "expired") {
        await onRemoved?.();
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleDecline() {
    setBusy(true);
    setError("");
    try {
      await declineWaitlistOffer(offer.event_id, token);
      await onRemoved?.();
    } catch (failure) {
      setError(offerErrorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function handleDetailsUpdate(updatedData) {
    setBusy(true);
    setError("");
    try {
      const result = await updateWaitlistDetails(offer.event_id, token, updatedData);
      setRegistrationData(result.entry.registration_data ?? updatedData);
      setDeadline(result.effective_deadline ?? deadline);
      setServerTime(result.server_time ?? serverTime);
      if (result.server_time) setServerTimeReceivedAt(Date.now());
      setDetailsRequired(false);
    } catch (failure) {
      setError(offerErrorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="registration-offer">
      <div className="registration-card__body">
        <span className="registration-card__event">{offer.event?.name ?? "Event"}</span>
        <span className="registration-status registration-status--offer">Place Offered</span>
        <p
          className="waitlist-offer-countdown"
          aria-live="polite"
          aria-atomic="true"
          data-testid="waitlist-offer-countdown"
        >
          {expired
            ? "Offer expired."
            : `Offer expires in ${formatCountdown(countdownMilliseconds)}.`}
        </p>
        {error && <p className="error" role="alert">{error}</p>}
        {expired ? (
          <p role="status">This offer has expired.</p>
        ) : detailsRequired || missingDetails ? (
          <RegistrationDetailsForm
            fields={fields}
            initialData={registrationData}
            busy={busy}
            submitLabel="Save details"
            idPrefix={`waitlist-offer-${offer.id}`}
            onSubmit={handleDetailsUpdate}
          />
        ) : (
          <div className="registration-offer__actions">
            <button className="btn btn-primary" type="button" disabled={busy} onClick={handleAccept}>
              {busy ? "Accepting…" : "Accept offer"}
            </button>
            <button className="secondary" type="button" disabled={busy} onClick={handleDecline}>
              {busy ? "Please wait…" : "Decline offer"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
