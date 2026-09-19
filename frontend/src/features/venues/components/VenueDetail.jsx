import {
  IconArrowLeft,
  IconCalendar,
  IconClock,
  IconMapPin,
  IconPencil,
  IconUsers,
} from "./VenueIcons";

const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_LABELS = {
  mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday",
  fri: "Friday", sat: "Saturday", sun: "Sunday",
};

// Today's day in Singapore time, the zone the venues operate in. Used only to
// highlight a row, so a mismatch with the viewer's own clock is harmless.
function todayKey() {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: "Asia/Singapore",
  })
    .format(new Date())
    .toLowerCase();
}

function OperatingHours({ hours }) {
  const days = DAY_ORDER.filter((day) => hours[day]);
  const today = todayKey();

  if (days.length === 0) {
    return <p className="v-none">No operating hours recorded.</p>;
  }

  return (
    <ul className="v-hours">
      {days.map((day) => {
        const entry = hours[day];
        const isToday = day === today;
        return (
          <li key={day} className={`v-hours-row ${isToday ? "is-today" : ""}`}>
            <span className="v-hours-day">
              {DAY_LABELS[day]}
              {isToday && <span className="v-tag">Today</span>}
            </span>
            {entry.closed ? (
              <span className="v-hours-closed">Closed</span>
            ) : (
              <span className="v-hours-time">
                {entry.open} - {entry.close}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ChipList({ items }) {
  if (items.length === 0) {
    return <p className="v-none">None recorded</p>;
  }
  return (
    <ul className="v-chips">
      {items.map((item) => (
        <li key={item} className="v-chip">
          {item}
        </li>
      ))}
    </ul>
  );
}

function Stat({ icon, label, value, unit }) {
  return (
    <div className="v-card v-stat">
      <p className="v-stat-label">
        {icon}
        {label}
      </p>
      <p className="v-stat-value">
        {value}
        <span className="v-stat-unit">{unit}</span>
      </p>
    </div>
  );
}

function VenueDetail({ venue, onBack, onEdit, onViewAvailability }) {
  return (
    <div className="venue-detail">
      <button type="button" className="v-back" onClick={onBack}>
        <IconArrowLeft />
        Back to catalogue
      </button>

      <header className="v-page-header">
        <div>
          {/* SCRUM-82: location and capacity */}
          <p className="v-eyebrow">
            <IconMapPin size={13} />
            {venue.city}, {venue.country}
          </p>
          <h1 className="v-title">{venue.name}</h1>
          <p className="v-subtitle">{venue.address}</p>
        </div>

        <div className="v-actions">
          {onEdit && <button type="button" className="v-btn v-btn-secondary" onClick={onEdit}>
            <IconPencil />
            Edit operating information
          </button>}

          {/* SCRUM-17: view venue availability calendar */}
          <button
            type="button"
            className="v-btn v-btn-primary"
            onClick={onViewAvailability}
          >
            <IconCalendar />
            View availability calendar
          </button>
        </div>
      </header>

      {/* SCRUM-82 capacity, SCRUM-84 / SCRUM-90 setup requirements */}
      <div className="v-stats">
        <Stat
          icon={<IconUsers size={15} />}
          label="Capacity"
          value={venue.capacity}
          unit="people"
        />
        <Stat
          icon={<IconClock size={15} />}
          label="Setup"
          value={venue.setup_minutes}
          unit="minutes"
        />
        <Stat
          icon={<IconClock size={15} />}
          label="Teardown"
          value={venue.teardown_minutes}
          unit="minutes"
        />
        <Stat
          icon={<IconClock size={15} />}
          label="Turnaround"
          value={venue.turnaround_minutes}
          unit="minutes"
        />
      </div>

      <div className="v-detail-grid">
        {/* SCRUM-83: facilities, accessibility, room layouts */}
        <div className="v-stack">
          <section className="v-card">
            <div className="v-card-header">
              <h2 className="v-card-title">Facilities</h2>
              <p className="v-card-desc">Equipment and amenities on site.</p>
            </div>
            <ChipList items={venue.facilities} />
          </section>

          <section className="v-card">
            <div className="v-card-header">
              <h2 className="v-card-title">Accessibility</h2>
              <p className="v-card-desc">Access features available to guests.</p>
            </div>
            <ChipList items={venue.accessibility_features} />
          </section>

          <section className="v-card">
            <div className="v-card-header">
              <h2 className="v-card-title">Room layouts</h2>
              <p className="v-card-desc">Seating arrangements this venue supports.</p>
            </div>
            <ChipList items={venue.room_layouts} />
          </section>
        </div>

        {/* SCRUM-84: operating information */}
        <div className="v-stack">
          <section className="v-card">
            <div className="v-card-header">
              <h2 className="v-card-title">Operating hours</h2>
              <p className="v-card-desc">Local time at the venue.</p>
            </div>
            <OperatingHours hours={venue.operating_hours} />
          </section>

          {venue.notes && (
            <section className="v-card">
              <div className="v-card-header">
                <h2 className="v-card-title">Notes</h2>
              </div>
              <p className="v-notes">{venue.notes}</p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

export default VenueDetail;
