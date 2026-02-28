# Requirements: Phoenix Portal v1.2

**Defined:** 2026-02-27
**Core Value:** Premium subscribers see data and insights about their training that they cannot get anywhere else — force curves, velocity trends, muscle balance analysis, and community-driven workout programming — making the subscription feel indispensable.

## v1.2 Requirements

Requirements for launch readiness. Each maps to roadmap phases.

### Security

- [x] **SEC-01**: CORS restricted to deployment domain on all browser-facing Edge Functions
- [x] **SEC-02**: OAuth tokens isolated to server-only table, removed from client-readable user_integrations
- [x] **SEC-03**: OAuth initiation uses cryptographic CSRF state tokens with 10-minute expiry
- [x] **SEC-04**: Source maps hidden from production CDN, uploaded to Sentry only
- [x] **SEC-05**: Content Security Policy headers deployed (report-only first, then enforcement)
- [x] **SEC-06**: Garmin webhook validates shared secret before processing
- [x] **SEC-07**: Hevy sync endpoint extracts user from JWT, rejects unauthenticated requests
- [x] **SEC-08**: Stripe checkout/portal redirects use APP_URL env var, not request origin header

### Legal & Compliance

- [x] **LEGAL-01**: Privacy Policy rewritten to accurately disclose portal data practices
- [x] **LEGAL-02**: Terms of Service created covering subscriptions, content, acceptable use
- [x] **LEGAL-03**: Pricing page and landing page show consistent pricing
- [x] **LEGAL-04**: Cookie consent banner with accept/reject, conditionally initializes Sentry
- [x] **LEGAL-05**: Free-tier usage limits enforced at UI and RLS level matching pricing page

### Data Rights

- [x] **GDPR-01**: User can export all personal data as downloadable ZIP
- [x] **GDPR-02**: User can request account deletion with 30-day grace period and cascade

### Operations

- [x] **OPS-01**: GitHub Actions CI pipeline with biome, vitest, playwright, deploy gates
- [ ] **OPS-02**: Stripe webhook integration tests for all 5 event types
- [ ] **OPS-03**: FAQ page and contact form for basic support
- [ ] **OPS-04**: Mobile-to-portal sync pipeline validated end-to-end
- [ ] **OPS-05**: CLAUDE.md updated to reflect actual architecture

### Community Moderation

- [x] **MOD-01**: User can report community posts and comments with category selection
- [x] **MOD-02**: User can block other users (content hidden client-side, not banned)

### Accessibility

- [x] **A11Y-01**: All Framer Motion animations respect prefers-reduced-motion OS setting
- [x] **A11Y-02**: Skip-to-content link visible on keyboard focus
- [x] **A11Y-03**: All charts have descriptive aria-labels; Canvas charts have text alternatives

### Navigation

- [x] **NAV-01**: Desktop navigation restructured into grouped categories (all 26 route paths preserved)

### Database

- [x] **DB-01**: Dual subscription tables unified or user_subscriptions explicitly deprecated
- [x] **DB-02**: user_id denormalized onto sets and rep_summaries tables for RLS performance

## Future Requirements

Deferred to v1.3+. Tracked but not in current roadmap.

### Admin & Moderation

- **ADMIN-01**: Admin dashboard for content moderation review queue
- **ADMIN-02**: Automated content moderation (AI/ML-based)

### Community

- **COMM-01**: Nested comment threads (deferred from v1.1)

### Monitoring

- **MON-01**: Sentry PII scrubbing for health/biometric data in error reports

## Out of Scope

| Feature | Reason |
|---------|--------|
| Full admin dashboard | Use Supabase Studio until moderation volume justifies a UI |
| AI content moderation | High false positive rate in fitness domain ("Skull Crusher" is a tricep exercise); manual-first |
| Real-time chat / support widget | High ongoing cost, SLA expectations a solo dev cannot meet |
| SOC 2 / ISO 27001 certification | $10K-50K audit cost; overkill for <1000 users |
| Multi-language / i18n | English-speaking community (AU/US/UK/EU); translation maintenance unsustainable solo |
| Feature flag service | Over-engineered; subscription gating is the feature flag |
| Light mode / theme toggle | App is dark-only by design |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SEC-01 | Phase 14 | Complete |
| SEC-02 | Phase 14 | Complete |
| SEC-03 | Phase 14 | Complete |
| SEC-04 | Phase 14 | Complete |
| SEC-05 | Phase 14 | Complete |
| SEC-06 | Phase 14 | Complete |
| SEC-07 | Phase 14 | Complete |
| SEC-08 | Phase 14 | Complete |
| LEGAL-01 | Phase 16 | Complete |
| LEGAL-02 | Phase 16 | Complete |
| LEGAL-03 | Phase 16 | Complete |
| LEGAL-04 | Phase 17 | Complete |
| LEGAL-05 | Phase 16 | Complete |
| GDPR-01 | Phase 17 | Complete |
| GDPR-02 | Phase 17 | Complete |
| OPS-01 | Phase 15 | Complete |
| OPS-02 | Phase 20 | Pending |
| OPS-03 | Phase 20 | Pending |
| OPS-04 | Phase 20 | Pending |
| OPS-05 | Phase 20 | Pending |
| MOD-01 | Phase 18 | Complete |
| MOD-02 | Phase 18 | Complete |
| A11Y-01 | Phase 19 | Complete |
| A11Y-02 | Phase 19 | Complete |
| A11Y-03 | Phase 19 | Complete |
| NAV-01 | Phase 19 | Complete |
| DB-01 | Phase 15 | Complete |
| DB-02 | Phase 15 | Complete |

**Coverage:**
- v1.2 requirements: 28 total
- Mapped to phases: 28
- Unmapped: 0

---
*Requirements defined: 2026-02-27*
*Last updated: 2026-02-27 after roadmap creation*
