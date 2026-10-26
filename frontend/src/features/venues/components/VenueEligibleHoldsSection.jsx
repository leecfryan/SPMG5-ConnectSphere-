// SCRUM-162: shows active holds that can be converted to a booking request.
// Only rendered for coordinators (bookings.request permission). Silently
// disappears when there are no eligible holds so it never confuses venue staff.
import { useState, useEffect } from "react";
import { useAuth } from "../../auth/useAuth";
import { fetchEligibleHolds } from "../venueHoldsService";
import { formatDate } from "../venueFormat";
import { IconClock } from "./VenueIcons";

const SLOT_LABELS = { am: "AM", pm: "PM", night: "Night" };

export default function VenueEligibleHoldsSection({ venueId, onConvert }) {
  const { token } = useAuth();
  const [groups, setGroups] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    fetchEligibleHolds(venueId, token)
      .then((data) => { if (active) setGroups(data.data); })
      .catch((err) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [venueId, token]);

  // Loading and error states are silent — this is supplementary, not critical.
  if (error || groups === null || groups.length === 0) return null;

  return (
    <section className="v-card">
      <div className="v-card-header">
        <h2 className="v-card-title">Holds ready to convert</h2>
        <p className="v-card-desc">
          These tentative holds match your events. Convert to a booking request before they expire.
        </p>
      </div>
      <div className="v-stack" style={{ gap: 12 }}>
        {groups.map((group) => {
          const slotLabels = group.slots.map((s) => SLOT_LABELS[s.slot]).join(", ");
          const earliestExpiry = group.slots.reduce(
            (min, s) => (s.expires_at < min ? s.expires_at : min),
            group.slots[0].expires_at
          );
          return (
            <div
              key={`${group.event.id}-${group.booking_date}`}
              style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}
            >
              <div>
                <p style={{ fontWeight: 600, marginBottom: 2 }}>{group.event.name}</p>
                <p style={{ color: "var(--v-text-muted)", fontSize: 14, marginBottom: 2 }}>
                  {formatDate(group.booking_date, { weekday: true, year: true })} · {slotLabels}
                </p>
                <p style={{ color: "var(--v-text-muted)", fontSize: 13, display: "flex", alignItems: "center", gap: 4 }}>
                  <IconClock size={13} />
                  Expires {new Date(earliestExpiry).toLocaleString()}
                </p>
              </div>
              <button
                type="button"
                className="v-btn v-btn-primary"
                style={{ flexShrink: 0 }}
                onClick={() => onConvert(group)}
              >
                Convert to booking request
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
