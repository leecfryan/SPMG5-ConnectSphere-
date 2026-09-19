import { useAuth } from "../../auth/useAuth";
import { useState, useEffect } from "react";
import { fetchVenueAvailability } from "../../../lib/api";
import {
  IconAlert,
  IconArrowLeft,
  IconCalendar,
  IconChevronLeft,
  IconChevronRight,
} from "./VenueIcons";
import { formatDate } from "../venueFormat";

// SCRUM-95: a day is three slots. A full day booking fills all three.
const SLOTS = ["am", "pm", "night"];
const SLOT_LABELS = { am: "AM", pm: "PM", night: "Night" };

// Same windows as SLOT_WINDOWS in backend venues.availability.js
const SLOT_TIMES = {
  am: "08:00 - 12:00",
  pm: "12:00 - 18:00",
  night: "18:00 - 23:00",
};

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

// SCRUM-89 closed, SCRUM-93 unavailable, SCRUM-94 booked vs requested
const LEGEND = [
  { status: "available", text: "Available, open for booking" },
  { status: "pending", text: "Requested, awaiting Venue Staff, still bookable" },
  { status: "booked", text: "Booked, confirmed booking" },
  { status: "unavailable", text: "Unavailable, recorded by Venue Staff" },
  { status: "closed", text: "Closed, outside operating hours" },
];

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
  const { token } = useAuth();
  // Read the id once here rather than inside the effect or a handler. The
  // React Compiler hoists a closure's property reads into its memo check, and
  // that is what crashed the catalogue page in SCRUM-16.
  const venueId = venue.id;

  const [from, setFrom] = useState(todayString);
  const [result, setResult] = useState(null);

  const to = shiftDate(from, RANGE_DAYS - 1);
  const today = todayString();

  const queryKey = JSON.stringify([venueId, from, to, token]);
  const current = result?.key === queryKey;
  const days = current ? result.days : [];
  const isLoading = !current;
  const error = current ? result.error : null;
  useEffect(() => {
    let active = true;
    fetchVenueAvailability(venueId, { from, to }, token)
      .then((data) => { if (active) setResult({ key: queryKey, days: data.days }); })
      .catch((err) => { if (active) setResult({ key: queryKey, days: [], error: err.message }); });
    return () => { active = false; };
  }, [venueId, from, to, token, queryKey]);

  function handleStartDateChange(value) {
    // Clearing a date input gives "", and shiftDate("") throws, which would
    // blank the whole page. Keep the current range until a real date is picked.
    if (value) setFrom(value);
  }

  return (
    <div className="venue-availability">
      <button type="button" className="v-back" onClick={onBack}>
        <IconArrowLeft />
        Back to venue
      </button>

      <header className="v-page-header">
        <div>
          <p className="v-eyebrow">Availability calendar</p>
          <h1 className="v-title">{venue.name}</h1>
          <p className="v-subtitle">
            Each day is split into AM, PM and Night. Only a confirmed booking
            takes a slot, so Requested slots can still be requested.
          </p>
        </div>

        {/* SCRUM-21: request slots straight from the calendar that shows them */}
        {onRequestBooking && <div className="v-actions">
          <button
            type="button"
            className="v-btn v-btn-primary"
            onClick={onRequestBooking}
          >
            <IconCalendar />
            Request a booking
          </button>
        </div>}
      </header>

      <div className="v-card v-cal-toolbar">
        <div className="v-cal-toolbar-left">
          <div className="v-segmented" role="group" aria-label="Change dates">
            <button
              type="button"
              onClick={() => setFrom(shiftDate(from, -RANGE_DAYS))}
            >
              <IconChevronLeft size={15} />
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
              <IconChevronRight size={15} />
            </button>
          </div>

          <p className="v-cal-range" aria-live="polite">
            Showing {formatDate(from)} to {formatDate(to, { year: true })}
          </p>
        </div>

        <label className="v-cal-date-field">
          Start date
          <input
            className="v-input"
            type="date"
            value={from}
            onChange={(e) => handleStartDateChange(e.target.value)}
          />
        </label>
      </div>

      {error && (
        <p className="v-alert v-alert-error" role="alert">
          <IconAlert />
          <span>Could not load availability: {error}</span>
        </p>
      )}

      {!error && (
        <div className="v-card v-table-card">
          <div className="v-table-scroll">
            <table className="v-cal">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  {SLOTS.map((slot) => (
                    <th key={slot} scope="col">
                      {SLOT_LABELS[slot]}
                      <small>{SLOT_TIMES[slot]}</small>
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {isLoading &&
                  Array.from({ length: 7 }, (_, index) => (
                    <tr key={index}>
                      <td className="v-cal-date">
                        <div className="v-skeleton" style={{ width: 70, height: 30 }} />
                      </td>
                      {SLOTS.map((slot) => (
                        <td key={slot}>
                          <div className="v-skeleton" style={{ height: 54 }} />
                        </td>
                      ))}
                    </tr>
                  ))}

                {!isLoading &&
                  days.map((day) => (
                    <tr
                      key={day.date}
                      className={`v-cal-row ${day.date === today ? "is-today" : ""}`}
                    >
                      <th scope="row" className="v-cal-date">
                        <span className="v-cal-weekday">{DAY_LABELS[day.day]}</span>
                        <span className="v-cal-day">
                          {formatDate(day.date)}
                          {day.date === today && <span className="v-tag">Today</span>}
                        </span>
                      </th>

                      {SLOTS.map((slot) => {
                        const cell = day.slots[slot];
                        return (
                          <td key={slot}>
                            <div className={`v-slot v-slot-${cell.status}`}>
                              <span className="v-slot-status">
                                {STATUS_LABELS[cell.status]}
                              </span>
                              {STATUSES_WITH_DETAIL.includes(cell.status) && (
                                <span className="v-slot-detail" title={cell.label}>
                                  {cell.label}
                                </span>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SCRUM-94: "Requested" is deliberately not a blocker. Only a confirmed
          booking consumes the slot, which is why it reads differently here. */}
      <ul className="v-legend" aria-label="Legend">
        {LEGEND.map((item) => (
          <li key={item.status}>
            <span className={`v-legend-swatch v-slot-${item.status}`} aria-hidden="true" />
            {item.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default VenueAvailabilityCalendar;
