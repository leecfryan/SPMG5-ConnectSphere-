import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../../../lib/auth";
import { apiFetch } from "../../../lib/api";

export function useRegistrations() {
  const { token } = useAuth();
  const [registrations, setRegistrations] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (signal) => {
      setLoading(true);
      setError("");
      try {
        const data = await apiFetch("/api/registrations/me", token, { signal });
        if (!signal?.aborted) setRegistrations(data.registrations);
      } catch (err) {
        if (err.name !== "AbortError" && !signal?.aborted) setError(err.message);
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [token]
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  function reload() {
    const controller = new AbortController();
    load(controller.signal);
  }

  return { registrations, error, loading, reload };
}
