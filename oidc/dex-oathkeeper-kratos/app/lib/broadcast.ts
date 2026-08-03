const CHANNEL_NAME = "dex-oathkeeper-kratos:session";
const STORAGE_KEY = "dex-oathkeeper-kratos:session-event";

/**
 * Non-httpOnly, short-lived cookie set by the callback route so the browser-only
 * BroadcastChannel API can be triggered from client code after a server-side redirect
 * (`app/api/auth/callback/route.ts` cannot call BroadcastChannel itself).
 */
export const SESSION_EVENT_COOKIE_NAME = "session_event";

export type SessionBroadcastEvent = "session-created" | "session-invalidated";

type Listener = (event: SessionBroadcastEvent) => void;

/**
 * Notifies other same-origin tabs of session lifecycle changes. Prefers BroadcastChannel; falls
 * back to a `storage` event (writing a throwaway key) for engines without it, per research.md §6.
 */
export function postSessionEvent(event: SessionBroadcastEvent): void {
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage(event);
    channel.close();
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ event, timestamp: Date.now() }));
}

/** Subscribes to session lifecycle events posted by other tabs. Returns an unsubscribe function. */
export function subscribeToSessionEvents(listener: Listener): () => void {
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    const handler = (message: MessageEvent<SessionBroadcastEvent>) => listener(message.data);
    channel.addEventListener("message", handler);
    return () => {
      channel.removeEventListener("message", handler);
      channel.close();
    };
  }

  const handler = (storageEvent: StorageEvent) => {
    if (storageEvent.key !== STORAGE_KEY || !storageEvent.newValue) {
      return;
    }
    const { event } = JSON.parse(storageEvent.newValue) as { event: SessionBroadcastEvent };
    listener(event);
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}
