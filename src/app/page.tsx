import { redirect } from "next/navigation";

// Root just sends the user to the dashboard. Middleware will bounce them to
// /login if they're not authed before this ever runs.
export default function Root() {
  redirect("/dashboard");
}
