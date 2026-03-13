# Technology Stack

**Analysis Date:** 2026-03-13

## Languages

**Primary:**
- JavaScript (Node.js) - Server-side runtime and all application logic

## Runtime

**Environment:**
- Node.js v20+ (from `@supabase/auth-js` engine requirement)

**Package Manager:**
- npm
- Lockfile: `package-lock.json` (present)

## Frameworks

**Core:**
- Express.js 4.18.2 - HTTP server and API routing

**Infrastructure:**
- No additional web frameworks (lightweight Express-based application)

**Testing:**
- Not detected

**Build/Dev:**
- No build tool configured (runs directly as Node.js process)

## Key Dependencies

**Critical:**
- `@supabase/supabase-js` 2.99.1+ - Supabase client for database operations and API calls
  - Brings along: `@supabase/auth-js`, `@supabase/functions-js`, `@supabase/postgrest-js` (all v2.99.1)
  - Why it matters: Only database persistence layer; single point of failure for data operations

**Infrastructure:**
- `express-rate-limit` 7.0.0 - Rate limiting middleware (note: custom in-memory rate limiter used instead)
- `helmet` 8.0.0 - Security headers (note: custom security header implementation used instead)

## Configuration

**Environment:**
- Configuration via `process.env` variables:
  - `SUPABASE_URL` - Supabase project endpoint
  - `SUPABASE_SERVICE_KEY` - Supabase service role API key (for server-side database access)
  - `ADMIN_PASSWORD` - Admin authentication password
  - `MANAGER_PASSWORD` - Manager role authentication password
  - `PORT` - Server port (defaults to 8080)
- See `server.js` lines 9-10, 295, 300, 697, 808

**Build:**
- No build configuration files detected
- Application runs directly with: `node server.js`

## Platform Requirements

**Development:**
- Node.js >= 20.0.0 (required by Supabase auth-js dependency)
- npm for dependency installation

**Production:**
- Node.js >= 20.0.0 runtime
- Network access to Supabase API endpoints
- Deployment target: Any environment supporting Node.js (cloud platforms, servers, containers)
- Default port: 8080

---

*Stack analysis: 2026-03-13*
