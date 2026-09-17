import { useState, useEffect } from "react";
import { fetchVenues, fetchVenueById, updateVenue } from "../../../lib/api";
import VenueCard from "../components/VenueCard";
import VenueDetail from "../components/VenueDetail";
import VenueEditForm from "../components/VenueEditForm";
import VenueAvailabilityCalendar from "../components/VenueAvailabilityCalendar";
import VenueBookingRequestForm from "../components/VenueBookingRequestForm";
import VenueBookingRequestList from "../components/VenueBookingRequestList";
import { IconAlert, IconInbox, IconSearch, IconUsers } from "../components/VenueIcons";
import "../venues.css";

const SKELETON_CARDS = [0, 1, 2];

function VenueCataloguePage() {
  const [venues, setVenues] = useState([]);
  const [selectedVenue, setSelectedVenue] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isViewingAvailability, setIsViewingAvailability] = useState(false);
  const [isRequestingBooking, setIsRequestingBooking] = useState(false);
  const [isReviewingRequests, setIsReviewingRequests] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const [cityFilter, setCityFilter] = useState("");
  const [minCapacityFilter, setMinCapacityFilter] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    setIsLoading(true);
    setError(null);

    fetchVenues({ city: cityFilter, minCapacity: minCapacityFilter })
      .then((data) => setVenues(data))
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [cityFilter, minCapacityFilter, refreshKey]);

  function handleSelectVenue(id) {
    setError(null);
    fetchVenueById(id)
      .then((data) => setSelectedVenue(data))
      .catch((err) => setError(err.message));
  }

  // Read the id during render instead of inside handleSave. The React Compiler
  // hoists a closure's property reads into its memo check, so reading
  // selectedVenue.id inside the callback made it run on every render, including
  // the first one where selectedVenue is still null.
  const selectedVenueId = selectedVenue ? selectedVenue.id : null;

  function handleSave(changes) {
    setIsSaving(true);
    setSaveError(null);

    updateVenue(selectedVenueId, changes)
      .then((updated) => {
        // SCRUM-91: the saved record is what we display
        setSelectedVenue(updated);
        setIsEditing(false);
        setRefreshKey((key) => key + 1);
      })
      .catch((err) => setSaveError(err.message))
      .finally(() => setIsSaving(false));
  }

  // There is no router, so switching views does not reset the scroll position.
  // Without this, opening a venue from lower down the list lands mid-page.
  const viewKey = [
    selectedVenueId,
    isEditing,
    isViewingAvailability,
    isRequestingBooking,
    isReviewingRequests,
  ].join("|");

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [viewKey]);

  let view;

  // SCRUM-88: the Venue Staff review queue is not tied to one venue, so it is
  // checked before anything that needs a selected venue.
  if (isReviewingRequests) {
    view = (
      <VenueBookingRequestList onBack={() => setIsReviewingRequests(false)} />
    );
  } else if (selectedVenue && isViewingAvailability && isRequestingBooking) {
    // SCRUM-21: opened from the calendar, and both ways out return to it. The
    // calendar refetches when it mounts, so a new request shows as Requested.
    view = (
      <VenueBookingRequestForm
        venue={selectedVenue}
        onDone={() => setIsRequestingBooking(false)}
        onCancel={() => setIsRequestingBooking(false)}
      />
    );
  } else if (selectedVenue && isViewingAvailability) {
    // SCRUM-17: availability is its own view, same state-driven switch as the
    // edit form. Still no router installed.
    view = (
      <VenueAvailabilityCalendar
        venue={selectedVenue}
        onBack={() => setIsViewingAvailability(false)}
        onRequestBooking={() => setIsRequestingBooking(true)}
      />
    );
  } else if (selectedVenue && isEditing) {
    view = (
      <VenueEditForm
        venue={selectedVenue}
        onSave={handleSave}
        onCancel={() => {
          setIsEditing(false);
          setSaveError(null);
        }}
        isSaving={isSaving}
        saveError={saveError}
      />
    );
  } else if (selectedVenue) {
    view = (
      <VenueDetail
        venue={selectedVenue}
        onBack={() => setSelectedVenue(null)}
        onEdit={() => setIsEditing(true)}
        onViewAvailability={() => setIsViewingAvailability(true)}
      />
    );
  } else {
    view = (
      <>
        <header className="v-page-header">
          <div>
            <p className="v-eyebrow">Venues</p>
            <h1 className="v-title">Venue catalogue</h1>
            <p className="v-subtitle">
              Compare venues by location and capacity, check availability, and
              request a booking for your event.
            </p>
          </div>

          {/* SCRUM-88: entry point for Venue Staff until there is real navigation */}
          <div className="v-actions">
            <button
              type="button"
              className="v-btn v-btn-secondary"
              onClick={() => setIsReviewingRequests(true)}
            >
              <IconInbox />
              Review booking requests (Venue Staff)
            </button>
          </div>
        </header>

        <div className="v-card v-toolbar">
          <label className="v-field">
            <span className="v-label">City</span>
            <span className="v-input-with-icon">
              <IconSearch />
              <input
                className="v-input"
                type="text"
                value={cityFilter}
                onChange={(e) => setCityFilter(e.target.value)}
                placeholder="e.g. Singapore"
              />
            </span>
          </label>

          <label className="v-field">
            <span className="v-label">Minimum capacity</span>
            <span className="v-input-with-icon">
              <IconUsers />
              <input
                className="v-input"
                type="number"
                min="0"
                value={minCapacityFilter}
                onChange={(e) => setMinCapacityFilter(e.target.value)}
                placeholder="e.g. 100"
              />
            </span>
          </label>

          {!isLoading && !error && (
            <p className="v-toolbar-meta">
              {venues.length} {venues.length === 1 ? "venue" : "venues"}
            </p>
          )}
        </div>

        {error && (
          <p className="v-alert v-alert-error" role="alert">
            <IconAlert />
            <span>Could not load venues: {error}</span>
          </p>
        )}

        {isLoading && (
          <div className="v-venue-grid" aria-label="Loading venues...">
            {SKELETON_CARDS.map((key) => (
              <div key={key} className="v-card v-skeleton-card">
                <div className="v-skeleton" style={{ width: 46, height: 46 }} />
                <div className="v-skeleton" style={{ width: "70%", height: 18 }} />
                <div className="v-skeleton" style={{ width: "45%", height: 14 }} />
                <div className="v-skeleton" style={{ width: "90%", height: 28 }} />
              </div>
            ))}
          </div>
        )}

        {!isLoading && !error && venues.length === 0 && (
          <div className="v-card v-empty">
            <div className="v-empty-icon">
              <IconSearch size={22} />
            </div>
            <p className="v-empty-title">No venues match those filters.</p>
            <p>Try a different city or a lower minimum capacity.</p>
          </div>
        )}

        {!isLoading && venues.length > 0 && (
          <div className="v-venue-grid">
            {venues.map((venue) => (
              <VenueCard key={venue.id} venue={venue} onSelect={handleSelectVenue} />
            ))}
          </div>
        )}
      </>
    );
  }

  return <div className="venues">{view}</div>;
}

export default VenueCataloguePage;
