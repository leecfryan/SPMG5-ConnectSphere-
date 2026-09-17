import { useState, useEffect } from "react";
import { fetchVenueAvailability } from "../../../lib/api";
import "./VenueAvailabilityCalendar.css";

// SCRUM-95: a day is three slots. A full day booking fills all three.
const SLOTS = ["am", "pm", "night"];
const SLOT_LABELS = { am: "AM", pm: "PM", night: "Night" };

const DAY_LABELS = {
  mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu",
  fri: "Fri", sat: "Sat", sun: "Sun",
};

const STATUS_LABELS = {
  available: "Available",
  booked: "Booked",
  pending: "Requested",
  unavailable: "Unavailable",
  closed: "Closed",
};

// a slot whose label repeats the status adds nothing to the cell
const STATUSES_WITH_DETAIL = ["booked", "pending", "unavailable"];

const RANGE_DAYS = 14;

// Matches the UTC date handling in the backend. Building dates in local time
// would land on the wrong day for anyone east of UTC.
function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function shiftDate(dateString, days) {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function VenueAvailabilityCalendar({ venue, onBack, onRequestBooking }) {
  // Read the id once here rather than inside the effect or a handler. The
  // React Compiler hoists a closure's property reads into its memo check, and
  // that is what crashed the catalogue page in SCRUM-16.
  const venueId = venue.id;

  const [from, setFrom] = useState(todayString);
  const [days, setDays] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const to = shiftDate(from, RANGE_DAYS - 1);

  useEffect(() => {
    setIsLoading(true);
    setError(null);

    fetchVenueAvailability(venueId, { from, to })
      .then((data) => setDays(data.days))
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [venueId, from, to]);

  return (
    <div className="venue-availability">
      <button type="button" onClick={onBack}>
        Back to venue
      </button>

      {/* SCRUM-21: request slots straight from the calendar that shows them */}
      <button type="button" onClick={onRequestBooking}>
        Request a booking
      </button>

      <h2>Availability calendar</h2>
      <p>{venue.name}</p>

      <div className="venue-availability-controls">
        <button
          type="button"
          onClick={() => setFrom(shiftDate(from, -RANGE_DAYS))}
        >
          Previous 2 weeks
        </button>
        <button type="button" onClick={() => setFrom(todayString())}>
          Today
        </button>
        <button
          type="button"
          onClick={() => setFrom(shiftDate(from, RANGE_DAYS))}
        >
          Next 2 weeks
        </button>

        <label>
          Start date
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
      </div>

      <p className="venue-availability-range">
        Showing {from} to {to}
      </p>

      {isLoading && <p>Loading availability...</p>}
      {error && (
        <p className="venue-error">Could not load availability: {error}</p>
      )}

      {!isLoading && !error && (
        <table className="venue-availability-table">
          <thead>
            <tr>
              <th>Date</th>
              {SLOTS.map((slot) => (
                <th key={slot}>{SLOT_LABELS[slot]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map((day) => (
              <tr key={day.date}>
                <td className="venue-availability-date">
                  {DAY_LABELS[day.day]} {day.date}
                </td>

                {SLOTS.map((slot) => {
                  const cell = day.slots[slot];
                  return (
                    <td
                      key={slot}
                      className={`venue-slot venue-slot-${cell.status}`}
                    >
                      <span className="venue-slot-status">
                        {STATUS_LABELS[cell.status]}
                      </span>
                      {STATUSES_WITH_DETAIL.includes(cell.status) && (
                        <span className="venue-slot-detail">{cell.label}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* SCRUM-94: "Requested" is deliberately not a blocker. Only a confirmed
          booking consumes the slot, which is why it reads differently here. */}
      <ul className="venue-availability-legend">
        <li className="venue-slot-available">Available, open for booking</li>
        <li className="venue-slot-booked">Booked, confirmed booking (SCRUM-94)</li>
        <li className="venue-slot-pending">Requested, awaiting Venue Staff, still bookable</li>
        <li className="venue-slot-unavailable">Unavailable, recorded by Venue Staff (SCRUM-93)</li>
        <li className="venue-slot-closed">Closed, outside operating hours (SCRUM-89)</li>
      </ul>
    </div>
  );
}

export default VenueAvailabilityCalendar;
