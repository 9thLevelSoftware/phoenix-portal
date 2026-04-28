# Security

Security-sensitive code includes Supabase Auth, RLS, Edge Functions, OAuth
integrations, Paddle billing, and account deletion.

## Rules

- Never commit secrets or real production credentials.
- Keep client-side environment variables limited to public browser-safe values.
- Validate Edge Function inputs before database writes.
- Use service-role keys only in server-side Edge Function contexts.
- Preserve RLS assumptions when changing tables, policies, or queries.
- Keep subscription access checks aligned between client gates and Edge
  Functions.

## References

- [Security pentest report](review/2026-03-28-security-pentest-report.md)
- [Auth audit](review/phase-2-auth-audit.md)
- [RLS matrix](review/phase-2-rls-matrix.md)
- [Security findings](review/phase-2-security-findings.md)
- [Edge functions security audit](edge-functions-security-audit.md)
