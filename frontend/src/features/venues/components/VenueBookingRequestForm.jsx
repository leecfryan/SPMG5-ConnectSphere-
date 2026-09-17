import { useState, useEffect } from "react";
import {
  fetchBookableEvents,
  fetchVenueAvailability,
  submitBookingRequest,
} from "../../../lib/api";
// the slot colours are shared with the calendar, Vite only bundles this once
import "./VenueAvailabilityCalendar.css";
import "./VenueBookingRequest.css";

const SLOTS = ["am", "pm", "night"];
const SLOT_LABELS = { am: "AM", pm: "PM", night: "Night" };

// Matches REQUESTABLE_STATUSES in venues.bookingRequests.validation.js.
// The backend re-checks, this only stops the obvious mistakes early.
const REQUESTABLE_STATUSES = ["available", "pending"];

// Same zone the backend uses to decide which day an event falls on
const VENUE_TIME_ZONE = "Asia/Singapore";

function localDate(instant) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: VENUE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(instant));
}

function formatDateTime(instant) {
  return new Date(instant).toLocaleString("en-SG", {
    timeZone: VENUE_TIME_ZONE,
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function toggle(list, item) {
  return list.includes(item)
    ? list.filter((existing) => existing !== item)
    : [...list, item];
}

function VenueBookingRequestForm({ venue, onDone, onCancel }) {
  // Plain values read once, never venue.something inside a handler. The React
  // Compiler hoists property reads out of closures into its memo checks, which
  // is what crashed the catalogue page in SCRUM-16.
  const venueId = venue.id;
  const roomLayouts = venue.room_layouts;
  const venueFacilities = venue.facilities;
  const venueAccessibility = venue.accessibility_features;

  const [events, setEvents] = useState([]);
  const [eventsError, setEventsError] = useState(null);
  const [isLoadingEvents, setIsLoadingEvents] = useState(true);

  // SCRUM-85 and SCRUM-86
  const [eventId, setEventId] = useState("");
  const [bookingDate, setBookingDate] = useState(() => localDate(new Date()));
  const [slots, setSlots] = useState([]);
  const [day, setDay] = useState(null);
  const [dayError, setDayError] = useState(null);

  // SCRUM-87
  const [expectedAttendees, setExpectedAttendees] = useState("");
  const [roomLayout, setRoomLayout] = useState("");
  const [facilities, setFacilities] = useState([]);
  const [accessibility, setAccessibility] = useState([]);
  const [additional, setAdditional] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [created, setCreated] = useState(null);

  useEffect(() => {
    fetchBookableEvents()
      .then((data) => setEvents(data))
      .catch((err) => setEventsError(err.message))
      .finally(() => setIsLoadingEvents(false));
  }, []);

  // Slot availability for the chosen day, from the same endpoint as the
  // SCRUM-17 calendar so the form and the calendar always agree.
  useEffect(() => {
    if (!bookingDate) return;
    setDay(null);
    setDayError(null);

    fetchVenueAvailability(venueId, { from: bookingDate, to: bookingDate })
      .then((data) => setDay(data.days[0]))
      .catch((err) => setDayError(err.message));
  }, [venueId, bookingDate]);

  const selectedEvent = events.find((event) => event.id === eventId) || null;

  function handleEventChange(nextEventId) {
    setEventId(nextEventId);

    const event = events.find((item) => item.id === nextEventId);
    if (!event) return;

    // Prefill from what the organiser already entered on the event. Everything
    // stays editable, these are starting points rather than locked values.
    if (event.start_time) {
      setBookingDate(localDate(event.start_time));
      setSlots([]);
    }
    if (Number.isInteger(event.expected_attendance)) {
      setExpectedAttendees(String(event.expected_attendance));
    }
    if (typeof event.venue_requirements === "string") {
      setAdditional(event.venue_requirements);
    }
  }

  function handleDateChange(nextDate) {
    setBookingDate(nextDate);
    // A slot free on the old date may not be free on the new one
    setSlots([]);
  }

  function handleSubmit() {
    setIsSubmitting(true);
    setSubmitError(null);

    submitBookingRequest(venueId, {
      event_id: eventId,
      booking_date: bookingDate,
      slots,
      // Number("") is 0, which the backend rejects with a clear message rather
      // than quietly saving it, unlike the minutes fields in SCRUM-16
      expected_attendees: Number(expectedAttendees),
      room_layout: roomLayout,
      required_facilities: facilities,
      accessibility_requirements: accessibility,
      additional_requirements: additional.trim() === "" ? null : additional.trim(),
    })
      .then((request) => setCreated(request))
      .catch((err) => setSubmitError(err.message))
      .finally(() => setIsSubmitting(false));
  }

  // SCRUM-88: confirmation that the request is now in the review queue
  if (created) {
    return (
      <div className="venue-booking-request">
        <h2>Booking request submitted</h2>
        <p>
          Your request is now with Venue Staff for review. The slots show as
          Requested on the availability calendar until they decide.
        </p>

        <dl className="venue-request-summary">
          <dt>Reference</dt>
          <dd>{created.id}</dd>
          <dt>Venue</dt>
          <dd>{created.venue.name}</dd>
          <dt>Event</dt>
          <dd>{created.event.name}</dd>
          <dt>Date and slots</dt>
          <dd>
            {created.booking_date},{" "}
            {created.slots.map((slot) => SLOT_LABELS[slot.slot]).join(", ")}
          </dd>
          <dt>Status</dt>
          <dd>{created.status}</dd>
        </dl>

        <button type="button" onClick={onDone}>
          Back to calendar
        </button>
      </div>
    );
  }

  return (
    <div className="venue-booking-request">
      <button type="button" onClick={onCancel} disabled={isSubmitting}>
        Cancel
      </button>

      <h2>Request a booking</h2>
      <p>
        {venue.name}, capacity {venue.capacity}
      </p>

      {/* SCRUM-85: the event this request is for */}
      <section>
        <h3>Event</h3>
        {isLoadingEvents && <p>Loading events...</p>}
        {eventsError && (
          <p className="venue-error">Could not load events: {eventsError}</p>
        )}
        {!isLoadingEvents && !eventsError && events.length === 0 && (
          <p>
            No submitted upcoming events. An event must be submitted, with a
            start and end time, before a venue can be requested for it.
          </p>
        )}
        {events.length > 0 && (
          <select
            value={eventId}
            onChange={(e) => handleEventChange(e.target.value)}
          >
            <option value="">Choose an event</option>
            {events.map((event) => (
              <option key={event.id} value={event.id}>
                {event.name}
              </option>
            ))}
          </select>
        )}

        {/* SCRUM-86: the timing Venue Staff will assess */}
        {selectedEvent && selectedEvent.start_time && selectedEvent.end_time && (
          <p className="venue-request-hint">
            Runs {formatDateTime(selectedEvent.start_time)} to{" "}
            {formatDateTime(selectedEvent.end_time)}
          </p>
        )}
      </section>

      {/* SCRUM-86: date and slots */}
      <section>
        <h3>Date and slots</h3>
        <label>
          Date
          <input
            type="date"
            value={bookingDate}
            onChange={(e) => handleDateChange(e.target.value)}
          />
        </label>

        {dayError && (
          <p className="venue-error">Could not check availability: {dayError}</p>
        )}
        {!day && !dayError && <p>Checking availability...</p>}

        {day && (
          <div className="venue-request-slots">
            {SLOTS.map((slot) => {
              const cell = day.slots[slot];
              const requestable = REQUESTABLE_STATUSES.includes(cell.status);
              return (
                <label
                  key={slot}
                  className={`venue-request-slot venue-slot-${cell.status}`}
                >
                  <input
                    type="checkbox"
                    checked={slots.includes(slot)}
                    disabled={!requestable}
                    onChange={() => setSlots((current) => toggle(current, slot))}
                  />
                  {SLOT_LABELS[slot]}{" "}
                  <span className="venue-request-hint">
                    {cell.status === "available" ? "Available" : cell.label}
                    {cell.status === "pending" && ", already requested but still open"}
                  </span>
                </label>
              );
            })}
          </div>
        )}
        <p className="venue-request-hint">
          A full day is all three slots.
        </p>
      </section>

      {/* SCRUM-87: requirements, limited to what this venue offers */}
      <section>
        <h3>Venue requirements</h3>

        <label>
          Expected attendees
          <input
            type="number"
            min="1"
            max={venue.capacity}
            value={expectedAttendees}
            onChange={(e) => setExpectedAttendees(e.target.value)}
          />
        </label>

        <label>
          Room layout
          <select
            value={roomLayout}
            onChange={(e) => setRoomLayout(e.target.value)}
          >
            <option value="">Choose a layout</option>
            {roomLayouts.map((layout) => (
              <option key={layout} value={layout}>
                {layout}
              </option>
            ))}
          </select>
        </label>

        <fieldset>
          <legend>Facilities needed</legend>
          {venueFacilities.map((item) => (
            <label key={item} className="venue-request-option">
              <input
                type="checkbox"
                checked={facilities.includes(item)}
                onChange={() => setFacilities((current) => toggle(current, item))}
              />
              {item}
            </label>
          ))}
        </fieldset>

        <fieldset>
          <legend>Accessibility needed</legend>
          {venueAccessibility.map((item) => (
            <label key={item} className="venue-request-option">
              <input
                type="checkbox"
                checked={accessibility.includes(item)}
                onChange={() =>
                  setAccessibility((current) => toggle(current, item))
                }
              />
              {item}
            </label>
          ))}
        </fieldset>

        <label>
          Anything else Venue Staff should know
          <textarea
            rows="3"
            value={additional}
            onChange={(e) => setAdditional(e.target.value)}
          />
        </label>
      </section>

      {submitError && (
        <p className="venue-error">Could not submit: {submitError}</p>
      )}

      <button type="button" onClick={handleSubmit} disabled={isSubmitting}>
        {isSubmitting ? "Submitting..." : "Submit booking request"}
      </button>
    </div>
  );
}

export default VenueBookingRequestForm;
