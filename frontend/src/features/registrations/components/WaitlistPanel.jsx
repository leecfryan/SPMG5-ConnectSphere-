import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../auth/useAuth";
import {
  getWaitlistPosition,
  joinWaitlist,
  withdrawFromWaitlist,
} from "../waitlistService";

function errorMessage(error) {
  if (error.status === 404) return "The event or your waitlist entry could not be found.";
  if (error.status === 503) return "The waitlist is temporarily unavailable. Please try again.";
  if (error.status === 409) {
    return error.message || "This event is no longer eligible for the waitlist.";
  }
  return error.message || "Unable to process your waitlist request. Please try again.";
}

export default function WaitlistPanel({ eventId }) {
  const { token } = useAuth();
  const [entry, setEntry] = useState(null);
  const [position, setPosition] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadPosition = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    setError("");
    try {
      const result = await getWaitlistPosition(eventId, token);
      setEntry(result.entry);
      setPosition(result.position);
    } catch (failure) {
      if (failure.status === 404) {
        setEntry(null);
        setPosition(null);
      } else {
        setLoadError(true);
        setError(errorMessage(failure));
      }
    } finally {
      setLoading(false);
    }
  }, [eventId, token]);

  useEffect(() => {
    let active = true;
    getWaitlistPosition(eventId, token)
      .then((result) => {
        if (!active) return;
        setEntry(result.entry);
        setPosition(result.position);
      })
      .catch((failure) => {
        if (!active || failure.status === 404) return;
        setLoadError(true);
        setError(errorMessage(failure));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [eventId, token]);

  async function handleJoin() {
    setBusy(true);
    setError("");
    try {
      const result = await joinWaitlist(eventId, token);
      setEntry(result.entry);
      setPosition(result.position);
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
      setPosition(null);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

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
      ) : (
        <>
          {error && <p className="error" role="alert">{error}</p>}
          {entry ? (
            <>
              <p role="status">Your waitlist position: {position}.</p>
              <button className="secondary" type="button" disabled={busy} onClick={handleWithdraw}>
                {busy ? "Leaving…" : "Leave waitlist"}
              </button>
            </>
          ) : (
            <>
              <p>This event is full. Join the waitlist to see your position.</p>
              <button className="btn btn-primary" type="button" disabled={busy} onClick={handleJoin}>
                {busy ? "Joining…" : "Join waitlist"}
              </button>
            </>
          )}
        </>
      )}
    </section>
  );
}
