## v0.7.16

> Fork release. Continuation of the v0.7.x line on `LetitiaChan/clawd-on-desk`.

### Bug Fixes

- **"Check for Updates" misreported GitHub API rate limiting (HTTP 403) as a generic "Network Error".** Packaged builds check for updates through the anonymous GitHub API (`api.github.com/repos/.../releases/latest`), which GitHub throttles to **60 requests/hour per IP** for unauthenticated calls. When that quota is exhausted the API returns `403`, but `fetchLatestRelease()` folded it into the catch-all `GitHub API returned <status>` message, which `classifyFailureType` then labeled **"Network Error"** with a "Check your network connection and try again." next step — misleading users whose network is perfectly fine.
- Fix: `fetchLatestRelease()` now inspects `403` / `429` responses (and the `x-ratelimit-remaining` header) and raises a dedicated rate-limit error. `classifyFailureType` returns a new **"Rate Limited"** failure type (ordered before the network heuristic). The error bubble shows a rate-limit-specific message plus an **"Open Release Page"** action so users can jump to GitHub and download manually. The same handling is applied to the `electron-updater` `latest.yml` error path.

### Internal / Refactor

- Added `isRateLimitedError()` helper and exported `classifyFailureType` / `isRateLimitedError` on `updater.__test` for unit coverage.
- Added `updateRateLimitMsg` / `openReleasePage` i18n strings in all 5 UI locales (en / zh-CN / zh-TW / ko / ja).

### Release & Packaging

- **CI build pipeline** — unchanged from v0.7.15.

### Test Results

- `npm test` — **2683 passed / 0 failed / 5 skipped** (346 suites, ~21 s), including 4 new regression cases: 403 rate-limit bubble + release-page action, non-403 network failure not misclassified, and `classifyFailureType` / `isRateLimitedError` unit tests.
- `npm run check:syntax` — ✅ 400 files, 13 require entries

### Known Limitations

- The rate-limit remedy is informational + manual: Clawd cannot raise GitHub's 60/hr anonymous quota, so the fix surfaces an accurate message and a manual download path rather than authenticating the API call.
