// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { AuthContext } from "../../auth/useAuth";
import EventResubmitControl from "./EventResubmitControl";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

test("[SCRUM-117-UI-R01] A conflict keeps the request available for retry and success reloads it", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce({ ok:false,status:409,json:async()=>({message:"Refresh and review saved details."}) })
    .mockResolvedValueOnce({ok:true,status:200,json:async()=>({event:{id:"event",status:"UNDER_REVIEW"}})});
  vi.stubGlobal("fetch",fetchMock);
  const reload=vi.fn(), user=userEvent.setup();
  render(<AuthContext.Provider value={{token:"owner-token"}}><EventResubmitControl eventId="event" cycleId="cycle" onResubmitted={reload}/></AuthContext.Provider>);
  await user.click(screen.getByRole("button",{name:"Resubmit request"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("Refresh and review saved details.");
  expect(reload).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button",{name:"Resubmit request"}));
  await waitFor(()=>expect(reload).toHaveBeenCalledOnce());
  expect(fetchMock.mock.calls[1][0]).toBe("/api/event-workspace/organiser/event/resubmit");
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({cycleId:"cycle"});
});

test("[SCRUM-117-UI-R02] Saved-detail validation errors explain what the organiser must correct", async () => {
  vi.stubGlobal("fetch",vi.fn(async()=>({ok:false,status:400,json:async()=>({errors:[{field:"start_time",message:"must be in the future"}]})})));
  const reload=vi.fn(), user=userEvent.setup();
  render(<AuthContext.Provider value={{token:"owner-token"}}><EventResubmitControl eventId="event" cycleId="cycle" onResubmitted={reload}/></AuthContext.Provider>);
  await user.click(screen.getByRole("button",{name:"Resubmit request"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("start time: must be in the future");
  expect(reload).not.toHaveBeenCalled();
});
