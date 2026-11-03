import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const RETRY_DELAYS = [0, 250, 500, 1000];

function parseTime(value) {
  if (value == null) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

function countdownParts(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return {
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  };
}

export function formatRegistrationTime(value) {
  const date = new Date(value);
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

export function useRegistrationWindow(event, serverTime, serverTimeReceivedAt, refreshServerTime) {
  const start = parseTime(event?.registration_start);
  const end = parseTime(event?.registration_end);
  const hasWindow = event?.registration_start != null || event?.registration_end != null;
  const receivedClock = useMemo(() => {
    const serverMilliseconds = parseTime(serverTime);
    return serverMilliseconds === null || serverTimeReceivedAt === undefined
      ? null
      : { serverTime, serverMilliseconds, receivedAt: serverTimeReceivedAt };
  }, [serverTime, serverTimeReceivedAt]);
  const [refreshedClock, setRefreshedClock] = useState(null);
  const clock = refreshedClock &&
    (!receivedClock || refreshedClock.serverMilliseconds >= receivedClock.serverMilliseconds)
    ? refreshedClock
    : receivedClock;
  const [now, setNow] = useState(() => Date.now());
  const [checkFailed, setCheckFailed] = useState(false);
  const [rechecking, setRechecking] = useState(false);
  const [retryVersion, setRetryVersion] = useState(0);
  const attemptedStart = useRef(null);
  const attemptActive = useRef(false);
  const timeoutRef = useRef(null);

  useEffect(() => {
    if (!hasWindow) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [hasWindow]);

  const estimatedServerNow = clock
    ? clock.serverMilliseconds + now - clock.receivedAt
    : null;
  let status = "open";
  if (hasWindow && !clock) {
    status = "checking";
  } else if (end !== null && estimatedServerNow > end) {
    status = "closed";
  } else if (start !== null &&
      (clock.serverMilliseconds < start || estimatedServerNow < start)) {
    status = rechecking || estimatedServerNow >= start ? "checking" : "not-open";
  }
  const shouldRecheck = hasWindow && (!clock ||
    (start !== null && clock.serverMilliseconds < start && estimatedServerNow >= start));

  const retry = useCallback(() => {
    attemptedStart.current = null;
    setCheckFailed(false);
    setRetryVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    if (status === "not-open") {
      return undefined;
    }
    if (!shouldRecheck || !refreshServerTime || attemptActive.current) {
      return undefined;
    }
    const attemptKey = start ?? "server-time";
    if (attemptedStart.current === attemptKey) return undefined;
    attemptedStart.current = attemptKey;
    attemptActive.current = true;
    let active = true;

    async function confirmWithServer() {
      setCheckFailed(false);
      setRechecking(true);
      let confirmed = false;
      let latestClock = null;
      for (let attempt = 0; attempt < RETRY_DELAYS.length; attempt += 1) {
        if (RETRY_DELAYS[attempt]) {
          await new Promise((resolve) => {
            timeoutRef.current = setTimeout(resolve, RETRY_DELAYS[attempt]);
          });
        }
        if (!active) return;
        try {
          const response = await refreshServerTime();
          const serverMilliseconds = parseTime(response?.server_time);
          if (serverMilliseconds === null) continue;
          latestClock = {
            serverTime: response.server_time,
            serverMilliseconds,
            receivedAt: Date.now(),
          };
          if (start === null || serverMilliseconds >= start) {
            setRefreshedClock(latestClock);
            confirmed = true;
            break;
          }
        } catch {
          // The disabled state remains in place until a later server response
          // confirms that registration has opened.
        }
      }
      if (active) {
        if (!confirmed && latestClock) setRefreshedClock(latestClock);
        setRechecking(false);
        if (!confirmed) setCheckFailed(true);
      }
      attemptActive.current = false;
    }

    void confirmWithServer();
    return () => {
      active = false;
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
      attemptActive.current = false;
    };
  }, [status, shouldRecheck, start, refreshServerTime, retryVersion]);

  useEffect(() => () => {
    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
  }, []);

  const remaining = start === null || estimatedServerNow === null
    ? null
    : countdownParts(start - estimatedServerNow);

  return {
    status,
    remaining,
    checkFailed,
    retry,
    hasWindow,
  };
}

export function formatRegistrationCountdown(remaining) {
  if (!remaining) return "";
  return `${remaining.days} days, ${remaining.hours} hours, ${remaining.minutes} minutes, ${remaining.seconds} seconds`;
}
