"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { postSessionEvent } from "@/app/lib/broadcast";

interface SessionResponse {
  authenticated: boolean;
  displayName?: string | null;
  email?: string;
}

export default function WelcomePage() {
  const router = useRouter();
  const [session, setSession] = useState<SessionResponse | null>(null);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((res) => res.json())
      .then((data: SessionResponse) => setSession(data));
  }, []);

  useEffect(() => {
    // Covers both an explicit logout and a failed refresh_token grant (FR-007): the
    // middleware's optimistic cookie check lets an access-token-expired session cookie through,
    // so this client-side redirect is what actually enforces "no stuck state" once
    // GET /api/auth/session reports the session is no longer valid.
    if (session && !session.authenticated) {
      router.replace("/login");
    }
  }, [session, router]);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    postSessionEvent("session-invalidated");
    setSession({ authenticated: false });
  }

  if (!session || !session.authenticated) {
    return null;
  }

  return (
    <main>
      <h1>Hello, {session.displayName ?? session.email}</h1>
      <button type="button" onClick={handleLogout}>
        Log out
      </button>
    </main>
  );
}
