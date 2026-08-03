"use client";

import { useEffect, useState } from "react";
import { postSessionEvent, SESSION_EVENT_COOKIE_NAME, subscribeToSessionEvents, type SessionBroadcastEvent } from "@/app/lib/broadcast";

const MESSAGES: Record<SessionBroadcastEvent, string> = {
  "session-created": "A session was created in another tab.",
  "session-invalidated": "Your session ended in another tab.",
};

function consumeLoginBroadcastCookie(): void {
  if (!document.cookie.includes(`${SESSION_EVENT_COOKIE_NAME}=created`)) {
    return;
  }
  document.cookie = `${SESSION_EVENT_COOKIE_NAME}=; path=/; max-age=0`;
  postSessionEvent("session-created");
}

export function SessionNotice() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    // The callback route (server-side) cannot call BroadcastChannel itself, so it leaves a
    // short-lived marker cookie that this tab — the one that just logged in — turns into a
    // real broadcast for every *other* open tab to pick up.
    consumeLoginBroadcastCookie();
    return subscribeToSessionEvents((event) => setMessage(MESSAGES[event]));
  }, []);

  if (!message) {
    return null;
  }

  return (
    <div role="status">
      <span>{message}</span>
      <button type="button" onClick={() => setMessage(null)}>
        Dismiss
      </button>
    </div>
  );
}
