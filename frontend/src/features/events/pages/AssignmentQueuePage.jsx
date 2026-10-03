import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../auth/useAuth";
import {
  assignCoordinator,
  fetchAssignmentQueue,
  fetchCoordinators,
} from "../assignmentsService";
import EventQueueList from "../components/EventQueueList";
import EventDetailPanel from "../components/EventDetailPanel";
import CoordinatorTable from "../components/CoordinatorTable";
import "../events.css";

// SCRUM-26. The Event Operations Manager reads a submitted request and routes
// it to an Event Coordinator. That is the whole screen.
//
// Deliberately absent, because each belongs to a story of its own:
//   approve / reject / return for clarification  US-36, US-37, US-38, US-39
//   any status change on assignment              clarification #1: no acceptance step
//   changing an already-assigned coordinator     US-50 (re-assignment)
//   search, filter, sort                         US-49
//   notifying anyone                             US-29 to US-32
const EMPTY = [];

export default function AssignmentQueuePage() {
  const { token } = useAuth();
  const [queue, setQueue] = useState(null);
  const [reloads, setReloads] = useState(0);
  const [selectedEventId, setSelectedEventId] = useState(null);
  const [picking, setPicking] = useState(false);
  const [coordinators, setCoordinators] = useState(null);
  const [selectedCoordinatorId, setSelectedCoordinatorId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");
  const [stale, setStale] = useState(false);
  const [confirmation, setConfirmation] = useState("");

  // Results are keyed by token so a sign-out or account switch cannot leave one
  // user looking at another's data while the next request is in flight.
  const current = queue?.token === token && queue.reloads === reloads;
  const events = current ? queue.events : EMPTY;
  const loading = !current;
  const loadError = current ? queue.error : "";

  useEffect(() => {
    let active = true;
    fetchAssignmentQueue(token)
      .then((next) => { if (active) setQueue({ token, reloads, events: next, error: "" }); })
      .catch((error) => { if (active) setQueue({ token, reloads, events: EMPTY, error: error.message }); });
    return () => { active = false; };
  }, [token, reloads]);

  const reload = useCallback(() => {
    setStale(false);
    setProblem("");
    setPicking(false);
    setSelectedCoordinatorId(null);
    setCoordinators(null);
    setReloads((count) => count + 1);
  }, []);

  // The directory is fetched when the manager first opens it, not with the
  // queue: most visits are a glance at what is waiting.
  useEffect(() => {
    if (!picking || coordinators) return;
    let active = true;
    fetchCoordinators(token)
      .then((next) => { if (active) setCoordinators({ token, list: next, error: "" }); })
      .catch((error) => { if (active) setCoordinators({ token, list: EMPTY, error: error.message }); });
    return () => { active = false; };
  }, [picking, coordinators, token]);

  const selectedEvent = events.find((event) => event.id === selectedEventId) ?? null;
  const coordinatorList = coordinators?.token === token ? coordinators.list : EMPTY;
  const chosen = coordinatorList.find((one) => one.id === selectedCoordinatorId) ?? null;

  function selectEvent(id) {
    setSelectedEventId(id);
    setPicking(false);
    setSelectedCoordinatorId(null);
    setProblem("");
    setConfirmation("");
  }

  function submit() {
    if (!selectedEvent || !chosen || saving) return;
    setSaving(true);
    setProblem("");
    assignCoordinator(selectedEvent.id, chosen.id, token)
      .then(() => {
        const name = chosen.fullName || chosen.email;
        setConfirmation(`${selectedEvent.name} is now assigned to ${name}.`);
        // The request has left the queue; drop it locally rather than refetch.
        setQueue((previous) => ({
          ...previous, events: previous.events.filter((event) => event.id !== selectedEvent.id),
        }));
        setSelectedEventId(null);
        setPicking(false);
        setSelectedCoordinatorId(null);
        setCoordinators(null);
      })
      .catch((error) => {
        // 409 is not a mistake the manager made - a colleague got there first.
        // Saying so, and offering the refresh, is the difference between a
        // useful message and one that invites the same click again.
        setStale(error.status === 409 || error.status === 404);
        setProblem(error.message);
      })
      .finally(() => setSaving(false));
  }

  return (
    <section className="card assign-page" aria-labelledby="assign-title">
      <div className="card-heading">
        <p className="eyebrow">EVENT OPERATIONS</p>
        <h1 id="assign-title">Assign an Event Coordinator</h1>
        <p>
          Submitted requests waiting for a coordinator, oldest first. Assigning
          names the coordinator who becomes the main point of contact; it does
          not approve the request.
        </p>
      </div>

      {confirmation && (
        <p className="assign-confirmation" role="status">{confirmation}</p>
      )}
      {loadError && <p className="error" role="alert">{loadError}</p>}

      <div className="assign-layout">
        <div className="assign-column">
          <h2 className="assign-column-title">Waiting for assignment</h2>
          {loading && !loadError
            ? <p role="status">Loading the queue…</p>
            : <EventQueueList events={events} selectedId={selectedEventId} onSelect={selectEvent} />}
        </div>

        <div className="assign-column">
          {selectedEvent ? (
            <>
              <EventDetailPanel event={selectedEvent} />

              {picking ? (
                <>
                  {coordinators?.error && <p className="error" role="alert">{coordinators.error}</p>}
                  {!coordinators && <p role="status">Loading coordinators…</p>}
                  {coordinators && !coordinators.error && (
                    <CoordinatorTable
                      coordinators={coordinatorList}
                      selectedId={selectedCoordinatorId}
                      onSelect={setSelectedCoordinatorId}
                      disabled={saving}
                    />
                  )}
                  {problem && (
                    <p className="error" role="alert">
                      {problem}
                      {stale && (
                        <>
                          {" "}
                          <button type="button" className="assign-inline-link" onClick={reload}>
                            Refresh the queue
                          </button>
                        </>
                      )}
                    </p>
                  )}
                  <button
                    type="button"
                    className="primary"
                    disabled={!chosen || saving}
                    onClick={submit}
                  >
                    {saving
                      ? "Assigning…"
                      : chosen
                        ? `Assign to ${chosen.fullName || chosen.email}`
                        : "Select a coordinator"}
                  </button>
                  <p className="card-note">
                    There is no undo. Changing the coordinator afterwards is not
                    yet supported.
                  </p>
                </>
              ) : (
                // The single action on this screen. The request itself is
                // read-only here: amending it is the coordinator's job.
                <button type="button" className="primary" onClick={() => setPicking(true)}>
                  Assign coordinator
                </button>
              )}
            </>
          ) : (
            <p className="assign-placeholder" role="status">
              Select a request to see its details.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
