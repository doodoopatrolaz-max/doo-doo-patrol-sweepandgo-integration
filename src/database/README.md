# Database Module

Placeholder for the Prisma-backed database layer.

Current state:

- Existing runtime PostgreSQL helpers live in `src/db`.
- Initial long-term Prisma schema lives in `prisma/schema.prisma`.

Future work:

- Move runtime persistence to Prisma after the BI schema migration is created and tested.
- Keep compatibility with existing Sweep&Go webhook and onboarding records during migration.
