# Security Policy

## Reporting Security Issues

If you discover a security vulnerability in this project, please report it to the household administrator rather than opening a public issue.

## Credential & Secret Management

- **No Secrets in Source:** All secrets (passwords, tokens, database credentials, session secrets) must be supplied via environment variables and never committed to version control.
- **Argon2id Password Storage:** All user authentication utilizes modern Argon2id hashing algorithms with random salts.
- **Session Security:** Session tokens are hashed using SHA-256 before storage in PostgreSQL and transmitted via HTTP-only, SameSite-restricted cookies.
- **Safe Credential Management Guide:** For instructions on configuring or rotating credentials safely, refer to [Credential Management Guide](docs/CREDENTIALS.md).
