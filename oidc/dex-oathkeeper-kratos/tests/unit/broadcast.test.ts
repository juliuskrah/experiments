import { afterEach, describe, expect, it, vi } from "vitest";
import { postSessionEvent, subscribeToSessionEvents } from "@/app/lib/broadcast";

describe("postSessionEvent / subscribeToSessionEvents (BroadcastChannel)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("delivers a posted event to a subscriber via BroadcastChannel", async () => {
    const received: string[] = [];
    const unsubscribe = subscribeToSessionEvents((event) => received.push(event));

    postSessionEvent("session-created");

    await vi.waitFor(() => expect(received).toEqual(["session-created"]));
    unsubscribe();
  });

  it("delivers session-invalidated the same way", async () => {
    const received: string[] = [];
    const unsubscribe = subscribeToSessionEvents((event) => received.push(event));

    postSessionEvent("session-invalidated");

    await vi.waitFor(() => expect(received).toEqual(["session-invalidated"]));
    unsubscribe();
  });

  it("stops delivering events after unsubscribing", async () => {
    const received: string[] = [];
    const unsubscribe = subscribeToSessionEvents((event) => received.push(event));
    unsubscribe();

    postSessionEvent("session-created");

    // Give any (incorrectly) still-registered listener a chance to fire.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(received).toEqual([]);
  });
});

describe("postSessionEvent / subscribeToSessionEvents (localStorage fallback)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it("falls back to a storage event when BroadcastChannel is unavailable", () => {
    vi.stubGlobal("BroadcastChannel", undefined);

    const received: string[] = [];
    const unsubscribe = subscribeToSessionEvents((event) => received.push(event));

    postSessionEvent("session-created");

    // jsdom does not fire `storage` events for same-window writes, so dispatch it manually to
    // exercise the fallback listener the way a real second tab's browser would.
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "dex-oathkeeper-kratos:session-event",
        newValue: window.localStorage.getItem("dex-oathkeeper-kratos:session-event"),
      }),
    );

    expect(received).toEqual(["session-created"]);
    unsubscribe();
  });
});
