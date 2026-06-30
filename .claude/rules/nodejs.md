# Node.js
Conventions for building server-side applications with Node.js and Express.

## Project Layout
- Separate routes, controllers, middleware, models, and services into their own directories.
- Keep route definitions thin — delegate to controller/service functions.
- Store configuration in environment variables (`.env`); validate required vars at startup with a small check or a config module.
- Read the existing project structure before adding new modules — follow the established layout.

## Express Conventions
- Use `express.Router()` per domain/resource and mount under versioned path prefixes (`/api/v1/...`).
- Register middleware in the correct order: CORS, body parser, auth, routes, error handler (always last).
- Write a centralized error-handling middleware `(err, req, res, next)` — do not let unhandled errors return 500 without context.

## Async and Error Handling
- Always `await` promises — never fire-and-forget. Unhandled rejections crash the process.
- Wrap async route handlers with a helper (`asyncHandler`) or use a router that supports async handlers natively.
- Use `process.on('unhandledRejection')` as a safety net, not as primary error handling.
- Return structured error responses with a consistent shape (e.g., `{ error: { code, message } }`) and appropriate HTTP status codes.

## Security
- Use `helmet` for security headers, `cors` with explicit origins, and `express-rate-limit` for endpoint throttling.
- Validate and sanitize all user input — use a schema validator (Zod, Joi) on every route that accepts input.
- Never log or expose stack traces, secrets, or full error details in production responses.

## Database
- Use the project's ORM or query builder. Keep raw SQL in dedicated query files, not inline in routes.
- Use connection pooling. Configure pool size based on expected concurrency.
- Run migrations as part of deployment; never hand-edit schema in production.

## Testing
- Write integration tests for API routes. Use the project's test runner (Jest, Vitest, Mocha) and HTTP assertion library (supertest).
- Run the test suite and confirm it passes before declaring work done.

## Logging
- Use a structured logger (pino, winston). Log at appropriate levels — `error` for failures, `warn` for recoverable issues, `info` for request lifecycle.
- Never use `console.log` in application code.
