import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));

beforeEach(() => vi.resetModules());
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });

const publicConfig = { supabaseUrl: "https://test-project.supabase.co", publishableKey: "test-public-key" };
const reply = (status, body) => ({ ok: status === 200, json: async () => body });

test("[AUTH-CONFIG-001] Create the browser client from public configuration with session persistence and refresh", async () => {
  const fetchMock = vi.fn().mockResolvedValue(reply(200, publicConfig));
  vi.stubGlobal("fetch", fetchMock);
  const client = { auth: {} };
  createClient.mockReturnValue(client);
  const { getAuthClient } = await import("./supabase");
  expect(await getAuthClient()).toBe(client);
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/auth/config", { cache: "no-store" });
  expect(createClient).toHaveBeenCalledExactlyOnceWith(publicConfig.supabaseUrl, publicConfig.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
});

test("[AUTH-CONFIG-002] Concurrent initialization reuses one client and one configuration request", async () => {
  const fetchMock = vi.fn().mockResolvedValue(reply(200, publicConfig));
  vi.stubGlobal("fetch", fetchMock);
  createClient.mockReturnValue({ auth: {} });
  const { getAuthClient } = await import("./supabase");
  const [first, second] = await Promise.all([getAuthClient(), getAuthClient()]);
  expect(first).toBe(second);
  expect(createClient).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test.each([
  ["AUTH-CONFIG-003", "missing URL", { publishableKey: "test-public-key" }],
  ["AUTH-CONFIG-004", "missing public key", { supabaseUrl: publicConfig.supabaseUrl }],
])("[%s] Configuration with %s does not create a client", async (_id, _title, config) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(200, config)));
  const { getAuthClient } = await import("./supabase");
  await expect(getAuthClient()).rejects.toThrow("Sign-in is not configured yet.");
  expect(createClient).not.toHaveBeenCalled();
});

test("[AUTH-CONFIG-005] A failed configuration request can be retried successfully", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(reply(503, {})).mockResolvedValueOnce(reply(200, publicConfig));
  vi.stubGlobal("fetch", fetchMock);
  const client = { auth: {} };
  createClient.mockReturnValue(client);
  const { getAuthClient } = await import("./supabase");
  await expect(getAuthClient()).rejects.toThrow("Sign-in is temporarily unavailable.");
  expect(createClient).not.toHaveBeenCalled();
  expect(await getAuthClient()).toBe(client);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
