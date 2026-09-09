function VenueCard({ venue, onSelect }) {
  return (
    <div className="venue-card" onClick={() => onSelect(venue.id)}>
      <h3>{venue.name}</h3>
      <p className="venue-location">
        {venue.city}, {venue.country}
      </p>
      <p className="venue-capacity">Capacity: {venue.capacity}</p>

      {venue.room_layouts.length > 0 && (
        <p className="venue-layouts">
          Layouts: {venue.room_layouts.join(", ")}
        </p>
      )}

      <button type="button">View details</button>
    </div>
  );
}

export default VenueCard;