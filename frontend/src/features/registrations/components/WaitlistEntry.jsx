import { useContext, useState } from "react";
import { AuthContext } from "../../auth/useAuth";
import { withdrawFromWaitlist } from "../waitlistService";

export default function WaitlistEntry({ entry, onWithdrawn }) {
  const auth = useContext(AuthContext);
  const token = auth?.token;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleWithdraw() {
    setBusy(true);
    setError("");
    try {
      await withdrawFromWaitlist(entry.event_id, token);
      await onWithdrawn?.();
    } catch (failure) {
      setError(failure.message || "Unable to withdraw from the waitlist. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="registration-waitlist">
      <div className="registration-card__body">
        <span className="registration-card__event">{entry.event?.name ?? "Event"}</span>
        <span className="registration-status registration-status--waitlist">Waitlist</span>
        <p role="status">Your waitlist position: {entry.position}.</p>
        {error && <p className="error" role="alert">{error}</p>}
        <button
          className="secondary"
          type="button"
          disabled={busy}
          onClick={handleWithdraw}
        >
          {busy ? "Withdrawing…" : "Withdraw"}
        </button>
      </div>
    </div>
  );
}
