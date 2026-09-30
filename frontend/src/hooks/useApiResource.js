import { useEffect, useState } from "react";
import { useAuth } from "../features/auth/useAuth";
import { apiFetch } from "../lib/api";

// Hide stale records immediately when the URL, account or refresh revision changes.
export function useApiResource(path) {
  const { token } = useAuth();
  const [result, setResult] = useState(null);
  const [revision, setRevision] = useState(0);
  const key = JSON.stringify([path, token, revision]);
  const current = result?.key === key;
  useEffect(() => {
    const controller = new AbortController();
    apiFetch(path, token, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setResult({ key, data }); })
      .catch(error => { if (!controller.signal.aborted) setResult({ key, error: error.message }); });
    return () => controller.abort();
  }, [path, token, key]);
  return {
    data: current ? result.data : undefined,
    error: current ? result.error : undefined,
    loading: !current,
    reload: () => setRevision(value => value + 1),
    setData: data => setResult(previous => previous?.key === key ? { key, data } : previous),
  };
}
