// POST /api/auth/login
// Verifies email/password against the users table, returns a 7-day JWT.

import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, users } from "@workspace/db";
import { LoginBody, LoginResponse } from "@workspace/api-zod";
import { signToken, verifyPassword } from "../lib/auth";

const router: IRouter = Router();

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { email, password } = parsed.data;

  // Look up active user by email.
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      firstName: users.firstName,
      role: users.role,
      territory: users.territory,
      passwordHash: users.passwordHash,
      active: users.active,
    })
    .from(users)
    .where(eq(users.email, email.toLowerCase().trim()))
    .limit(1);

  if (!user || !user.active) {
    req.log.warn({ email }, "Login failed: user not found or inactive");
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    req.log.warn({ email }, "Login failed: bad password");
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const token = await signToken({
    sub: user.id,
    email: user.email,
    firstName: user.firstName,
    role: user.role,
    territory: user.territory,
  });

  // Update last_login_at in background (don't await to avoid delaying response).
  db.update(users)
    .set({ lastLoginAt: new Date() })
    .where(eq(users.id, user.id))
    .catch((err: unknown) => req.log.error({ err }, "Failed to update lastLoginAt"));

  req.log.info({ userId: user.id, email: user.email }, "Login successful");

  res.json(
    LoginResponse.parse({
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        role: user.role,
        territory: user.territory,
      },
    }),
  );
});

export default router;
