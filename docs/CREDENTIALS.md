# Credential Management and Script Execution Guide

This document outlines the security architecture and instructions for managing user credentials in the Shared House Mess Management application.

---

## 1. Security Architecture Overview

- **Algorithm:** All user passwords are encrypted using the **Argon2id** key-derivation function (`argon2.argon2id`), following OWASP password storage recommendations.
- **Primary Key Stability:** Internal primary keys (`user_soundar`, `user_sanjay`, `user_mukesh`, `user_raj`) are immutable and decouple user identity from login usernames (`Soundar`, `Sanjay`, `Mukesh`, `Raj`).
- **Zero Secrets in Code:** Plaintext passwords and secret tokens must never be committed to Git or stored in application source code or migration files.
- **Session Revocation:** Whenever a user's password or credentials are changed, active sessions are immediately revoked in the database (`DELETE FROM sessions WHERE user_id = $1`).

---

## 2. Setting User Credentials (`update_user_credentials.js`)

The script `server/scripts/update_user_credentials.js` updates credentials transactionally with parameterized queries and Argon2id hashing.

### Environment Variable Prerequisites
The script reads each user's password from untracked environment variables:

| User Account | Role | Environment Variable | Minimum Length |
|---|---|---|---|
| Soundar M | Admin | `USER_PASSWORD_SOUNDAR` | 8 characters |
| Sanjay K | Member | `USER_PASSWORD_SANJAY` | 8 characters |
| Mukesh S | Member | `USER_PASSWORD_MUKESH` | 8 characters |
| Raj Priyan A | Member | `USER_PASSWORD_RAJ` | 8 characters |

### Execution Instructions

1. Configure the variables in your local, untracked `server/.env` file or export them in your terminal session:
   ```bash
   export USER_PASSWORD_SOUNDAR="<your_secure_password>"
   export USER_PASSWORD_SANJAY="<your_secure_password>"
   export USER_PASSWORD_MUKESH="<your_secure_password>"
   export USER_PASSWORD_RAJ="<your_secure_password>"
   ```

2. Run the update script:
   ```bash
   cd server
   node scripts/update_user_credentials.js
   ```

3. Verification:
   - The script outputs only non-sensitive summary counts upon success.
   - If any environment variable is missing or less than 8 characters, execution is safely aborted before connecting or running any queries.

---

## 3. Development Testing Passwords (`setDevPasswords.js`)

The script `server/scripts/setDevPasswords.js` is strictly designed for local development and offline automated testing.

### Safety Guards
- **Production Block:** The script checks `NODE_ENV` and rejects execution immediately if set to `production`.
- **No Shared Passwords:** The script never sets accounts to a single shared password across users. Instead, it generates distinct cryptographically secure credentials per user.
- **Local Secret Storage:** In development mode, the distinct generated credentials are saved only to `server/.dev_credentials.local` with restrictive `0600` file permissions. This file is excluded by `.gitignore`.

---

## 4. Git and Version Control Safety Checklist

- [x] All `.env`, `.env*.local`, and `.dev_credentials*` files are listed in `.gitignore`.
- [x] `server/.env.example` contains only generic placeholder values.
- [x] Password hashes, database passwords, and session secrets are never printed to `stdout` or logged to files.
- [x] Real user credentials are supplied exclusively at runtime via secure environment variables.
