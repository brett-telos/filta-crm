// withSession wrapper for api-server route handlers.
// Delegates to @workspace/db's withSession so RLS SET LOCAL vars are
// set identically to the Next.js CRM app.

import { withSession as dbWithSession } from "@workspace/db";
import type { SessionClaims } from "./auth";

// Re-export the type alias so routes can import from one place.
export type { SessionClaims };

type DbSession = Parameters<typeof dbWithSession>[0];

function toDbSession(session: SessionClaims): DbSession {
  return {
    sub: session.sub,
    email: session.email,
    firstName: session.firstName,
    role: session.role,
    territory: session.territory,
  };
}

// Wraps fn in a pg transaction that SET LOCALs app.user_id / territory / role.
export async function withSession<T>(
  session: SessionClaims,
  fn: Parameters<typeof dbWithSession<T>>[1],
): Promise<T> {
  return dbWithSession(toDbSession(session), fn);
}
