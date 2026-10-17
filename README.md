# Shared House Mess Management

A modern web application for shared households to manage daily mess attendance, food cancellation, dynamic monthly billing, chore schedules, and emergency household information.

## Technology Stack
- **Frontend:** React, Vite, Vanilla CSS design system (Light / Dark / System themes)
- **Backend:** Node.js, Express, PostgreSQL
- **Security:** Argon2id password hashing, Helmet, rate limiting, secure HTTP-only cookies

## Documentation
- [Architecture & Design](ARCHITECTURE.md)
- [API Reference](API.md)
- [Database Schema & Migrations](docs/DATABASE.md)
- [Credential Management Guide](docs/CREDENTIALS.md)
- [Security Policy](SECURITY.md)

## Getting Started

1. Copy `.env.example` to `.env` in the `server` folder:
   ```bash
   cp server/.env.example server/.env
   ```
2. Configure required environment variables (see [Credential Management Guide](docs/CREDENTIALS.md)).
3. Install dependencies and run migrations:
   ```bash
   npm install --prefix server
   npm install --prefix client
   npm run migrate --prefix server
   ```
4. Start development servers:
   ```bash
   npm run dev --prefix server
   npm run dev --prefix client
   ```
