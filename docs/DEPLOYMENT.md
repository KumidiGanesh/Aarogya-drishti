# Deployment guide

## Local demonstration stack

Requirements: Docker Compose v2 and a copied `.env.example` with local-only values. From the repository root:

```sh
cp .env.example .env
# Replace the placeholder secrets before starting.
docker compose up --build
```

The client is a static production build served by Nginx on `http://localhost:5173`; Nginx proxies `/api` to the Express service. MongoDB, MinIO, and the API are available on their configured local ports. The API health check is `/healthz`; the client health check is `/healthz`. Compose creates the local MongoDB service, runs idempotent index setup and the **synthetic demo seed** automatically. Do not use demo seed accounts or seed scripts in production.

## Production topology

Use a managed MongoDB service with TLS and authentication, a private S3-compatible bucket with server-side encryption and versioning, the Node API container, and a static client container behind an Nginx reverse proxy. Terminate TLS at the reverse proxy using Let's Encrypt or the hosting platform's managed TLS. Redirect HTTP to HTTPS at that edge and ensure it overwrites, rather than forwards untrusted, `X-Forwarded-*` headers. Configure `TRUST_PROXY=true` only when the application is reachable exclusively through that trusted proxy.

The client container renders the Nginx CSP and Permissions-Policy from `VIDEO_DOMAIN` at startup. Set the same trusted Jitsi hostname in the API and client container; the policy grants only that origin the External API script, meeting iframe, camera, microphone, screen capture, autoplay, and WebSocket permissions. Never use a wildcard provider origin. Production calls are rejected unless `VIDEO_DOMAIN` is a non-public Jitsi deployment and both `VIDEO_APP_ID` and `VIDEO_JWT_SECRET` are configured. Do not use public `meet.jit.si` for production or patient calls; its privacy, availability, and data-processing terms are outside the application's control.

Do not expose the database, object store, or API container directly to the public internet. Restrict ingress to the reverse proxy and required administration networks. Use a private bucket with public access blocked; use `STORAGE_AUTO_CREATE_BUCKET=false` and provision bucket permissions through infrastructure administration. Keep client image reads on authenticated application streams; never configure public object URLs.

## Environment and secrets

Set `MONGODB_URI` to the managed MongoDB connection string and provision a least-privilege application user scoped to the application database. Use unique, randomly generated JWT access and refresh secrets; configure a short access-token lifetime and rotate refresh tokens as documented in [SECURITY.md](./SECURITY.md). Set the browser CORS allowlist to the exact HTTPS origin(s). Configure private storage, stable encryption key IDs, notification/video/translation/voice providers only as needed, and keep every secret in the hosting platform's secret manager. Never bake secrets into an image or `VITE_*` build variable.

For S3, set `STORAGE_DRIVER=s3`, the private endpoint/bucket/region and restricted object credentials, and keep `STORAGE_AUTO_CREATE_BUCKET=false`. The checked-in `STORAGE_ENCRYPTION_KEY` example is not secure for deployment; provide a new 32-byte key encoded as 64 hex characters and follow the rotation procedure in the security guide.

## Release procedure

1. Build immutable server and client images from the same commit, scan dependencies and images, and publish them to a private registry.
2. Provision/verify MongoDB authentication/TLS and scoped application credentials, private object bucket, secrets, and backups. Never seed production synthetic demo identities.
3. Run database migrations once using the migration identity, as a release job: `npm run migrate`. Review `npm run migrate:status`.
4. Deploy the API and client. Check API `/healthz`, client `/healthz`, `/api-docs/`, and service logs before opening traffic.
5. Verify HTTPS, HSTS, CORS, authenticated photo streaming, audit events, and notification adapter health using synthetic test accounts.
6. Roll back application images independently. Only roll back a migration when its down migration is safe and the incident commander approves it; take a backup first.

The API container health check uses `/healthz`. The client Nginx container returns `/healthz`. Emit structured application logs to the platform log collector; alert on repeated 5xx responses, authentication failures, database pool exhaustion, failed notification delivery, and backup failures. Review access controls and audit logs regularly.

## Continuous integration

`.github/workflows/ci.yml` installs the locked workspace dependencies and runs i18n parity, lint, unit/integration tests, `npm audit --audit-level=high`, the exact route inventory check, and the production client build. CI deliberately fails the route check while Appendix A documents only 56 registered endpoints instead of the required 60; obtain the four exact missing route specifications rather than inventing paths.
