import Icon from "../../../components/ui/Icon";
import { displayReason } from "../venueAttention";

// SCRUM-38: what the venue re-check found when the coordinator accepted a
// change request, shown straight after the decision until dismissed. The
// flagged bookings stay listed in VenueAttentionPanel until resolved.
function summary(recheck) {
  if (recheck.failed) {
    return { tone: "warning", title: "Venue bookings could not be re-checked",
      detail: "The change was saved. The venue bookings will be re-checked when you re-approve the event." };
  }
  if (recheck.flagged.length === 0) {
    return { tone: "ok", title: "Venue bookings re-checked",
      detail: recheck.checked === 1 ? "The booking still fits the updated event." : `All ${recheck.checked} bookings still fit the updated event.` };
  }
  const count = recheck.flagged.length;
  return { tone: "warning", title: count === 1 ? "1 venue booking no longer fits the updated event" : `${count} venue bookings no longer fit the updated event`,
    detail: count === 1 ? "Find a replacement or release it below." : "Find a replacement or release each one below." };
}

export default function VenueRecheckNotice({ recheck, onDismiss }) {
  if (!recheck || (!recheck.failed && recheck.checked === 0)) return null;
  const { tone, title, detail } = summary(recheck);
  return <div className={`venue-recheck-notice venue-recheck-notice--${tone}`} role="status">
    <span className="venue-recheck-notice__icon"><Icon name={tone === "ok" ? "check" : "bell"} size={20} /></span>
    <div className="venue-recheck-notice__body">
      <p className="venue-recheck-notice__title">{title}</p>
      <p>{detail}</p>
      {recheck.flagged?.length > 0 && <ul className="venue-recheck-notice__list">
        {recheck.flagged.map(flag => <li key={flag.booking_id}><strong>{flag.venue_name}</strong><span>{displayReason(flag.reason)}</span></li>)}
      </ul>}
    </div>
    <button type="button" className="venue-recheck-notice__dismiss" onClick={onDismiss}>Dismiss</button>
  </div>;
}
