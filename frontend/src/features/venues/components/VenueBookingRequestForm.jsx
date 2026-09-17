import { useState, useEffect } from "react";
import {
  fetchBookableEvents,
  fetchVenueAvailability,
  submitBookingRequest,
} from "../../../lib/api";
import {
  IconAlert,
  IconArrowLeft,
  IconCalendar,
  IconCheck,
  IconClock,
} from "./VenueIcons";
import { formatDate, formatDateTime, localDate } from "../venueFormat";

const SLOTS = ["am", "pm", "night"];
const SLOT_LABELS = { am: "AM", pm: "PM", night: "Night" };

// Same windows as SLOT_WINDOWS in backend venues.availability.js
const SLOT_TIMES = {
  am: "08:00 - 12:00",
  pm: "12:00 - 18:00",
  night: "18:00 - 23:00",
};

const STATUS_LABELS = {
  available: "Available",
  booked: "Booked",
  pending: "Requested",
  unavailable: "Unavailable",
  closed: "Closed",
};

// Matches REQUESTABLE_STATUSES in venues.bookingRequests.validation.js.
// The backend re-checks, this only stops the obvious mistakes early.
const REQUESTABLE_STATUSES = ["available", "pending"];

const REQUEST_STATUS_LABELS = {
  pending: "Pending review",
  confirmed: "Confirmed",
  rejected: "Rejected",
  cancelled: "Cancelled",
  mixed: "Partly decided",
};

function toggle(list, item) {
  return list.includes(item)
    ? list.filter((existing) => existing !== item)
    : [...list, item];
}

function slotHint(cell) {
  if (cell.status === "pending") return `${cell.label}, already requested but still open`;
  if (cell.status === "booked" || cell.status === "unavailable") return cell.label;
  if (cell.status === "closed") return "Outside operating hours";
  return "Open for booking";
}

function StepHeader({ number, title, description }) {
  return (
    <div className="v-step-header">
      <span className="v-step-number" aria-hidden="true">
        {number}
      </span>
      <div>
        <h2 className="v-card-title">{title}</h2>
        <p className="v-card-desc">{description}</p>
      </div>
    </div>
  );
}

