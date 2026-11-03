import { useCallback, useContext, useEffect, useState } from "react";
import { AuthContext } from "../../auth/useAuth";
import {
  getWaitlistPosition,
  joinWaitlist,
  withdrawFromWaitlist,
} from "../waitlistService";
import WaitlistOffer, { RegistrationDetailsForm } from "./WaitlistOffer";

function errorMessage(error) {
  if (error.code === "details_required") {
    return "Complete the required registration details before accepting this offer.";
  }
  if (error.status === 404) return "The event or your waitlist entry could not be found.";
  if (error.status === 503) return "The waitlist is temporarily unavailable. Please try again.";
  if (error.status === 409) {
    return error.message || "This event is no longer eligible for the waitlist.";
  }
  return error.message || "Unable to process your waitlist request. Please try again.";
}

export default function WaitlistPanel({ eventId, fields = [], isFull = true, onEntryChange }) {
  const auth = useContext(AuthContext);
  const token = auth?.token;
  const [entry, setEntry] = useState(null);
  const [position, setPosition] = useState(null);
  const [effectiveDeadline, setEffectiveDeadline] = useState(null);
  const [serverTime, setServerTime] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  const applyState = useCallback((result) => {
    setEntry(result.entry);
    onEntryChange?.(result.entry ?? null);
    setPosition(result.position);
    setEffectiveDeadline(result.effective_deadline ?? null);
    setServerTime(result.server_time ?? null);
  }, [onEntryChange]);

  const loadPosition = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    setError("");
    try {
      applyState(await getWaitlistPosition(eventId, token));
    } catch (failure) {
      if (failure.status === 404) {
        setEntry(null);
        onEntryChange?.(null);
        setPosition(null);
        setEffectiveDeadline(null);
        setServerTime(null);
      } else {
        setLoadError(true);
        setError(errorMessage(failure));
      }
    } finally {
      setLoading(false);
    }
  }, [applyState, eventId, onEntryChange, token]);

  useEffect(() => {
    if (!token) return undefined;
    let active = true;
    getWaitlistPosition(eventId, token)
      .then((result) => {
        if (active) applyState(result);
      })
      .catch((failure) => {
        if (!active) return;
        if (failure.status === 404) {
          onEntryChange?.(null);
          setEffectiveDeadline(null);
          setServerTime(null);
          return;
        }
        setLoadError(true);
        setError(errorMessage(failure));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [applyState, eventId, onEntryChange, token]);

  async function handleJoin(registrationData = {}) {
    setBusy(true);
    setError("");
    try {
      const result = await joinWaitlist(eventId, token, registrationData);
      setEntry(result.entry);
      onEntryChange?.(result.entry ?? null);
      setPosition(result.position);
      setEffectiveDeadline(null);
      setServerTime(result.server_time ?? null);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function handleWithdraw() {
    setBusy(true);
    setError("");
    try {
      await withdrawFromWaitlist(eventId, token);
      setEntry(null);
      onEntryChange?.(null);
      setPosition(null);
      setEffectiveDeadline(null);
      setServerTime(null);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    if (!isFull) return null;
    return (
      <section aria-labelledby={`waitlist-title-${eventId}`}>
        <h2 id={`waitlist-title-${eventId}`}>Event waitlist</h2>
        <p role="status">Sign in to join this waitlist.</p>
      </section>
    );
  }
  if (!isFull && !entry && !loadError) return null;

  return (
    <section aria-labelledby={`waitlist-title-${eventId}`}>
      <h2 id={`waitlist-title-${eventId}`}>Event waitlist</h2>
      {loading ? (
        <p role="status">Checking your waitlist position…</p>
      ) : loadError ? (
        <>
          <p className="error" role="alert">{error}</p>
          <button className="secondary" type="button" onClick={loadPosition}>Try again</button>
        </>
      ) : confirmed ? (
        <p role="status">Registration confirmed.</p>
      ) : (
        <>
          {error && <p className="error" role="alert">{error}</p>}
          {entry ? (
            <>
              <p role="status">Your waitlist position: {position}.</p>
              {entry.offer_state === "offered" ? (
                <>
                  <WaitlistOffer
                    offer={{
                      event_id: eventId,
                      event: { name: "This event", registration_fields: fields },
                      registration_data: entry.registration_data,
                      effective_deadline: effectiveDeadline,
                      server_time: serverTime,
                    }}
                    onAccepted={() => setConfirmed(true)}
                    onRemoved={loadPosition}
                  />
                </>
              ) : (
                <button className="secondary" type="button" disabled={busy} onClick={handleWithdraw}>
                  {busy ? "Leaving…" : "Leave waitlist"}
                </button>
              )}
            </>
          ) : isFull && fields.length ? (
            <>
              <p>This event is full. Add your registration details to join the waitlist.</p>
              <RegistrationDetailsForm
                key={`join-${eventId}`}
                fields={fields}
                busy={busy}
                submitLabel="Join waitlist"
                onSubmit={handleJoin}
              />
            </>
          ) : isFull ? (
            <>
              <p>This event is full. Join the waitlist to see your position.</p>
              <button className="btn btn-primary" type="button" disabled={busy} onClick={() => handleJoin()}>
                {busy ? "Joining…" : "Join waitlist"}
              </button>
            </>
          ) : null}
        </>
      )}
    </section>
  );
}
