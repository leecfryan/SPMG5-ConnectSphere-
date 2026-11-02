import { afterEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const requestLiveJson = require("../helpers/requestLiveJson");

afterEach(() => vi.unstubAllGlobals());

test.each([
  { id: "01", label: "anonymous GET", token: null, options: undefined, headers: {} },
  { id: "02", label: "empty request body", token: "test-token", options: { method: "POST", body: "" }, headers: { Authorization: "Bearer test-token" } },
  { id: "03", label: "JSON request body", token: "test-token", options: { method: "POST", body: "{}" }, headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" } },
])("[SCRUM-168-HTTP-$id] $label preserves request options and parsed response", async ({ token, options, headers }) => {
  const payload = { entry: { id: "entry-1" } };
  const fetch = vi.fn().mockResolvedValue({ status: 200, json: async () => payload });
  vi.stubGlobal("fetch", fetch);

  const result = await requestLiveJson("http://127.0.0.1:3000", token, "/api/waitlist/event-1", options);

  expect(fetch).toHaveBeenCalledExactlyOnceWith("http://127.0.0.1:3000/api/waitlist/event-1", { ...options, headers });
  expect(result).toEqual({ status: 200, body: payload });
});

test("[SCRUM-168-HTTP-04] explicit headers override defaults and other fetch options survive", async () => {
  const fetch = vi.fn().mockResolvedValue({ status: 403, json: async () => ({ message: "Denied" }) });
  vi.stubGlobal("fetch", fetch);
  const options = {
    method: "PATCH", body: "{}", cache: "no-store",
    headers: { Authorization: "Bearer deliberately-invalid", "Content-Type": "application/custom", "X-Test": "original" },
  };

  const result = await requestLiveJson("http://127.0.0.1:3000", "original-token", "/api/test", options);

  expect(fetch).toHaveBeenCalledExactlyOnceWith("http://127.0.0.1:3000/api/test", options);
  expect(result).toEqual({ status: 403, body: { message: "Denied" } });
});

test("[SCRUM-168-HTTP-05] a 204 response returns null without parsing JSON", async () => {
  const json = vi.fn();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 204, json }));

  expect(await requestLiveJson("http://127.0.0.1:3000", null, "/api/test", { method: "DELETE" }))
    .toEqual({ status: 204, body: null });
  expect(json).not.toHaveBeenCalled();
});

test("[SCRUM-168-HTTP-06] network errors reach the calling test unchanged", async () => {
  const error = new Error("Network unavailable");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));

  await expect(requestLiveJson("http://127.0.0.1:3000", null, "/api/test")).rejects.toBe(error);
});

test("[SCRUM-168-HTTP-07] invalid JSON errors reach the calling test unchanged", async () => {
  const error = new SyntaxError("Invalid JSON");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200, json: async () => { throw error; } }));

  await expect(requestLiveJson("http://127.0.0.1:3000", null, "/api/test")).rejects.toBe(error);
});