function ChipToggleGroup({ legend, options, selected, onToggle }) {
  return (
    <fieldset className="v-fieldset">
      <legend>{legend}</legend>
      {options.length === 0 ? (
        <p className="v-none">None recorded for this venue</p>
      ) : (
        <div className="v-chips">
          {options.map((item) => {
            const isSelected = selected.includes(item);
            return (
              <label
                key={item}
                className={`v-chip-toggle ${isSelected ? "is-selected" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onToggle(item)}
                />
                <IconCheck size={14} />
                {item}
              </label>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}

function VenueBookingRequestForm({ venue, onDone, onCancel }) {
  // Plain values read once, never venue.something inside a handler. The React
  // Compiler hoists property reads out of closures into its memo checks, which
  // is what crashed the catalogue page in SCRUM-16.
  const venueId = venue.id;
  const capacity = venue.capacity;
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

  const attendeeCount = Number(expectedAttendees);
  const isOverCapacity = attendeeCount > capacity;
  const capacityPercent = Math.min(100, Math.max(0, (attendeeCount / capacity) * 100));

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
      <div className="venue-booking-request v-page-narrow">
        <div className="v-card v-success">
          <div className="v-success-icon">
            <IconCheck size={28} />
          </div>
          <p className="v-eyebrow">Request received</p>
          <h1 className="v-title">Booking request submitted</h1>
          <p className="v-subtitle" style={{ marginInline: "auto" }}>
            Your request is now with Venue Staff for review. The slots show as
            Requested on the availability calendar until they decide.
          </p>

          <dl className="v-summary">
            <dt>Reference</dt>
            <dd className="v-mono">{created.id}</dd>
            <dt>Venue</dt>
            <dd>{created.venue.name}</dd>
            <dt>Event</dt>
            <dd>{created.event.name}</dd>
            <dt>Date and slots</dt>
            <dd>
              {formatDate(created.booking_date, { weekday: true, year: true })},{" "}
              {created.slots.map((slot) => SLOT_LABELS[slot.slot]).join(", ")}
            </dd>
            <dt>Status</dt>
            <dd>
              <span className={`v-status v-status-${created.status}`}>
                {REQUEST_STATUS_LABELS[created.status] || created.status}
              </span>
            </dd>
          </dl>

          <button type="button" className="v-btn v-btn-primary v-btn-lg" onClick={onDone}>
            <IconCalendar />
            Back to calendar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="venue-booking-request v-page-narrow">
      <button
        type="button"
        className="v-back"
        onClick={onCancel}
        disabled={isSubmitting}
      >
        <IconArrowLeft />
        Back to calendar
      </button>

      <header className="v-page-header">
        <div>
          <p className="v-eyebrow">New booking request</p>
          <h1 className="v-title">Request a booking</h1>
          <p className="v-subtitle">
            {venue.name}, capacity {capacity}
          </p>
        </div>
      </header>

      <div className="v-steps">
        {/* SCRUM-85: the event this request is for */}
        <section className="v-card">
          <StepHeader
            number="1"
            title="Event"
            description="The event this venue is for. Only submitted, upcoming events are listed."
          />

          {isLoadingEvents && <p className="v-loading-line">Loading events...</p>}
          {eventsError && (
            <p className="v-alert v-alert-error" role="alert">
              <IconAlert />
              <span>Could not load events: {eventsError}</span>
            </p>
          )}
          {!isLoadingEvents && !eventsError && events.length === 0 && (
            <p className="v-callout">
              <IconAlert />
              <span>
                No submitted upcoming events. An event must be submitted, with a
                start and end time, before a venue can be requested for it.
              </span>
            </p>
          )}
          {events.length > 0 && (
            <label className="v-field">
              <span className="v-label">Event</span>
              <select
                className="v-input"
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
            </label>
          )}

          {/* SCRUM-86: the timing Venue Staff will assess */}
          {selectedEvent && selectedEvent.start_time && selectedEvent.end_time && (
            <p className="v-callout">
              <IconClock />
              <span>
                Runs {formatDateTime(selectedEvent.start_time)} to{" "}
                {formatDateTime(selectedEvent.end_time)}
              </span>
            </p>
          )}
        </section>

        {/* SCRUM-86: date and slots */}
        <section className="v-card">
          <StepHeader
            number="2"
            title="Date and slots"
            description="Pick a day within the event, then the slots you need. A full day is all three slots."
          />

          <label className="v-field" style={{ maxWidth: 240 }}>
            <span className="v-label">Date</span>
            <input
              className="v-input"
              type="date"
              value={bookingDate}
              onChange={(e) => handleDateChange(e.target.value)}
            />
          </label>

          {dayError && (
            <p className="v-alert v-alert-error" role="alert" style={{ marginTop: 16 }}>
              <IconAlert />
              <span>Could not check availability: {dayError}</span>
            </p>
          )}

          {!day && !dayError && (
            <div className="v-slot-options" aria-label="Checking availability...">
              {SLOTS.map((slot) => (
                <div key={slot} className="v-skeleton" style={{ height: 104 }} />
              ))}
            </div>
          )}

          {day && (
            <div className="v-slot-options">
              {SLOTS.map((slot) => {
                const cell = day.slots[slot];
                const requestable = REQUESTABLE_STATUSES.includes(cell.status);
                const isSelected = slots.includes(slot);
                return (
                  <label
                    key={slot}
                    className={`v-slot-option ${isSelected ? "is-selected" : ""} ${requestable ? "" : "is-disabled"}`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={!requestable}
                      onChange={() => setSlots((current) => toggle(current, slot))}
                    />
                    <span className="v-slot-option-name">{SLOT_LABELS[slot]}</span>
                    <span className="v-slot-option-time">{SLOT_TIMES[slot]}</span>
                    <span className={`v-status v-status-${cell.status}`}>
                      {STATUS_LABELS[cell.status]}
                    </span>
                    <span className="v-hint">{slotHint(cell)}</span>
                  </label>
                );
              })}
            </div>
          )}
        </section>

        {/* SCRUM-87: requirements, limited to what this venue offers */}
        <section className="v-card">
          <StepHeader
            number="3"
            title="Venue requirements"
            description="Only what this venue offers can be selected, so Venue Staff know it can be met."
          />

          <div className="v-form-grid">
            <label className="v-field">
              <span className="v-label">Expected attendees</span>
              <span className="v-input-with-suffix">
                <input
                  className="v-input"
                  type="number"
                  min="1"
                  max={capacity}
                  value={expectedAttendees}
                  onChange={(e) => setExpectedAttendees(e.target.value)}
                />
                <span className="v-input-suffix">/ {capacity}</span>
              </span>
              <span
                className={`v-capacity-meter ${isOverCapacity ? "is-over" : ""}`}
                aria-hidden="true"
              >
                <span style={{ width: `${capacityPercent}%` }} />
              </span>
              <span className="v-hint">
                {isOverCapacity
                  ? `Over this venue's capacity of ${capacity}`
                  : `Venue capacity is ${capacity}`}
              </span>
            </label>

            <label className="v-field">
              <span className="v-label">Room layout</span>
              <select
                className="v-input"
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
          </div>

          <hr className="v-divider" />

          <div className="v-stack">
            <ChipToggleGroup
              legend="Facilities needed"
              options={venueFacilities}
              selected={facilities}
              onToggle={(item) => setFacilities((current) => toggle(current, item))}
            />
            <ChipToggleGroup
              legend="Accessibility needed"
              options={venueAccessibility}
              selected={accessibility}
              onToggle={(item) => setAccessibility((current) => toggle(current, item))}
            />
          </div>

          <hr className="v-divider" />

          <label className="v-field">
            <span className="v-label">Anything else Venue Staff should know</span>
            <textarea
              className="v-input"
              rows="3"
              value={additional}
              onChange={(e) => setAdditional(e.target.value)}
            />
          </label>
        </section>

        {submitError && (
          <p className="v-alert v-alert-error" role="alert">
            <IconAlert />
            <span>Could not submit: {submitError}</span>
          </p>
        )}

        <div className="v-card v-action-bar">
          <p className="v-action-bar-note">
            Submitted requests go to Venue Staff for review.
          </p>
          <div className="v-form-actions">
            <button
              type="button"
              className="v-btn v-btn-secondary"
              onClick={onCancel}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="button"
              className="v-btn v-btn-primary"
              onClick={handleSubmit}
              disabled={isSubmitting}
            >
              {isSubmitting ? "Submitting..." : "Submit booking request"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default VenueBookingRequestForm;
