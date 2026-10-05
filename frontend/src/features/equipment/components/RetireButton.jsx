import { useState } from "react";

// Scrum-30 AC1: retire is a deliberate, confirmed action - same inline
// confirm-toggle shape as registrations' WithdrawButton, the repo's existing
// pattern for a destructive-ish action (no shared Button/modal component
// exists in this repo to build on instead).
function RetireButton({ onRetire, busy }) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <div className="eq-retire-confirm">
        <p>Retire this equipment? It will no longer be bookable, but stays on record.</p>
        <div className="eq-retire-confirm-actions">
          <button type="button" className="eq-secondary" disabled={busy} onClick={() => setConfirming(false)}>
            Cancel
          </button>
          <button type="button" className="eq-primary" disabled={busy} onClick={onRetire}>
            {busy ? "Retiring…" : "Yes, retire"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <button type="button" className="eq-secondary" onClick={() => setConfirming(true)}>
      Retire
    </button>
  );
}

export default RetireButton;
