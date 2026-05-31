# MVP Cloud Sync — Web Portal Plan

**Repo:** `phoenix-portal`
**Current State:** Code-complete, never publicly deployed
**Stack:** React 19 + Vite 7 + Supabase + shadcn/ui + Tailwind v4
**Supabase Project:** `ilzlswmatadlnsuxatcv`

---

## Table of Contents

1. [Hard Blockers (Fix Before Anything Else)](#1-hard-blockers)
2. [Supabase Environment Setup](#2-supabase-environment-setup)
3. [Vercel Deployment](#3-vercel-deployment)
4. [RevenueCat Webhook Setup](#4-revenuecat-webhook-setup)
5. [Third-Party Integration Setup](#5-third-party-integration-setup)
   - [5.1 Strava](#51-strava)
   - [5.2 Fitbit](#52-fitbit)
   - [5.3 Garmin](#53-garmin)
   - [5.4 Hevy](#54-hevy)
6. [Sentry Error Monitoring (Optional)](#6-sentry-error-monitoring-optional)
7. [Code Fixes](#7-code-fixes)
8. [CI/CD Pipeline](#8-cicd-pipeline)
9. [DNS & Domain Setup](#9-dns--domain-setup)
10. [Pre-Launch Testing](#10-pre-launch-testing)
11. [Post-Launch Monitoring](#11-post-launch-monitoring)

---

## 1. Hard Blockers

These must be fixed before deploying Supabase Edge Functions or the portal frontend.

### 1.1 Remove Orphaned Stripe Function Reference

**File:** `supabase/config.toml`

**Problem:** The config declares `[functions.stripe-webhooks]` but this Edge Function doesn't exist — it was removed during the RevenueCat migration (migration `20260303`). Supabase will fail to deploy functions if a declared function has no code.

**Fix:** Replace the entire file contents with:

```toml
[functions.revenuecat-webhooks]
verify_jwt = false
```

**Why `verify_jwt = false`:** RevenueCat sends a bearer token in the `Authorization` header, not a Supabase JWT. If JWT verification is enabled at the gateway level, the webhook will be rejected with 401 before your code even runs.

### 1.2 Parameterize Type Generation Script

**File:** `package.json` line 19

**Problem:** The `gen:types` script hardcodes `--project-id ilzlswmatadlnsuxatcv`. This is fine if you use one Supabase project for both dev and prod, but will break if you ever separate environments.

**Fix (optional, not blocking):**
```json
"gen:types": "npx supabase gen types typescript --project-id ${SUPABASE_PROJECT_ID:-ilzlswmatadlnsuxatcv} --schema public > src/types/database.ts"
```

---

## 2. Supabase Environment Setup

### 2.1 Supabase CLI Installation

```bash
# Install Supabase CLI (if not already)
npm install -g supabase

# Login to Supabase
supabase login
# Opens browser for authentication

# Link to your project
supabase link --project-ref ilzlswmatadlnsuxatcv
```

### 2.2 Required Supabase Secrets

These are server-side secrets accessible only to Edge Functions (not exposed to the browser):

```bash
# Core (required for portal to function)
supabase secrets set APP_URL "https://your-production-domain.com"
supabase secrets set ENVIRONMENT "production"

# RevenueCat (required for billing — see Section 4)
supabase secrets set REVENUECAT_WEBHOOK_SECRET "your-webhook-secret"

# Strava (optional — see Section 5.1)
supabase secrets set STRAVA_CLIENT_ID "your-strava-client-id"
supabase secrets set STRAVA_CLIENT_SECRET "your-strava-client-secret"

# Fitbit (optional — see Section 5.2)
supabase secrets set FITBIT_CLIENT_ID "your-fitbit-client-id"
supabase secrets set FITBIT_CLIENT_SECRET "your-fitbit-client-secret"

# Garmin (optional — see Section 5.3)
supabase secrets set GARMIN_CONSUMER_KEY "your-garmin-consumer-key"
supabase secrets set GARMIN_CONSUMER_SECRET "your-garmin-consumer-secret"
```

**Verify secrets are set:**
```bash
supabase secrets list
```

**Auto-injected by Supabase (do NOT set manually):**
- `SUPABASE_URL` — your project URL
- `SUPABASE_ANON_KEY` — public anon key
- `SUPABASE_SERVICE_ROLE_KEY` — admin key (used by Edge Functions for RLS bypass)

### 2.3 Deploy Edge Functions

```bash
cd C:/Users/dasbl/AndroidStudioProjects/phoenix-portal

# Deploy all functions at once
supabase functions deploy

# Or deploy individually (useful for testing)
supabase functions deploy mobile-sync-push
supabase functions deploy mobile-sync-pull
supabase functions deploy initiate-oauth
supabase functions deploy strava-oauth
supabase functions deploy strava-sync
supabase functions deploy fitbit-oauth
supabase functions deploy fitbit-sync
supabase functions deploy garmin-oauth
supabase functions deploy garmin-webhook
supabase functions deploy hevy-sync
supabase functions deploy process-sync-queue
supabase functions deploy revenuecat-webhooks
supabase functions deploy disconnect-integration
supabase functions deploy delete-account
```

**Verify deployment:**
```bash
supabase functions list
```

### 2.4 CORS Configuration

CORS is handled dynamically in `supabase/functions/_shared/cors.ts`:

```
Production: Only APP_URL is allowed
Non-production: APP_URL + localhost:5173 + localhost:3000
```

**Critical:** If `APP_URL` doesn't match your actual portal domain, all Edge Function calls from the browser will fail with CORS errors. The `ENVIRONMENT` secret must be set to `"production"` to disable localhost origins.

**OAuth callbacks also use `APP_URL`:** After successful OAuth with Strava/Fitbit/Garmin, users are redirected to `{APP_URL}/integrations?connected={provider}`. If `APP_URL` is wrong, OAuth will complete but the user lands on the wrong URL.

---

## 3. Vercel Deployment

### 3.1 Connect Repository

1. Go to https://vercel.com/dashboard
2. Click **Add New → Project**
3. Import the `phoenix-portal` GitHub repository
4. **Framework Preset:** Vite (auto-detected)
5. **Build Command:** `npm run build` (auto-detected)
6. **Output Directory:** `dist` (auto-detected)
7. **Node.js Version:** 22.x (match CI)

### 3.2 Environment Variables

Set these in Vercel Dashboard → Project → Settings → Environment Variables:

| Variable                 | Value                                            | Environment                      |
| ------------------------ | ------------------------------------------------ | -------------------------------- |
| `VITE_SUPABASE_URL`      | `https://ilzlswmatadlnsuxatcv.supabase.co`       | Production, Preview, Development |
| `VITE_SUPABASE_ANON_KEY` | `sb_publishable_UDrjasV6UJLm_IdIzGljoQ_YaRes4dQ` | Production, Preview, Development |
| `VITE_SENTRY_DSN`        | *(your Sentry DSN, optional)*                    | Production                       |
| `SENTRY_AUTH_TOKEN`      | *(your Sentry auth token, optional)*             | Production                       |
| `SENTRY_ORG`             | `phoenix-portal`                                 | Production                       |
| `SENTRY_PROJECT`         | `phoenix-portal`                                 | Production                       |

**Note:** `VITE_` prefixed variables are embedded in the client bundle at build time. They are safe to expose (public keys only).

### 3.3 Verify SPA Routing

The `vercel.json` is already configured:
```json
{
  "rewrites": [
    { "source": "/((?!assets/).*)", "destination": "/index.html" }
  ]
}
```

This ensures all routes (e.g., `/dashboard`, `/history/abc123`) are served by the SPA rather than returning 404.

### 3.4 First Deployment

After connecting the repo and setting env vars:
1. Vercel auto-deploys on push to `main`
2. Preview deployments created for PRs
3. Check the build log for errors
4. Visit the deployment URL → should see the landing page

---

## 4. RevenueCat Webhook Setup

RevenueCat manages mobile app subscriptions (via App Store / Play Store) and notifies your portal backend when subscription state changes.

### 4.1 RevenueCat Dashboard Setup

1. Go to https://app.revenuecat.com
2. Navigate to your project → **Integrations** → **Webhooks**
3. Click **Add Webhook**
4. **Webhook URL:** `https://ilzlswmatadlnsuxatcv.supabase.co/functions/v1/revenuecat-webhooks`
5. **Authorization Header:** Enter a strong random secret (e.g., generate with `openssl rand -hex 32`)
6. **Events to Send:** Select all subscription events:
   - `INITIAL_PURCHASE`
   - `RENEWAL`
   - `CANCELLATION`
   - `UNCANCELLATION`
   - `EXPIRATION`
   - `BILLING_ISSUE`
   - `PRODUCT_CHANGE`
   - `SUBSCRIPTION_EXTENDED`
   - `REFUND_REVERSED`
   - `TEST` (for verification)
7. Click **Save**

### 4.2 Set the Secret in Supabase

Use the **exact same secret** you entered in RevenueCat:

```bash
supabase secrets set REVENUECAT_WEBHOOK_SECRET "the-secret-you-entered-above"
```

### 4.3 Verify Webhook

1. In RevenueCat Dashboard → Webhooks → click **Send Test Event**
2. Check Supabase Dashboard → Edge Functions → `revenuecat-webhooks` → Logs
3. Should see a 200 response (TEST events are acknowledged but don't write to DB)

### 4.4 How It Works

The webhook handler (`revenuecat-webhooks/index.ts`):
1. Validates `Authorization: Bearer {secret}` header
2. Extracts `app_user_id` (your Phoenix user ID) from the event
3. Maps entitlements to tiers: `elite` → ELITE, `phoenix` → PHOENIX, else FREE
4. Upserts the `subscriptions` table with tier, status, period dates
5. Idempotency via `last_event_id` (skips duplicate events)

**Entitlement IDs must match:** Your RevenueCat entitlements must be named `elite` and `phoenix` (case-insensitive). If they're named differently, update the mapping in `src/lib/revenuecat.ts`.

---

## 5. Third-Party Integration Setup

All integrations require **ELITE tier** subscription to access (gated by `SubscriptionGate` component on the `/integrations` page).

**Launch options:**
- **Option A:** Set up all OAuth credentials now → integrations work at launch
- **Option B:** Ship without credentials → integrations page shows connected UI but OAuth fails → add a "Coming Soon" badge (see Section 7.2)
- **Option C (Recommended):** Set up Strava (instant approval) now, gate Fitbit/Garmin/Hevy behind "Coming Soon" while waiting for their developer program approvals

---

### 5.1 Strava

**Approval Time:** Instant (self-service)
**Auth Type:** OAuth 2.0
**Scopes:** `activity:read_all`

#### Step 1: Create Strava API Application

1. Go to https://www.strava.com/settings/api
2. Sign in with a Strava account (create one if needed)
3. Fill in the application form:
   - **Application Name:** `Phoenix Portal`
   - **Category:** `Training Analysis`
   - **Club:** *(leave blank)*
   - **Website:** `https://your-production-domain.com`
   - **Application Description:** `Sync Vitruvian Trainer workouts with Strava`
   - **Authorization Callback Domain:** `ilzlswmatadlnsuxatcv.supabase.co`
     - **Important:** Strava wants just the domain, not a full URL. The actual callback URL is `https://ilzlswmatadlnsuxatcv.supabase.co/functions/v1/strava-oauth`
4. Click **Create**
5. Note your **Client ID** and **Client Secret**

#### Step 2: Set Supabase Secrets

```bash
supabase secrets set STRAVA_CLIENT_ID "your-client-id"
supabase secrets set STRAVA_CLIENT_SECRET "your-client-secret"
```

#### Step 3: Set Client-Side Variable (Optional)

The portal frontend uses `VITE_STRAVA_CLIENT_ID` to construct the OAuth initiation URL. However, the actual OAuth flow goes through the `initiate-oauth` Edge Function which reads `STRAVA_CLIENT_ID` from secrets. Check if the frontend uses the client-side variable:

```bash
# If it does, add to Vercel env vars:
VITE_STRAVA_CLIENT_ID=your-client-id
```

#### How Strava Sync Works

1. User clicks "Connect Strava" on `/integrations`
2. Frontend calls `POST /functions/v1/initiate-oauth` with `{ provider: "strava" }`
3. Edge Function generates CSRF state token → stores in `oauth_states` table (10-min expiry)
4. Returns authorization URL → user redirected to Strava consent screen
5. User approves → Strava redirects to `https://{SUPABASE_URL}/functions/v1/strava-oauth?code=...&state=...`
6. Edge Function validates state token, exchanges code for access/refresh tokens
7. Stores tokens in `oauth_tokens` table, creates `user_integrations` record
8. Redirects user to `{APP_URL}/integrations?connected=strava`
9. Background: `process-sync-queue` picks up initial sync task
10. Calls Strava API: `GET /api/v3/athlete/activities?per_page=200`
11. Maps activities to `external_activities` table (sport type, duration, distance, heart rate, elevation)
12. Incremental syncs use `after={last_sync_timestamp}` parameter

**Rate Limits:** 80 requests per 15 minutes (tracked in `rate_limit_tracking` table)

**Data Synced:**

| Strava Field           | Portal Field            | Notes                                                            |
| ---------------------- | ----------------------- | ---------------------------------------------------------------- |
| `sport_type`           | `activity_type`         | Mapped: Run→running, Ride→cycling, WeightTraining→strength, etc. |
| `name`                 | `name`                  | Activity title                                                   |
| `start_date`           | `started_at`            | ISO timestamp                                                    |
| `elapsed_time`         | `duration_seconds`      | Seconds                                                          |
| `distance`             | `distance_meters`       | Already in meters                                                |
| `kilojoules`           | `calories`              | Converted: kJ × 0.239                                            |
| `average_heartrate`    | `avg_heart_rate`        | BPM                                                              |
| `max_heartrate`        | `max_heart_rate`        | BPM                                                              |
| `total_elevation_gain` | `elevation_gain_meters` | Meters                                                           |

---

### 5.2 Fitbit

**Approval Time:** 1-3 weeks (developer application review)
**Auth Type:** OAuth 2.0 with HTTP Basic Auth for token exchange
**Scopes:** `activity`

#### Step 1: Register as Fitbit Developer

1. Go to https://dev.fitbit.com
2. Sign in with a Fitbit account (or create one)
3. Click **Register an App** (https://dev.fitbit.com/apps/new)
4. Fill in the application form:
   - **Application Name:** `Phoenix Portal`
   - **Description:** `Sync fitness activities from Fitbit to Phoenix Portal for Vitruvian Trainer users`
   - **Application Website URL:** `https://your-production-domain.com`
   - **Organization:** `9th Level Software` (or your org name)
   - **Organization Website URL:** `https://your-production-domain.com`
   - **Terms of Service URL:** `https://your-production-domain.com/terms`
   - **Privacy Policy URL:** `https://your-production-domain.com/privacy`
   - **OAuth 2.0 Application Type:** **Server**
   - **Redirect URL:** `https://ilzlswmatadlnsuxatcv.supabase.co/functions/v1/fitbit-oauth`
   - **Default Access Type:** **Read Only**
5. Click **Register**
6. Wait for approval email (typically 1-3 weeks for server type)
7. Once approved, note your **OAuth 2.0 Client ID** and **Client Secret**

#### Step 2: Set Supabase Secrets

```bash
supabase secrets set FITBIT_CLIENT_ID "your-client-id"
supabase secrets set FITBIT_CLIENT_SECRET "your-client-secret"
```

#### How Fitbit Sync Works

Same OAuth initiation flow as Strava, but token exchange uses HTTP Basic Auth:
```
Authorization: Basic base64(client_id:client_secret)
```

**Key differences from Strava:**
- Token expiry uses `expires_in` (seconds from now) rather than `expires_at` (absolute timestamp)
- Token refresh triggered when less than 10 minutes remaining
- Activity list API uses offset-based pagination (`offset=0&limit=100`)
- Initial sync fetches 90 days of history; incremental uses `afterDate=YYYY-MM-DD`
- `max_heart_rate` is NOT available from Fitbit activity list endpoint (stored as NULL)

**Rate Limits:** 120 requests per 60 minutes

**Data Synced:**

| Fitbit Field       | Portal Field       | Notes                                                               |
| ------------------ | ------------------ | ------------------------------------------------------------------- |
| `activityName`     | `name`             | Activity title                                                      |
| `activityTypeId`   | `activity_type`    | Numeric mapping: 90013→running, 90009→cycling, 15000→strength, etc. |
| `startTime`        | `started_at`       | ISO timestamp                                                       |
| `duration`         | `duration_seconds` | Converted: ms ÷ 1000                                                |
| `distance`         | `distance_meters`  | Converted: km × 1000                                                |
| `calories`         | `calories`         | kcal                                                                |
| `averageHeartRate` | `avg_heart_rate`   | BPM                                                                 |
| *(not available)*  | `max_heart_rate`   | NULL                                                                |

---

### 5.3 Garmin

**Approval Time:** 2-6 weeks (developer program application + API access request)
**Auth Type:** OAuth 1.0a (NOT OAuth 2.0 — significantly more complex)
**Sync Method:** Push via webhook (NOT polling)

#### Step 1: Apply to Garmin Developer Program

1. Go to https://developer.garmin.com
2. Click **Get Started** → create a Garmin Developer account
3. Navigate to **APIs** → **Health API** (or **Connect API**)
4. Click **Request API Access**
5. Fill in the application:
   - **Company Name:** `9th Level Software`
   - **Application Name:** `Phoenix Portal`
   - **Application Description:** `Sync fitness activities from Garmin Connect to Phoenix Portal for Vitruvian Trainer strength training users`
   - **Use Case:** Health/fitness data synchronization for strength training analytics
   - **APIs Requested:** Activity data (activities, activity details)
   - **OAuth Callback URL:** `https://ilzlswmatadlnsuxatcv.supabase.co/functions/v1/garmin-oauth`
   - **Webhook URL:** `https://ilzlswmatadlnsuxatcv.supabase.co/functions/v1/garmin-webhook`
6. Submit and wait for approval email
7. Once approved, you'll receive a **Consumer Key** and **Consumer Secret**

#### Step 2: Configure Webhook URL

After approval, Garmin will ask you to register your webhook endpoint:
- **Webhook URL:** `https://ilzlswmatadlnsuxatcv.supabase.co/functions/v1/garmin-webhook`
- The webhook handler accepts:
  - `GET` requests (health pings → returns 200)
  - `POST` requests with activity data payload
- Optional authentication via `x-webhook-secret` header

#### Step 3: Set Supabase Secrets

```bash
supabase secrets set GARMIN_CONSUMER_KEY "your-consumer-key"
supabase secrets set GARMIN_CONSUMER_SECRET "your-consumer-secret"

# Optional: if Garmin provides a webhook verification secret
supabase secrets set GARMIN_WEBHOOK_SECRET "your-webhook-secret"
```

#### How Garmin Sync Works

**Garmin uses OAuth 1.0a** — a 3-step flow with HMAC-SHA1 request signing:

1. User clicks "Connect Garmin" → `initiate-oauth` generates state token
2. Redirects to `garmin-oauth` Edge Function which:
   a. Requests a **request token** from `https://connectapi.garmin.com/oauth-service/oauth/request_token`
   b. Signs the request with HMAC-SHA1: `signing_key = consumer_secret&` (empty token secret)
   c. Temporarily stores request token/secret in `oauth_tokens`
   d. Redirects user to `https://connect.garmin.com/oauthConfirm?oauth_token={request_token}`
3. User approves on Garmin → redirected back with `oauth_token` + `oauth_verifier`
4. Edge Function exchanges for **access token** at `https://connectapi.garmin.com/oauth-service/oauth/access_token`
5. Access token stored permanently (OAuth 1.0a tokens don't expire)

**After connection, Garmin pushes data via webhook:**
- No polling/queue needed — Garmin calls your webhook when new activities are recorded
- Payload includes activity details (type, duration, distance, heart rate, elevation)
- Activities mapped to `external_activities` table

**Rate Limits:** 40 requests per 60 minutes (manual sync only; webhook is push-driven so no limits)

**Data Synced (via webhook push):**

| Garmin Field                       | Portal Field            | Notes                                                             |
| ---------------------------------- | ----------------------- | ----------------------------------------------------------------- |
| `activityName`                     | `name`                  | Activity title                                                    |
| `activityType`                     | `activity_type`         | String mapping: RUNNING→running, STRENGTH_TRAINING→strength, etc. |
| `startTimeInSeconds`               | `started_at`            | Unix seconds + offset → ISO                                       |
| `durationInSeconds`                | `duration_seconds`      | Seconds                                                           |
| `distanceInMeters`                 | `distance_meters`       | Already metric                                                    |
| `activeKilocalories`               | `calories`              | kcal                                                              |
| `averageHeartRateInBeatsPerMinute` | `avg_heart_rate`        | BPM                                                               |
| `maxHeartRateInBeatsPerMinute`     | `max_heart_rate`        | BPM                                                               |
| `elevationGainInMeters`            | `elevation_gain_meters` | Meters                                                            |

---

### 5.4 Hevy

**Approval Time:** Instant (API key, self-service — requires Hevy PRO subscription)
**Auth Type:** API Key (not OAuth)
**Sync Method:** Pull (polling via sync queue)

#### Step 1: Get Hevy API Key

1. User must have **Hevy PRO** subscription
2. Go to Hevy app → Settings → API Access (or https://hevy.com/settings)
3. Generate an API key
4. **Note:** Each user provides their own API key — there's no developer application. The key is entered directly in the portal's Integrations page UI.

#### Step 2: No Server Secrets Needed

Hevy uses per-user API keys stored in the `oauth_tokens` table (field: `api_key`). There are no server-side secrets to configure.

#### How Hevy Sync Works

1. User enters their Hevy API key in the portal's Integrations page
2. Key stored in `oauth_tokens` table
3. `hevy-sync` Edge Function calls `GET https://api.hevyapp.com/v1/workouts` with `api-key: {user_key}` header
4. All workouts mapped as `activity_type: "strength"`
5. Duration calculated from `end_time - start_time`
6. Calories not available from Hevy API (stored as NULL)

**Rate Limits:** 40 requests per 60 minutes

**Fallback:** Users can import Hevy data via CSV upload instead of API key

---

## 6. Sentry Error Monitoring (Optional)

### 6.1 Create Sentry Project

1. Go to https://sentry.io → Sign up or log in
2. Create a new project:
   - **Platform:** React
   - **Project Name:** `phoenix-portal`
   - **Alert Frequency:** Issue owners (recommended)
3. Note the **DSN** from project settings (format: `https://xxx@yyy.ingest.sentry.io/zzz`)

### 6.2 Generate Auth Token

For source map uploads at build time:
1. Sentry Dashboard → Settings → Auth Tokens
2. Create new token with scopes: `project:releases`, `org:read`
3. Note the token

### 6.3 Set Environment Variables

In Vercel Dashboard:
```
VITE_SENTRY_DSN=https://your-dsn@sentry.ingest.sentry.io/your-project-id
SENTRY_AUTH_TOKEN=your-auth-token
SENTRY_ORG=phoenix-portal
SENTRY_PROJECT=phoenix-portal
```

### 6.4 How It Works

- Sentry only loads after user consents to cookies (via `CookieConsentBanner`)
- In production: 10% trace sample rate
- Source maps uploaded at build time (hidden source maps — not shipped to browser)
- React 19 integration catches uncaught errors, caught errors, and recoverable errors

**If you skip Sentry:** The app works fine without it. The DSN check is graceful — if empty, Sentry never initializes.

---

## 7. Code Fixes

### 7.1 Fix config.toml (REQUIRED)

**File:** `supabase/config.toml`

Replace entire contents:
```toml
[functions.revenuecat-webhooks]
verify_jwt = false
```

### 7.2 Add "Coming Soon" to Ungated Integrations (RECOMMENDED)

If shipping without Fitbit/Garmin/Hevy credentials, add visual indicators.

**File:** `src/app/components/Integrations.tsx`

The integrations page currently shows all providers as active. For any provider without configured OAuth secrets, the `initiate-oauth` Edge Function will fail silently or return an error.

**Approach:** Add a `COMING_SOON` status to providers that aren't ready:

```tsx
// At the top of the integrations config, add a flag per provider:
const INTEGRATION_STATUS = {
  strava: 'active',       // OAuth configured
  fitbit: 'coming_soon',  // Waiting for developer approval
  garmin: 'coming_soon',  // Waiting for developer approval
  hevy: 'active',         // User-provided API key, no server config needed
} as const;
```

Then in the provider card rendering, conditionally show a "Coming Soon" badge and disable the Connect button for `coming_soon` providers. Update to `'active'` as each provider is approved and secrets are configured.

### 7.3 Fix Dead Footer Links (RECOMMENDED)

**File:** `src/app/components/LandingPage.tsx`

Three dead links need updating:

| Line | Current                         | Fix                                            |
| ---- | ------------------------------- | ---------------------------------------------- |
| ~925 | `<a href="#">Mobile App</a>`    | Link to Play Store listing or GitHub releases  |
| ~933 | `<a href="#">Portal Source</a>` | Link to GitHub repo (if open source) or remove |
| ~975 | `Security` (no link tag)        | Add `<Link to="/privacy">` or remove           |

### 7.4 Notification Bell (NO ACTION NEEDED)

The dashboard notification bell already shows a toast: "Notifications coming in a future update". This is honest and non-broken — leave it.

---

## 8. CI/CD Pipeline

### 8.1 Current State

The CI pipeline (`.github/workflows/ci.yml`) runs on push to `main` and PRs:
- Biome lint + format
- TypeScript check
- Vitest unit tests
- Playwright E2E tests
- Production build (with placeholder env vars)

**It does NOT deploy.** Deployment is manual or via Vercel's GitHub integration.

### 8.2 Add Automated Deployment (RECOMMENDED)

**Option A — Vercel GitHub Integration (Simplest):**
- Vercel auto-deploys on push to `main` when the repo is connected
- Preview deployments on PRs
- No CI changes needed
- Downside: deploys even if CI fails

**Option B — Deploy only after CI passes:**

Add a deployment job to `.github/workflows/ci.yml`:

```yaml
deploy:
  needs: [lint, typecheck, test, e2e, build]
  runs-on: ubuntu-latest
  if: github.ref == 'refs/heads/main' && github.event_name == 'push'
  steps:
    - uses: actions/checkout@v4
    - uses: amondnet/vercel-action@v25
      with:
        vercel-token: ${{ secrets.VERCEL_TOKEN }}
        vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
        vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
        vercel-args: '--prod'
```

**Required GitHub Secrets:**

| Secret              | How to Obtain                                                            |
| ------------------- | ------------------------------------------------------------------------ |
| `VERCEL_TOKEN`      | Vercel Dashboard → Settings → Tokens → Create                            |
| `VERCEL_ORG_ID`     | Vercel Dashboard → Settings → General → Team ID (or personal account ID) |
| `VERCEL_PROJECT_ID` | Vercel Dashboard → Project → Settings → General → Project ID             |

### 8.3 Edge Function Deployment

Edge Functions are deployed separately from the frontend. Currently manual:

```bash
supabase functions deploy
```

**To automate:** Add a Supabase deploy step to CI that runs when files in `supabase/functions/` change. This requires a Supabase access token as a GitHub secret.

---

## 9. DNS & Domain Setup

### 9.1 Choose a Domain

Options:
- `portal.phoenix-app.com` (subdomain of main brand)
- `app.phoenix-fitness.com`
- `phoenix-portal.vercel.app` (free Vercel subdomain for testing)

### 9.2 Configure in Vercel

1. Vercel Dashboard → Project → Settings → Domains
2. Add your domain
3. Vercel provides DNS records (A record or CNAME)
4. Configure in your DNS provider:
   - **CNAME:** `portal` → `cname.vercel-dns.com` (for subdomains)
   - **A Record:** `76.76.21.21` (for apex domains)
5. SSL certificate is auto-provisioned by Vercel

### 9.3 Update APP_URL

After domain is configured and DNS propagated:

```bash
supabase secrets set APP_URL "https://your-actual-domain.com"
```

**This is critical.** `APP_URL` is used for:
- CORS allowed origins (Edge Functions reject requests from unlisted origins)
- OAuth callback redirects (users land on `{APP_URL}/integrations?connected=provider`)
- Token exchange redirect URIs

### 9.4 Update OAuth Callback Domains

If your production domain is different from what you registered with OAuth providers:

- **Strava:** Update callback domain at https://www.strava.com/settings/api
  - Note: Strava callback URL uses the Supabase domain (`ilzlswmatadlnsuxatcv.supabase.co`), not the portal domain, so this only matters if you change Supabase projects
- **Fitbit:** Update redirect URL in Fitbit developer app settings
- **Garmin:** Contact Garmin developer support to update callback URL

---

## 10. Pre-Launch Testing

### 10.1 Build Verification

```bash
cd C:/Users/dasbl/AndroidStudioProjects/phoenix-portal

# Install dependencies
npm install

# Type check
npm run typecheck

# Unit tests
npm test

# E2E tests (requires Playwright browsers)
npx playwright install
npm run test:e2e

# Production build
npm run build

# Preview production build locally
npx vite preview
```

### 10.2 End-to-End Sync Test

This is the critical happy path — test it manually:

1. **Portal sign-up:** Visit portal → Create account → Verify email
2. **Mobile sign-in:** Open app → Settings → Link Portal Account → Sign in with same email
3. **Do a workout:** Complete a short workout on the Vitruvian trainer
4. **Verify push:** Wait for auto-sync (or tap "Sync Now") → Check portal Dashboard for new workout
5. **Create routine on portal:** Go to `/routines/new` → Build a routine → Save
6. **Verify pull:** On mobile, trigger sync → Verify routine appears in mobile routine list
7. **Check data integrity:** Compare workout details (exercises, sets, weights, reps) between mobile and portal

### 10.3 Auth Flow Test

- [ ] Email sign-up → confirmation email received → account activates
- [ ] Email sign-in → redirects to dashboard
- [ ] Google OAuth → redirects to dashboard (if configured in Supabase Auth)
- [ ] Apple OAuth → redirects to dashboard (if configured in Supabase Auth)
- [ ] Password reset → email received → password changed
- [ ] Sign out → returns to landing page
- [ ] Protected route access while logged out → redirects to landing page

### 10.4 Subscription Test

- [ ] Free user → can access Dashboard, History (30-day limit), Records, Routines, Goals
- [ ] Free user → Analytics, Biomechanics, Session Replay show paywall
- [ ] Free user → Integrations page shows paywall
- [ ] (If RevenueCat configured) → Send test webhook → tier updates in real-time

### 10.5 Integration Test (Per Provider)

For each configured integration:
- [ ] Click "Connect {Provider}" → redirected to provider consent screen
- [ ] Approve → redirected back to `/integrations?connected={provider}`
- [ ] Status shows "Connected" with provider user ID
- [ ] Activities appear in synced activities table (may take a few minutes for queue processing)
- [ ] Click "Disconnect" → status returns to disconnected → tokens deleted

---

## 11. Post-Launch Monitoring

### 11.1 Supabase Dashboard

- **Edge Function Logs:** Dashboard → Edge Functions → Select function → Logs
  - Watch for: 401s (auth failures), 500s (code errors), CORS rejections
- **Database:** Dashboard → Table Editor → Check `subscriptions`, `user_integrations`, `external_activities` tables
- **Auth:** Dashboard → Authentication → Users → Verify signups are working
- **Realtime:** Dashboard → Realtime → Verify broadcast messages for sync updates

### 11.2 Vercel Dashboard

- **Deployments:** Check build success/failure
- **Analytics:** Request counts, response times, error rates
- **Logs:** Runtime logs for any SSR/edge issues (though this is a pure SPA)

### 11.3 Key Metrics to Watch

| Metric                      | Where              | Alert Threshold   |
| --------------------------- | ------------------ | ----------------- |
| Edge Function error rate    | Supabase Logs      | > 5% of requests  |
| `mobile-sync-push` latency  | Supabase Logs      | > 5s average      |
| Auth signup success rate    | Supabase Auth      | < 90%             |
| CORS rejections             | Edge Function Logs | Any in production |
| RevenueCat webhook failures | Supabase Logs      | Any 401/500       |
| OAuth callback failures     | Edge Function Logs | Any 4xx           |

### 11.4 Known Risks

| Risk                                     | Impact                              | Mitigation                                                           |
| ---------------------------------------- | ----------------------------------- | -------------------------------------------------------------------- |
| `APP_URL` mismatch                       | CORS blocks all Edge Function calls | Double-check before launch; test from production domain              |
| OAuth state token expiry (10 min)        | Slow users can't complete OAuth     | Monitor and consider increasing expiry                               |
| Rate limit exhaustion (Strava: 80/15min) | Heavy users can't sync              | Queue processor handles retries; users see error message             |
| Garmin OAuth 1.0a signature failures     | Connection fails                    | HMAC-SHA1 signing is fragile — test thoroughly                       |
| Large sync payloads                      | Timeout on push/pull                | 30s timeout in Edge Functions; monitor for users with 1000+ workouts |

---

## Summary: What to Do in What Order

### Day 1: Infrastructure (2-3 hours)

1. ☐ Fix `config.toml` (remove Stripe, add RevenueCat)
2. ☐ Set Supabase secrets (`APP_URL`, `ENVIRONMENT`, `REVENUECAT_WEBHOOK_SECRET`)
3. ☐ Deploy Edge Functions (`supabase functions deploy`)
4. ☐ Connect portal repo to Vercel
5. ☐ Set Vercel environment variables
6. ☐ Configure domain + DNS
7. ☐ Update `APP_URL` secret to real domain after DNS propagates

### Day 1: Integrations - Immediate (30 min)

1. ☐ Create Strava API application (instant approval)
2. ☐ Set Strava secrets in Supabase

### Day 1: Integrations - Submit Applications (30 min)

1. ☐ Submit Fitbit developer application (1-3 week wait)
2. ☐ Submit Garmin developer program application (2-6 week wait)

### Day 1: Code Fixes (30 min)

1. ☐ Add "Coming Soon" badge for Fitbit/Garmin on Integrations page
2. ☐ Fix dead footer links
3. ☐ Commit and push to main → auto-deploys to Vercel

### Day 1: Verification (1 hour)

1. ☐ Run full test suite locally
2. ☐ Test auth flow on production domain
3. ☐ Test end-to-end sync with mobile app
4. ☐ Test Strava OAuth flow
5. ☐ Send RevenueCat test webhook

### Ongoing: As Approvals Come In

1. ☐ Fitbit approved → set secrets → remove "Coming Soon" badge
2. ☐ Garmin approved → set secrets → configure webhook → remove "Coming Soon" badge
