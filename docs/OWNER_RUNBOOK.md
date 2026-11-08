# Owner runbook: the steps only you can take (Constitution V.5, N1)

Each step below needs an account, a credential, a cost, or an outward action that the owner must
perform. Nothing here has been run by the build. Do them in order; each one says what to send back.

## 1. Start the local stack and verify it (Docker Desktop)

1. Start Docker Desktop.
2. From the repository root: `make up`, then `make dev-api` and `make dev-web` in two terminals.
3. Sign up a workspace in the web app, create a project, and check the views named in
   `docs/IMPLEMENTATION_STATUS.md` ("Owner action to finish verification").
4. Send back: the pass/fail result of each check, and any error text from the API terminal.

Alternative if Docker is not wanted: allow local binding for the sandbox (`sandbox.network.allowLocalBinding`
set to `true`), then tell me; the in-process database can then serve the API for checks.

## 2. First CI run on GitHub (N1)

1. Push `main` to GitHub. This is an outward action: it publishes the commits.
2. Open the Actions tab and read the first run. The Flutter job has never run.
3. Send back: the workflow name, pass or fail for each job, and the first failing step's log.

## 3. Real identity providers (N1)

- **SSO:** register a test OpenID Connect application with a real provider (for example a free developer
  tenant). Set the issuer, client ID and secret in the workspace SSO settings, sign in once, and send back
  the result.
- **SCIM:** point a test directory at the SCIM endpoint and create one user; send back the result.

## 4. Stripe test mode (N1)

Create a Stripe test account, set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_TEAM` and
`STRIPE_PRICE_BUSINESS` to test-mode values, forward webhooks with the Stripe CLI, and complete one test
checkout. Never use live keys in this environment. Send back: the checkout result.

## 5. External security review (N1)

Commission an external review of the authentication, tenant isolation (row level security), the
outbound webhook, chat and AI paths, and the attachment scanner. Scope: `docs/SECURITY.md` and
`docs/ARCHITECTURE.md`. Choose the reviewer and budget yourself; send back the report when it arrives.

## 6. Email (I2)

Choose the sender domain. Until then `MAIL_FROM` stays `no-reply@meridian.local`. To send mail, set
`EMAIL_NOTIFICATIONS=true`, `SMTP_URL`, and `MAIL_FROM` for that domain. Send back the domain you chose.

## 7. Chat and AI (I3, M1)

- **Slack:** create an incoming webhook for one test channel; paste it in the project's chat settings
  and send one status change to check the message.
- **Teams:** create an incoming webhook for a test channel; the same check.
- **AI:** set `ANTHROPIC_API_KEY` on the server (a key you control; never commit it). Turn AI on in
  workspace settings and run one summary. Confirm the model you want (default `claude-haiku-5-5`) and
  say whether you accept the Anthropic API as the provider.

## 8. Mobile (L1)

- Install the Android SDK (Android Studio), and a Java runtime. Then `flutter build apk` in
  `apps/mobile` and send back the result.
- Run the app on one Android device or emulator and sign in.

## What is not the owner's to do

Code changes, tests (none are added), migrations, and documentation updates stay with the build.
