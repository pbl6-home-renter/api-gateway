# API Gateway

This service is part of the PBL6 polyrepo architecture. Shared scope, API and
deployment conventions live in the repository-level [AGENTS.md](../AGENTS.md).

The gateway is the application entrypoint behind Caddy. It owns transport
cross-cutting concerns (JWT/JWKS verification, routing, correlation IDs,
timeouts and rate limiting); resource-level authorization remains in the
owning backend service.
