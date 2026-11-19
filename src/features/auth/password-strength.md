# Sign-up password strength

Phase 1's checklist and Wallet validation remain authoritative and unchanged.
Strength is advisory; even a Very weak estimate cannot invalidate a field or
block signup. Loading and estimator failures also cannot block signup.

## Packages and API

Pinned dependencies: `@zxcvbn-ts/core` 4.2.0, `@zxcvbn-ts/language-common` 4.1.3,
`@zxcvbn-ts/language-en` 4.1.1. The installed types and a real-library test verify
`new ZxcvbnFactory({ dictionary, graphs, translations, maxLength }).check(password)`.
Common and English dictionaries and the common keyboard graphs are configured;
English translations supply warnings and suggestions.

- https://zxcvbn-ts.github.io/zxcvbn/guide/getting-started/
- https://zxcvbn-ts.github.io/zxcvbn/guide/lazy-loading/

`passwordStrength.ts` caches a single dynamic import. Only when submitted,
nonempty feedback is needed does it load `passwordStrengthEstimator.ts`, the
engine, and both dictionaries from the application build. No remote API/CDN,
password/hash transmission, logging, or persistent storage is added. The loader
caches initialization, not password results. A failed import remains unavailable
until a page reload; signup continues to work.

The UI waits for a 200 ms pause in edits. Previous estimates disappear immediately
on an input change; cleanup ignores pending work for older inputs. Scores 0-4
map to Very weak, Weak, Moderate, Good, Strong, with 1-5 filled segments. Only the
warning, or the first suggestion if there is no warning, is displayed. There are
no cracking times or safety claims.

## Computation bound and measurements

The estimator accepts at most 128 Unicode code points, matching Wallet's maximum.
Its internal limit is explicitly 256 UTF-16 units so even 128 astral characters
are evaluated in full. Inputs above the bound are not estimated or truncated;
the UI explains the limit. A 1,024-character input is rejected by the estimator
guard before scoring. The UI's length guard short-circuits above 256 UTF-16 units.

A local Node 26 check of the installed engine with this configuration measured
about 103 ms initialization, 43 ms for a repeated 128-character input, 60 ms for
128 mostly astral code points, and 543 ms for a varied 128-character input.
These are observations, not timing assertions or browser guarantees. Computation
is synchronous on the main thread; complex inputs can briefly pause the UI.
Debouncing avoids scoring every keystroke. No worker or custom matcher is added.

## Licences and limitations

The three packages, dictionary-compression and fastest-levenshtein use MIT.
The English common-word data also derives from OpenSubtitles 2024 via OPUS
(Helsinki-NLP), under ODC-BY. The shipped `/third-party-notices.txt` retains
the upstream MIT notices, English `NOTICE.md` and `THIRD_PARTY_LICENSES.md`, source
links and the ODC-BY licence URI. Vite copies `public/third-party-notices.txt`
unchanged into the build. The signup page links to this file below the login
prompt, outside the form card. There is no credits link inside the form.
This placement is provisional pending visual inspection. See https://opendatacommons.org/licenses/by/1-0/.

Common/English dictionaries provide limited coverage of other languages. A high
score does not guarantee safety and does not replace Wallet's validation.
