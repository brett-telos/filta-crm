# Digest emails — scheduled sends setup

The CRM produces two automated emails for admin users (anyone with
`role = 'admin'` in the `users` table):

- **Daily morning brief** — overnight replies, quotes accepted, agreements signed, overdue tasks. Runs every weekday morning.
- **Weekly Monday digest** — last 7 days of activity plus an MRR snapshot. Runs Monday morning.

Both are delivered by `POST /api/digests/run?type=daily|weekly`. The
endpoint is authenticated and works for two callers:

1. **External schedulers** that present `Authorization: Bearer <DIGEST_SECRET>` (Replit Scheduled Deployments, cron-job.org, GitHub Actions, etc.)
2. **Admin users on the dashboard** — there's a "Send digest now" button next to the header for ad-hoc / test sends. Uses the session cookie, no secret needed.

## One-time setup

### 1. Generate a secret

```bash
openssl rand -hex 32
# example output: 8f3c9a2b1d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0
```

### 2. Set it in Replit Secrets

Replit → your Repl → padlock icon (Secrets) → "New Secret":

- Key: `DIGEST_SECRET`
- Value: the hex string from step 1

### 3. Verify the endpoint works

In Replit's Shell:

```bash
curl -X POST \
  -H "Authorization: Bearer $DIGEST_SECRET" \
  https://<your-replit-url>/api/digests/run?type=daily
```

You should get a JSON response like:

```json
{
  "ok": true,
  "type": "daily",
  "sent": 1,
  "failed": 0,
  "counters": { "...": "..." }
}
```

If `RESEND_API_KEY` isn't set, sends are stubbed (you'll see `devStub: true` per result) — the digest computes and renders, you just don't get a real email. Drop a real `RESEND_API_KEY` into Secrets when you're ready for real delivery.

## Scheduling — option A: Replit Scheduled Deployments (recommended)

Available on paid Replit plans.

1. Open your Repl → Deploy → Scheduled
2. Add a deployment with this shell command:

   ```bash
   curl -fsS -X POST \
     -H "Authorization: Bearer $DIGEST_SECRET" \
     "$PUBLIC_APP_URL/api/digests/run?type=daily"
   ```

3. Schedule: `0 12 * * 1-5` (UTC) — that's 7am Eastern weekday mornings.
4. Add a second scheduled deployment for the weekly digest:

   ```bash
   curl -fsS -X POST \
     -H "Authorization: Bearer $DIGEST_SECRET" \
     "$PUBLIC_APP_URL/api/digests/run?type=weekly"
   ```

   Schedule: `0 13 * * 1` (UTC) — 8am Eastern Mondays.

The scheduled deployment inherits Repl Secrets, so `DIGEST_SECRET` and `PUBLIC_APP_URL` Just Work.

## Scheduling — option B: cron-job.org (free, no Replit plan needed)

1. Sign up at https://cron-job.org
2. Create two cron jobs:
   - **Daily**: `https://<your-replit-url>/api/digests/run?type=daily` · Method: POST · Header: `Authorization: Bearer <DIGEST_SECRET>` · Schedule: `0 12 * * 1-5`
   - **Weekly**: `https://<your-replit-url>/api/digests/run?type=weekly` · Method: POST · Header: `Authorization: Bearer <DIGEST_SECRET>` · Schedule: `0 13 * * 1`

cron-job.org will email you on failure, which is useful for catching stale tokens or Replit downtime.

## Scheduling — option C: GitHub Actions (free, in the same repo)

`.github/workflows/digests.yml`:

```yaml
name: Digests
on:
  schedule:
    - cron: "0 12 * * 1-5"   # daily, 7am ET
    - cron: "0 13 * * 1"      # weekly, 8am ET Monday
  workflow_dispatch:
    inputs:
      type:
        type: choice
        options: [daily, weekly]
jobs:
  send:
    runs-on: ubuntu-latest
    steps:
      - name: Send digest
        env:
          DIGEST_SECRET: ${{ secrets.DIGEST_SECRET }}
          APP_URL: ${{ secrets.PUBLIC_APP_URL }}
        run: |
          TYPE="${{ github.event.inputs.type }}"
          if [ -z "$TYPE" ]; then
            # cron path — pick by current cron line
            HOUR=$(date -u +%H)
            DOW=$(date -u +%u)
            if [ "$DOW" = "1" ] && [ "$HOUR" = "13" ]; then
              TYPE=weekly
            else
              TYPE=daily
            fi
          fi
          curl -fsS -X POST \
            -H "Authorization: Bearer $DIGEST_SECRET" \
            "$APP_URL/api/digests/run?type=$TYPE"
```

Add the secrets in GitHub → Settings → Secrets → Actions:
- `DIGEST_SECRET`
- `PUBLIC_APP_URL`

## Troubleshooting

- **401 Unauthorized**: secret mismatch. Re-copy from Replit Secrets, paste into the scheduler.
- **404 Not Found**: Replit URL changed (it does on plan changes / regional moves). Update the scheduler.
- **`devStub: true` on every send**: `RESEND_API_KEY` isn't set; see `.env.example`.
- **Empty digest sent on a holiday**: expected. The digest still goes out with low counters; we keep the send rather than skip so admins know the system's alive.

## Tuning recipients

Right now the digest goes to every user with `role = 'admin'`. To change that without a code edit, add a non-admin role to a user, OR add a feature flag column on `users` (e.g., `receive_digests`) and update the recipient query in `src/app/api/digests/run/route.ts`.
