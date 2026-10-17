# Database Documentation

## Technology Stack
- **Database**: PostgreSQL
- **Driver**: `pg` (Node.js)
- **ORM**: None (Plain JavaScript and raw SQL queries are used)

## Migrations
- **Location**: `server/migrations/`
- **Execution**: Migrations are executed via the custom runner at `server/src/utils/migrate.js` using the command `npm run migrate`.
- **Tracking Mechanism**: The runner creates a `migrations` table in the database to track which SQL files have already been applied by their filename. It ensures each migration runs only once and executes them within a transaction (`BEGIN` / `COMMIT`).

## Schema Overview
- **households**: Represents the shared house.
- **users**: Represents the system users (members).
- **household_memberships**: Junction table for household members and their roles.
- **food_configuration**: Stores historical and current default food rates (in paise).
- **food_records**: Stores the daily food required/cancelled status for members.
- **bills**: Monthly generated bills tracking total and paid amounts.
- **payments**: Records individual payments against bills with an idempotency key.
- **chore_definitions**: Definitions for assignments (e.g., Vessel Washing).
- **chore_assignments**: Concrete instances/assignments of chores to users.
- **dustbin_cycles**: Tracks cycle starts and current user for cyclic chores.
- **notifications**: System notifications and alerts for users.
- **audit_logs**: Generic audit trail for tracking critical actions.
- **sessions**: Session storage table for managing active logins/sessions.

## Important Constraints & Design Decisions
- **Monetary Values**: All monetary values (`rate_paise`, `total_amount_paise`, `paid_amount_paise`, `amount_paise`) are stored as integers in **paise** to avoid floating-point inaccuracies.
- **Unique Constraints**: 
  - `(user_id, record_date)` on `food_records` prevents duplicate statuses for a single day.
  - `(user_id, billing_month)` on `bills` prevents duplicate monthly bills.
  - `idempotency_key` on `payments` guarantees safe retries.
- **Primary Keys**: Used UUIDs/strings for users to map gracefully to mock data, and SERIAL IDs for auto-incrementing records.
- **No Implicit Seed Data**: No seed data or arbitrary constraints are embedded into the initial migration to keep the schema purely structural as specified.
