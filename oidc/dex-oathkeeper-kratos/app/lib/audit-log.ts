/**
 * Structured audit logging for authentication/session lifecycle events, per Constitution
 * Principle IV (Observability & Auditability): every entry MUST include enough context to
 * reconstruct an incident (timestamp, subject identifier, decision, reason) and MUST NOT
 * include raw tokens, secrets, or passwords.
 */

export type AuditEvent =
  | { type: "login_success"; sub: string; email: string }
  | { type: "login_failure"; reason: string }
  | { type: "reauthorization_success"; sub: string; email: string }
  | { type: "reauthorization_failure"; reason: string }
  | { type: "session_terminated"; reason: string; sub?: string };

export function logAuditEvent(event: AuditEvent): void {
  const entry = {
    timestamp: new Date().toISOString(),
    service: "dex-oathkeeper-kratos",
    ...event,
  };
  // Structured JSON to stdout — no raw tokens/secrets are ever included in AuditEvent's shape.
  console.log(JSON.stringify(entry));
}
