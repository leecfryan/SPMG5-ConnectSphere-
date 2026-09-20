import { useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { apiFetch } from "../../../lib/api";

export function useEventRegistration() {
  const { token } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function register(eventId, registrationData) {
    setBusy(true);
    setError("");
    try {
      const data = await apiFetch("/api/registrations", token, {
        method: "POST",
        body: { eventId, registrationData },
      });
      return data.registration;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(registrationId) {
    setBusy(true);
    setError("");
    try {
      const data = await apiFetch(`/api/registrations/${registrationId}/withdraw`, token, {
        method: "PATCH",
      });
      return data.registration;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  return { register, withdraw, busy, error, clearError: () => setError("") };
}
