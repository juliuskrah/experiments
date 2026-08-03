import { NextResponse } from "next/server";
import { logAuditEvent } from "@/app/lib/audit-log";
import { SESSION_COOKIE_NAME } from "@/app/lib/session";

export async function POST() {
  logAuditEvent({ type: "session_terminated", reason: "logout" });
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE_NAME);
  return response;
}
