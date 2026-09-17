import { useState, useEffect } from "react";
import { fetchVenues, fetchVenueById, updateVenue } from "../../../lib/api";
import VenueCard from "../components/VenueCard";
import VenueDetail from "../components/VenueDetail";
import VenueEditForm from "../components/VenueEditForm";
import VenueAvailabilityCalendar from "../components/VenueAvailabilityCalendar";
import VenueBookingRequestForm from "../components/VenueBookingRequestForm";
import VenueBookingRequestList from "../components/VenueBookingRequestList";

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

  // SCRUM-88: the Venue Staff review queue is not tied to one venue, so it is
  // checked before anything that needs a selected venue.
  if (isReviewingRequests) {
    return (
      <VenueBookingRequestList onBack={() => setIsReviewingRequests(false)} />
    );
  }

  // SCRUM-21: opened from the calendar, and both ways out return to it. The
  // calendar refetches when it mounts, so a new request shows as Requested.
  if (selectedVenue && isViewingAvailability && isRequestingBooking) {
    return (
      <VenueBookingRequestForm
        venue={selectedVenue}
        onDone={() => setIsRequestingBooking(false)}
        onCancel={() => setIsRequestingBooking(false)}
      />
    );
  }

  // SCRUM-17: availability is its own view, same state-driven switch as the
  // edit form. Still no router installed.
  if (selectedVenue && isViewingAvailability) {
    return (
      <VenueAvailabilityCalendar
        venue={selectedVenue}
        onBack={() => setIsViewingAvailability(false)}
        onRequestBooking={() => setIsRequestingBooking(true)}
      />
    );
  }

  if (selectedVenue && isEditing) {
    return (
      <VenueEditForm
        venue={selectedVenue}
        onSave={handleSave}
        onCancel={() => { setIsEditing(false); setSaveError(null); }}
        isSaving={isSaving}
        saveError={saveError}
      />
    );
  }

  if (selectedVenue) {
    return (
      <VenueDetail
        venue={selectedVenue}
        onBack={() => setSelectedVenue(null)}
        onEdit={() => setIsEditing(true)}
        onViewAvailability={() => setIsViewingAvailability(true)}
      />
    );
  }

  return (
    <div className="venue-catalogue">
      <h2>Venue catalogue</h2>

      {/* SCRUM-88: entry point for Venue Staff until there is real navigation */}
      <button type="button" onClick={() => setIsReviewingRequests(true)}>
        Review booking requests (Venue Staff)
      </button>

      <div className="venue-filters">
        <label>
          City
          <input
            type="text"
            value={cityFilter}
            onChange={(e) => setCityFilter(e.target.value)}
            placeholder="e.g. Singapore"
          />
        </label>

        <label>
          Minimum capacity
          <input
            type="number" min="0"
            value={minCapacityFilter}
            onChange={(e) => setMinCapacityFilter(e.target.value)}
            placeholder="e.g. 100"
          />
        </label>
      </div>

      {isLoading && <p>Loading venues...</p>}
      {error && <p className="venue-error">Could not load venues: {error}</p>}

      {!isLoading && !error && venues.length === 0 && (
        <p>No venues match those filters.</p>
      )}

      <div className="venue-list">
        {venues.map((venue) => (
          <VenueCard key={venue.id} venue={venue} onSelect={handleSelectVenue} />
        ))}
      </div>
    </div>
  );
}

export default VenueCataloguePage;