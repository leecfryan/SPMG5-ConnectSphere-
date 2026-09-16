import { useState, useEffect } from "react";
import { useAuth } from "../../../lib/auth";
import { apiFetch } from "../../../lib/api";

export function useRegistrations() {
  const { token } = useAuth();
  const [registrations, setRegistrations] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    apiFetch("/api/registrations/me", token, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) {
          setRegistrations(data.registrations);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (err.name !== "AbortError" && !controller.signal.aborted) {
          setError(err.message);
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [token, refreshKey]);

  function reload() {
    setLoading(true);
    setError("");
    setRefreshKey((k) => k + 1);
  }

  return { registrations, error, loading, reload };
}
