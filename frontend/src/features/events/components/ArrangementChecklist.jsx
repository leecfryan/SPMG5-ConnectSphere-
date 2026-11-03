import { useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { setArrangementEssential } from "../safetyService";

// SCRUM-139/144: what is still outstanding for the event. Essential items block
// the safety check and confirmation; the coordinator can mark an outstanding
// request non-essential (agreed with Technical Support, #106) so it no longer
// does, or essential again. The server re-checks the assignment and status.
// "No venue booking has been approved yet" has no request behind it (no id),
// so it can't be marked.
function Item({ item, action, onToggle, busy }) {
  return <li>
    {item.label}: {item.reason}
    {item.id && <> <button type="button" disabled={busy}
      aria-label={`Mark ${item.label} as ${action}`} onClick={() => onToggle(item)}>
      Mark as {action}
    </button></>}
  </li>;
}

export default function ArrangementChecklist({ eventId, missing, optional = [], onChanged }) {
  const { token } = useAuth();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function toggle(item, isEssential) {
    setBusy(true);
    setError("");
    try { await setArrangementEssential(eventId, item.kind, item.id, isEssential, token); onChanged(); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  return <>
    {error && <p role="alert">{error}</p>}
    {missing.length > 0 && <ul aria-label="Missing arrangements">
      {missing.map((item, index) => <Item key={item.id ?? index} item={item} action="non-essential" busy={busy}
        onToggle={(chosen) => toggle(chosen, false)} />)}
    </ul>}
    {optional.length > 0 && <>
      <p>Outstanding but marked non-essential, so they do not block:</p>
      <ul aria-label="Non-essential arrangements">
        {optional.map((item) => <Item key={item.id} item={item} action="essential" busy={busy}
          onToggle={(chosen) => toggle(chosen, true)} />)}
      </ul>
    </>}
  </>;
}
