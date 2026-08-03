/**
 * Structured audit logging for authentication/session lifecycle events, per Constitution
 * Principle IV (Observability & Auditability): every entry MUST include enough context to
 * reconstruct an incident (timestamp, subject identifier, decision, reason) and MUST NOT
 * include raw tokens, secrets, or passwords.
 */

export type AuditEvent =
  | { type: "login_success"; sub: string; email: string }
  | { type: "login_failure"; reason: string }
  | { type: "refresh_success"; sub: string; email: string }
  | { type: "refresh_failure"; reason: string }
  | { type: "kratos_session_ended"; sub: string }
  | { type: "session_terminated"; reason: string; sub?: string };

export function logAuditEvent(event: AuditEvent): void {
  const entry = {
    timestamp: new Date().toISOString(),
    service: "hydra-kratos",
    ...event,
  };
  // Structured JSON to stdout — no raw tokens/secrets are ever included in AuditEvent's shape.
  console.log(JSON.stringify(entry));
}
