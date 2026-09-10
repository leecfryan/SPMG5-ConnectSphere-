const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_LABELS = {
  mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday",
  fri: "Friday", sat: "Saturday", sun: "Sunday",
};

function OperatingHours({ hours }) {
  const days = DAY_ORDER.filter((day) => hours[day]);

  if (days.length === 0) {
    return <p>No operating hours recorded.</p>;
  }

  return (
    <table className="venue-hours">
      <tbody>
        {days.map((day) => {
          const entry = hours[day];
          return (
            <tr key={day}>
              <td>{DAY_LABELS[day]}</td>
              <td>
                {entry.closed ? "Closed" : `${entry.open} - ${entry.close}`}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function VenueDetail({ venue, onBack, onEdit }) {
  return (
    <div className="venue-detail">
      <button type="button" onClick={onBack}>
        Back to catalogue
      </button>

      <button type="button" onClick={onEdit}>
        Edit operating information
      </button>

      <h2>{venue.name}</h2>

      {/* SCRUM-82: location and capacity */}
      <section>
        <h3>Location and capacity</h3>
        <p>{venue.address}</p>
        <p>{venue.city}, {venue.country}</p>
        <p>Capacity: {venue.capacity} people</p>
      </section>

      {/* SCRUM-83: facilities, accessibility, room layouts */}
      <section>
        <h3>Facilities</h3>
        <ul>
          {venue.facilities.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </section>

      <section>
        <h3>Accessibility</h3>
        <ul>
          {venue.accessibility_features.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section>
        <h3>Room layouts</h3>
        <ul>
          {venue.room_layouts.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </section>

      {/* SCRUM-84: operating information */}
      <section>
        <h3>Operating hours</h3>
        <OperatingHours hours={venue.operating_hours} />
      </section>

      <section>
        <h3>Setup requirements</h3>
        <p>Setup: {venue.setup_minutes} minutes</p>
        <p>Teardown: {venue.teardown_minutes} minutes</p>
        <p>Turnaround: {venue.turnaround_minutes} minutes</p>
      </section>

      {venue.notes && (
        <section>
          <h3>Notes</h3>
          <p>{venue.notes}</p>
        </section>
      )}
    </div>
  );
}

export default VenueDetail;