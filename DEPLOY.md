Deployment & DB setup checklist

This file documents the recommended steps to deploy the backend with a managed MySQL (Clever Cloud) and host the API on Render.

1) Rotate/confirm DB credentials on Clever Cloud
- Go to your Clever Cloud dashboard -> your MySQL add-on -> Credentials
- Either rotate the password for the existing user or create a new user with privileges to the target database.

2) Add environment variables to Render
- In Render service dashboard -> Settings -> Environment -> Environment Variables
- Add the following (replace values from Clever Cloud):
  - DB_HOST
  - DB_PORT
  - DB_NAME
  - DB_USER
  - DB_PASSWORD
  - DB_SSL (true|false) — set to true if Clever Cloud requires TLS
  - DB_SSL_CA (optional) — the PEM contents or base64-encoded PEM
  - JWT_SECRET (strong random value)
  - NODE_ENV=production

3) Enable DB SSL (if required)
- If Clever Cloud requires TLS, set DB_SSL=true and set DB_SSL_CA to the CA PEM or its base64-encoded content.

4) Redeploy on Render & check logs
- Trigger a deploy in Render after updating env vars.
- Open Logs and look for:
  - "✅ Database connected successfully"
  - If you see ER_ACCESS_DENIED_ERROR -> credentials/privileges wrong
  - If you see SSL errors -> fix DB_SSL/DB_SSL_CA

5) Local testing
- Copy `.env.example` to `.env` locally, fill values and run:
  - npm install
  - node test-db-conn.js

6) Hygiene
- Do NOT commit `.env` or secrets.
- You may choose to scrub past commits (BFG) if you need to remove secrets from history. This rewrites history and requires force-push.

7) Database connection limits on managed hosts
- Some managed database plans impose a low limit on concurrent connections (e.g. 5). If you see logs mentioning "max_user_connections" or "too many connections" during high traffic or on startup, reduce the connection pool size by setting the `DB_POOL_LIMIT` environment variable in Render to a lower value (for example `5`). The backend defaults to `5` if `DB_POOL_LIMIT` is not set.

  If connection exhaustion persists, consider:
  - Increasing the DB plan's connection limit.
  - Ensuring connections are released promptly (the pool used here does that by default).
  - Using a more resilient DB tier or adding a connection proxy if supported by the provider.

If you want help with any of these steps (rotating creds, updating Render, running the test), tell me which step and I'll guide or perform the safe, non-sensitive repo updates for you.
