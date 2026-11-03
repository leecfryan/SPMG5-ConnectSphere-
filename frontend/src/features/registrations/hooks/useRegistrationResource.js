import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { apiFetch } from "../../../lib/api";

// A route or session change immediately hides the previous resource.
export function useRegistrationResource(path) {
  const { token } = useAuth();
  const [result, setResult] = useState(null);
  const [revision, setRevision] = useState(0);
  const key = JSON.stringify([path, token, revision]);
  const current = result?.key === key;
  const refresh = useCallback(async () => {
    const data = await apiFetch(path, token);
    const receivedAt = Date.now();
    setResult((previous) => previous?.key === key ? { key, data, receivedAt } : previous);
    return data;
  }, [path, token, key]);
  useEffect(() => {
    const controller = new AbortController();
    apiFetch(path, token, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setResult({ key, data, receivedAt: Date.now() });
      })
      .catch((error) => {
        if (!controller.signal.aborted && error?.name !== "AbortError") {
          setResult({ key, error: error.message });
        }
      });
    return () => controller.abort();
  }, [path, token, key]);
  return {
    data: current ? result.data : undefined,
    receivedAt: current ? result.receivedAt : undefined,
    error: current ? result.error : undefined,
    loading: !current,
    reload: () => setRevision((value) => value + 1),
    refresh,
    setData: (data) => setResult((previous) => previous?.key === key ? { key, data } : previous),
  };
}
