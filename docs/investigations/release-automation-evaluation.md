# Evaluation: changesets / semantic-release vs. bespoke `npm run release`

> Status: **Decision recorded** · Scope: whether to replace the project's hand-rolled
> release orchestration (`scripts/release.js` + `auto-tag.yml` + `build.yml` +
> `docs/releases/`) with [changesets](https://github.com/changesets/changesets) or
> [semantic-release](https://github.com/semantic-release/semantic-release), so that
> `CHANGELOG.md` and GitHub Release notes are generated automatically from commits.

## TL;DR

- **Do not adopt `semantic-release`.** It insists on owning three things this project
  deliberately controls by hand — version determination, `CHANGELOG.md` content, and
  GitHub Release creation. All three collide with the existing fork version axis,
  the custom Keep-a-Changelog buckets, and the `build.yml` → `docs/releases/*` Release
  pipeline. High friction, low fit.
- **`changesets` is a closer fit but only partially useful.** Its core value —
  accumulating per-PR "release intent" — is marginal for a near-single-maintainer fork
  where the `[Unreleased]` block already plays that role. It still would not produce the
  rich per-version notes (real `npm test` numbers, Known Limitations, dual-path
  narratives) that give `docs/releases/*` their value.
- **Recommendation: keep the bespoke `npm run release` orchestrator** (now extended to
  also trigger CI), and — if we want more automation — add a *lightweight, optional*
  "changelog draft from `git log`" helper that the maintainer curates. This captures
  most of the manual-typing savings without surrendering editorial control.

## What we release today (the constraints any tool must respect)

1. **No local packaging.** `electron-builder` runs only in CI (`build.yml`) on tag push /
   `workflow_dispatch`. Any release tool must stop at *commit + tag + trigger*, never build.
2. **Deliberate, decoupled version axis.** This fork continues upstream `0.7.x`; upstream
   `v0.8.0` is unrelated. Version numbers are a human editorial decision, not a mechanical
   function of commit types.
3. **`CHANGELOG.md` is English, Keep-a-Changelog, with project-specific buckets** —
   `Added / Changed / Fixed / …` plus `Release & Packaging`, `Test Results`,
   `Known Limitations`, `Internal / Refactor` (see `CHANGELOG.md` §Conventions).
4. **Per-version release notes are hand-written and rich.** `docs/releases/release-vX.Y.Z.md`
   carries real `npm test` pass/fail counts, dual-path investigation narratives, and
   known-limitation call-outs. `build.yml` uses this file verbatim as the Release body.
5. **Tag + Release are already automated but bespoke.** `auto-tag.yml` derives the tag from
   `package.json.version`; `build.yml` creates the GitHub Release from `docs/releases/*`.
6. **Minimal dependency philosophy.** Runtime + hook code uses only Node built-ins;
   `devDependencies` is just `electron` + `electron-builder`.

## Scorecard

| Criterion | semantic-release | changesets | bespoke `release.js` (current) |
|---|---|---|---|
| Respects "no local packaging" | ⚠️ CI-only, but wants to publish itself | ✅ CI or local, publish optional | ✅ stops at commit+tag+trigger |
| Keeps manual/editorial version axis | ❌ derives version from commits | ✅ manual bump type per changeset | ✅ explicit `--version` / keyword |
| Preserves custom CHANGELOG buckets | ❌ fixed template | ⚠️ own template, not our buckets | ✅ we author the buckets |
| Produces rich per-version release notes | ❌ | ❌ | ✅ template + human curation |
| Plays nice with `auto-tag.yml` / `build.yml` | ❌ wants to own tag+Release | ⚠️ overlaps on version+tag | ✅ built around them |
| Requires Conventional Commits discipline | ✅ hard requirement | ➖ optional | ➖ optional |
| Dependency / maintenance cost | ❌ large tree, many plugins | ⚠️ moderate | ✅ zero deps, Node built-ins |
| Reduces manual cross-file typing | ✅ (if you accept its outputs) | ✅ partially | ✅ (version/CHANGELOG/notes/tag/CI in one command) |

## Why not `semantic-release`

`semantic-release` is designed to be the single source of truth for the release: it parses
Conventional Commits to **decide the next version**, **writes the CHANGELOG**, **creates
the git tag**, and **publishes the GitHub Release**. For a conventional library on `npm`
that is a great fit. Here it fights the project on every axis:

- The fork's version axis is a **human decision** (continuing `0.7.x`, avoiding upstream
  `0.8.0`). Letting commit types drive the number risks an unwanted `minor`/`major` jump.
- Its generated CHANGELOG cannot express our `Test Results` / `Known Limitations` /
  `Release & Packaging` buckets or the dual-path investigation prose.
- It would want to own the GitHub Release, duplicating `build.yml`'s
  `softprops/action-gh-release` step that already attaches installers + `docs/releases/*`.
- It adds a large dependency tree for a project that otherwise ships on Node built-ins.

Net: adopting it means *removing* editorial control that is the whole point of
`docs/releases/*`, plus rewiring `auto-tag.yml`/`build.yml`. Not worth it.

## Why `changesets` is only a partial fit

`changesets` is lighter and less dogmatic: contributors drop a `.changeset/*.md` file
stating the bump type + a human summary; a "version" step later consumes them to bump
`package.json` and append to `CHANGELOG.md`. Strengths that *do* matter here:

- Manual bump type per change (keeps the editorial version axis).
- Decouples "record the change now" from "cut the release later".

But the fit breaks down because:

- Its CHANGELOG output format is its own, not our custom buckets — we'd be post-editing
  every release anyway.
- It still does not generate the per-version `docs/releases/*` notes (test numbers etc.).
- Its headline benefit — many contributors each recording intent in separate files to
  avoid merge conflicts in `CHANGELOG.md` — is low-value for a fork with essentially one
  maintainer, where the `[Unreleased]` block already serves as the accumulation buffer.

If contributor count grows substantially, revisit changesets specifically for the
"per-PR intent file" workflow.

## Recommendation

1. **Keep and evolve `npm run release`.** It already unifies version bump + CHANGELOG close
   + release-notes scaffold + verify + commit/tag/push, and now also **triggers and checks
   `build.yml`** (closing the documented gap where a bare tag push does not reliably start
   CI — see `project-continuity` §3 step 6 / `AGENT-PROGRESS` §6-22). This delivers the
   "one command, no missed steps" goal without giving up editorial control.
2. **Do not add `semantic-release`.**
3. **Defer `changesets`** unless the contributor base grows; then adopt only its
   `.changeset/*` intent-file flow, still hand-curating the final CHANGELOG + release notes.
4. **Optional low-cost enhancement (not yet implemented):** a `scripts/changelog-draft.js`
   that lists `git log <lastTag>..HEAD` grouped by Conventional-Commit prefix
   (`feat`/`fix`/`docs`/…) to pre-fill the `[Unreleased]` buckets as a *draft* the
   maintainer edits. This borrows semantic-release's commit-parsing idea without ceding
   any control. Feasible because recent history already largely follows
   `type(scope): subject` (e.g. `fix(updater): …`, `fix(codebuddy): …`).

## Follow-ups if we ever reconsider

- Enforce Conventional Commits via a `commit-msg` hook + CI lint — prerequisite for *any*
  commit-driven changelog automation, including the optional draft helper above.
- Only then would `changesets` (or the draft helper) produce reliable groupings.
