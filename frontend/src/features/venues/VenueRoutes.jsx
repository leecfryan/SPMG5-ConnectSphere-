import { useEffect, useState } from "react";
import { Link, Route, Routes, useNavigate, useParams } from "react-router";
import { useAuth } from "../auth/useAuth";
import RequirePermission from "../../routes/RequirePermission";
import { fetchVenueById, updateVenue } from "../../lib/api";
import VenueCataloguePage from "./pages/VenueCataloguePage";
import VenueDetail from "./components/VenueDetail";
import VenueEditForm from "./components/VenueEditForm";
import VenueAvailabilityCalendar from "./components/VenueAvailabilityCalendar";
import VenueBookingRequestForm from "./components/VenueBookingRequestForm";
import VenueBookingRequestList from "./components/VenueBookingRequestList";
import "./venues.css";

function VenueRecordPage({ mode = "detail" }) {
  const { id } = useParams();
  const { token, hasPermission } = useAuth();
  const navigate = useNavigate();
  const [result, setResult] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const key = JSON.stringify([id, token]);

  useEffect(() => {
    let active = true;
    fetchVenueById(id, token)
      .then((venue) => { if (active) setResult({ key, venue }); })
      .catch((error) => { if (active) setResult({ key, error: error.message }); });
    return () => { active = false; };
  }, [id, token, key]);

  const detailPath = `/venues/${id}`;
  const availabilityPath = `${detailPath}/availability`;
  if (result?.key !== key) return <p role="status">Loading venue…</p>;
  if (result.error || !result.venue) return <>
    <p role="alert">{result.error || "Venue not found"}</p>
    <Link to="/venues">Back to venues</Link>
  </>;
  const venue = result.venue;

  async function save(changes) {
    setIsSaving(true);
    setSaveError(null);
    try {
      const updated = await updateVenue(id, changes, token);
      setResult({ key, venue: updated });
      navigate(detailPath);
    } catch (error) {
      setSaveError(error.message);
    } finally {
      setIsSaving(false);
    }
  }

  if (mode === "edit") return <VenueEditForm venue={venue} onSave={save}
    onCancel={() => navigate(detailPath)} isSaving={isSaving} saveError={saveError} />;
  if (mode === "availability") return <VenueAvailabilityCalendar venue={venue}
    onBack={() => navigate(detailPath)} onRequestBooking={hasPermission("bookings.request")
      ? () => navigate(`${detailPath}/booking-request`) : undefined} />;
  if (mode === "booking") return <VenueBookingRequestForm venue={venue}
    onDone={() => navigate(availabilityPath)} onCancel={() => navigate(availabilityPath)} />;
  return <VenueDetail venue={venue} onBack={() => navigate("/venues")}
    onEdit={hasPermission("venues.update") ? () => navigate(`${detailPath}/edit`) : undefined}
    onViewAvailability={() => navigate(availabilityPath)} />;
}

export default function VenueRoutes() {
  const navigate = useNavigate();
  return <div className="venues">
    <Routes>
      <Route index element={<VenueCataloguePage />} />
      <Route element={<RequirePermission permission="bookings.read" />}>
        <Route path="booking-requests" element={<VenueBookingRequestList onBack={() => navigate("/venues")} />} />
      </Route>
      <Route path=":id" element={<VenueRecordPage key="detail" />} />
      <Route path=":id/availability" element={<VenueRecordPage key="availability" mode="availability" />} />
      <Route element={<RequirePermission permission="venues.update" />}>
        <Route path=":id/edit" element={<VenueRecordPage key="edit" mode="edit" />} />
      </Route>
      <Route element={<RequirePermission permission="bookings.request" />}>
        <Route path=":id/booking-request" element={<VenueRecordPage key="booking" mode="booking" />} />
      </Route>
      <Route path="*" element={<><h1>Page not found</h1><Link to="/venues">Back to venues</Link></>} />
    </Routes>
  </div>;
}
