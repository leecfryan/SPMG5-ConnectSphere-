import { IconArrowRight, IconMapPin, IconUsers } from "./VenueIcons";

// Enough chips to compare venues at a glance without the cards growing uneven
const MAX_CHIPS = 3;

// "Marina Grand Ballroom" -> "MG". A quick visual anchor per venue until the
// catalogue has real photos.
function initialsOf(name) {
  return name
    .split(/\s+/)
    .filter((word) => /^[A-Za-z]/.test(word))
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join("");
}

function ChipPreview({ items }) {
  const shown = items.slice(0, MAX_CHIPS);
  const hidden = items.length - shown.length;

  return (
    <ul className="v-chips">
      {shown.map((item) => (
        <li key={item} className="v-chip">
          {item}
        </li>
      ))}
      {hidden > 0 && <li className="v-chip v-chip-more">+{hidden} more</li>}
    </ul>
  );
}

// SCRUM-15: one venue in the catalogue.
// The venue name is the real button, and its ::after stretches over the whole
// card so any click on the card opens it. That keeps the markup valid (no
// headings or lists inside a <button>) and gives screen readers a short,
// meaningful button name instead of the entire card read as one label.
function VenueCard({ venue, onSelect }) {
  const venueId = venue.id;

  return (
    <article className="v-venue-card">
      <div className="v-venue-card-top">
        <span className="v-monogram" aria-hidden="true">
          {initialsOf(venue.name)}
        </span>
        <div>
          <h3 className="v-venue-card-name">
            <button
              type="button"
              className="v-venue-card-link"
              onClick={() => onSelect(venueId)}
            >
              {venue.name}
            </button>
          </h3>
          {/* SCRUM-82: location and capacity */}
          <p className="v-meta">
            <span>
              <IconMapPin size={14} />
              {venue.city}, {venue.country}
            </span>
            <span>
              <IconUsers size={14} />
              Capacity: {venue.capacity}
            </span>
          </p>
        </div>
      </div>

      {/* SCRUM-83 */}
      {venue.room_layouts.length > 0 && (
        <div>
          <p className="v-venue-card-section-label">Layouts</p>
          <ChipPreview items={venue.room_layouts} />
        </div>
      )}

      {venue.facilities.length > 0 && (
        <div>
          <p className="v-venue-card-section-label">Facilities</p>
          <ChipPreview items={venue.facilities} />
        </div>
      )}

      <span className="v-venue-card-footer" aria-hidden="true">
        View details
        <IconArrowRight />
      </span>
    </article>
  );
}

export default VenueCard;
