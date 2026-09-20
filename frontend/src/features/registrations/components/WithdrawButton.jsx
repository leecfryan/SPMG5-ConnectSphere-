import { useState } from "react";

export default function WithdrawButton({ onWithdraw, busy }) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <div className="withdraw-confirm">
        <p>Are you sure you want to withdraw your registration?</p>
        <div className="withdraw-confirm__actions">
          <button className="secondary" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
          <button className="primary" disabled={busy} onClick={onWithdraw}>
            {busy ? "Withdrawing…" : "Yes, withdraw"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <button className="secondary" onClick={() => setConfirming(true)}>
      Withdraw registration
    </button>
  );
}
