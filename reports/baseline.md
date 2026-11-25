# RemnaDrop — baseline, 2026-11-19

## Verified locally

- Portable Node.js 24.22.3 downloaded from nodejs.org; SHA-256 matched the
  official SHASUMS256.txt. Existing system Node installation was not changed.
- Backend and frontend `npm ci` succeeded after network retries.
- Backend Prisma client/type generation, Nest build and seed build passed.
- Frontend TypeScript check and Vite production build passed.
- Compose YAML parsed; six services, published ports restricted to loopback.
  All four application/seed entrypoint files exist after compilation.
- Runtime API source and contract files remain unchanged from upstream.

## Initial dependency audit

Full npm 11.19.1 production-dependency results are in the adjacent JSON files.
Backend: 32 findings (1 critical, 28 high, 3 moderate).
Frontend: 9 findings (8 high, 1 low).
These counts include transitive dependency findings; they do not demonstrate
that every advisory is exploitable through this application's routes.

Critical backend finding: proxy-addr, GHSA-jqcg-44mw-7w3h.
Other affected dependencies include Axios, Nest microservices, Multer and Zod.
No dependency advisory is marked fixed by this baseline. In particular, the
proposed upgrades to node-contract 3.x, Prisma 7.x and Zod 4.x require compatibility
work rather than an automatic forced audit fix.

## Changes

- Backend Docker runtime/build base updated from 24.18 to 24.22.3.
- Local database/Redis compose ports bound to loopback.
- Added CI build and dependency audit gates to each source repository.
- Added root local-source development Dockerfile and six-service Compose file.
- Preserved upstream SHAs and licenses, added setup and rollback instructions.

## Outstanding validation

Docker is unavailable on this machine. Container builds/startup, PostgreSQL
migrations, HTTP API tests and mixed-node integration tests are not yet verified.
There is no claim of full reproducibility: base image tags, CI action tags and
remote font assets still need digest/content pinning. The development image
omits Xray validator WASM/schema assets. Frontend build reports existing warnings
about the validator script and the `stream` module used by sax.

The upstream backend Dockerfile still downloads the latest frontend and remote
validator assets; use the root development Dockerfile for paired local sources.
Security CI is expected to fail until high/critical dependency findings are
resolved. Source-level security review and regression tests remain outstanding.
