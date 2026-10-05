import { useState, useEffect } from "react";
import { useAuth } from "../../auth/useAuth";
import { fetchBookableEvents, fetchVenueSuitability } from "../../../lib/api";
import { IconAlert, IconCheck, IconUsers } from "./VenueIcons";

// SCRUM-19: assess a shortlisted venue against one of the coordinator's own
// events, before requesting it. Shown on the venue page rather than inside the
// booking form, because AC1 puts the assessment after shortlisting and the
// point is to avoid requesting a venue that does not suit.
//
// The verdict is advice, not a gate. Nothing here stops a coordinator
// submitting a request: SCRUM-21 is what refuses one, and it reads the same
// venue fields, so the two cannot disagree.
function VenueSuitabilityPanel({ venue }) {
  const { token } = useAuth();
  const [events, setEvents] = useState([]);
  const [eventsError, setEventsError] = useState(null);
  const [eventId, setEventId] = useState("");
  const [result, setResult] = useState(null);

  const venueId = venue.id;
  const queryKey = JSON.stringify([venueId, eventId, token]);
  const current = result?.key === queryKey;
  const assessment = current ? result.assessment : null;
  const error = current ? result.error : null;
  const isLoading = eventId !== "" && !current;

  useEffect(() => {
    let active = true;
    fetchBookableEvents(token)
      .then((list) => { if (active) setEvents(list); })
      .catch((err) => { if (active) setEventsError(err.message); });
    return () => { active = false; };
  }, [token]);

  useEffect(() => {
    if (eventId === "") return undefined;
    let active = true;
    fetchVenueSuitability(venueId, eventId, token)
      .then((assessment) => { if (active) setResult({ key: queryKey, assessment }); })
      .catch((err) => { if (active) setResult({ key: queryKey, error: err.message }); });
    return () => { active = false; };
  }, [venueId, eventId, token, queryKey]);

  return (
    <section className="v-card">
      <div className="v-card-header">
        <h2 className="v-card-title">Check suitability</h2>
        <p className="v-card-desc">
          Compare one of your events with what this venue offers, before you
          request it.
        </p>
      </div>

      {eventsError && (
        <p className="v-alert v-alert-error" role="alert">
          <IconAlert />
          <span>Could not load your events: {eventsError}</span>
        </p>
      )}

      <label className="v-field">
        <span className="v-label">Event</span>
        <select
          className="v-input"
          value={eventId}
          onChange={(e) => setEventId(e.target.value)}
        >
          <option value="">Choose an event</option>
          {events.map((event) => (
            <option key={event.id} value={event.id}>{event.name}</option>
          ))}
        </select>
      </label>

      {events.length === 0 && !eventsError && (
        <p className="v-none">You have no events to assess yet.</p>
      )}

      {isLoading && <p className="v-none">Checking...</p>}

      {error && (
        <p className="v-alert v-alert-error" role="alert">
          <IconAlert />
          <span>{error}</span>
        </p>
      )}

      {assessment && (
        <>
          <p
            className={`v-alert ${assessment.verdict === "suitable" ? "v-alert-ok" : "v-alert-error"}`}
            role="status"
          >
            {assessment.verdict === "suitable" ? <IconCheck /> : <IconAlert />}
            <span>
              {assessment.verdict === "suitable"
                ? "Nothing recorded on this event rules this venue out."
                : `${assessment.unmet_count} requirement${assessment.unmet_count === 1 ? "" : "s"} this venue does not meet.`}
            </span>
          </p>

          <ul className="v-check-list">
            {assessment.checks.map((check, index) => (
              <li
                key={`${check.requirement}-${check.needed}-${index}`}
                className={`v-check-row ${check.met === false ? "is-unmet" : ""}`}
              >
                <span className="v-check-icon">
                  {check.met === true ? <IconCheck size={14} /> : null}
                  {check.met === false ? <IconAlert size={14} /> : null}
                  {check.met === null ? <IconUsers size={14} /> : null}
                </span>
                <span className="v-check-need">
                  <strong>{check.requirement}</strong>
                  {": "}
                  {check.needed}
                </span>
                <span className="v-check-have">{check.available}</span>
              </li>
            ))}
          </ul>

          {assessment.unknown_count > 0 && (
            <p className="v-hint">
              {assessment.unknown_count} requirement
              {assessment.unknown_count === 1 ? " was" : "s were"} not recorded
              on the event, so {assessment.unknown_count === 1 ? "it" : "they"}{" "}
              could not be compared.
            </p>
          )}

          <p className="v-hint">
            This is a comparison of what the event records against what the
            venue offers. You decide whether to request it.
          </p>
        </>
      )}
    </section>
  );
}

export default VenueSuitabilityPanel;
