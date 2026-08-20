---
name: Filta CRM runtime
description: Why the migrated Filta CRM runs its original Next App Router application inside its web artifact.
---

Filta CRM must retain its Next App Router runtime when it is moved into the workspace. Its page flows depend on server actions, route handlers, middleware, server-side session handling, PDFs, and database access that are not Vite SPA features.

**Why:** Rebuilding the application as a client-only Vite app would require replacing its server-driven behavior across many routes and would risk regressions in authentication, permissions, document generation, and CRM mutations.

**How to apply:** Keep CRM-specific `/api/*` routes owned by the Filta web runtime. Avoid assigning a broad `/api` proxy path to a separate service unless its routes have first been migrated and verified.