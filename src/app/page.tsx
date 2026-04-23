import { db, accounts, opportunities } from "@/db";
import { sql, eq, and, isNotNull } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function Home() {
  // Pull quick counts so Brett can verify the import worked
  const [accountCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(accounts);
  const [customerCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(accounts)
    .where(eq(accounts.accountStatus, "customer"));
  const [funCoastCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(accounts)
    .where(eq(accounts.territory, "fun_coast"));
  const [spaceCoastCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(accounts)
    .where(eq(accounts.territory, "space_coast"));
  const [oppCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(opportunities);

  return (
    <main className="min-h-screen p-8 bg-filta-muted">
      <div className="max-w-6xl mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-filta-primary">Filta CRM</h1>
          <p className="text-gray-600 mt-1">
            Fun Coast (Volusia) & Space Coast (Brevard)
          </p>
        </header>

        <section className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
          <Stat label="Total accounts" value={accountCount.count} />
          <Stat label="Customers" value={customerCount.count} />
          <Stat label="Fun Coast" value={funCoastCount.count} />
          <Stat label="Space Coast" value={spaceCoastCount.count} />
          <Stat label="Opportunities" value={oppCount.count} />
        </section>

        <section className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-2">Build status</h2>
          <p className="text-gray-600">
            Week 1 scaffold is live. Next: Account detail pages, pipeline board,
            FiltaClean Cross-Sell Dashboard.
          </p>
        </section>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="text-sm text-gray-500">{label}</div>
      <div className="text-2xl font-bold text-filta-primary mt-1">
        {value.toLocaleString()}
      </div>
    </div>
  );
}
