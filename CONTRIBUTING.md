# Contributing

Thanks for your interest in **apexcharts-card**!

## Bug reports

Please use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.yml).

## Feature requests

Please use the [feature request template](.github/ISSUE_TEMPLATE/feature_request.yml).

## Development setup

This is a [Lit](https://lit.dev/) + TypeScript Lovelace card bundled with [Rollup](https://rollupjs.org/).

```bash
npm ci            # install dependencies
npm run watch     # build + rebuild on change (serves the card for local HA dev)
npm run build     # full production build (type-check + bundle)
npm run lint      # eslint
npm run format    # prettier --write
npm test          # unit/integration regressions
npm run format:check
npm run check:bundle # after build: raw and gzip size budgets
```

A ready-to-use development environment is provided in [`.devcontainer/`](.devcontainer/):
it starts Home Assistant and serves the card automatically.

### Browser and performance regressions

After building the card, install the development-only Chromium binary and run the browser suite:

```bash
npx --no-install playwright install chromium --only-shell
npm run test:browser
npm run test:browser -- --grep @performance
```

On Linux, use `playwright install --with-deps chromium --only-shell` when system libraries are missing. Playwright starts and stops a loopback-only fixture server on port 4178. It never connects to your Home Assistant instance and adds no browser-test code to the distributed card.

The fixture exercises the production bundle, including mobile resizing, Sections-style height, reconnects, brush/legend behavior and visible load-error recovery. The performance scenario renders three cards with 10,000 generated points each, checks that samples were retained, and reports elapsed time in the test output. It does not measure HA network latency or represent a wall-tablet benchmark. Compare timings on the same machine; do not treat different CI runners as equivalent hardware.

`npm run check:bundle` enforces ceilings of 1,550,000 bytes raw and 450,000 bytes gzip (level 9). These are explicit review budgets, not a claim about HA's HTTP compression. Investigate growth before adjusting them. No additional runtime dependency is needed for either measurement.

Before completing a reliability milestone, also test real HA entity/statistics data, dashboard navigation, connection recovery and a representative lower-powered device. Simulated browser tests cannot establish compatibility with every HA version or guarantee the absence of defects.

### Pre-commit hooks

This repo uses [prek](https://github.com/j178/prek) (a drop-in Rust runner for
[pre-commit](https://pre-commit.com/)) to run Prettier and ESLint before each commit:

```bash
pipx install prek   # or: brew install j178/prek/prek
prek install
```

If you prefer the Python runner, `pipx install pre-commit && pre-commit install`
works the same way (both read `.pre-commit-config.yaml`).

## Pull requests

1. Create a dedicated branch: `git checkout -b feat/my-feature`
2. Make your changes and run `npm test`, `npm run lint`, `npm run format:check`, `npm run build`, `npm run check:bundle` and `npm run test:browser`. Type-check, regressions, lint, formatting and bundle checks must pass.
3. Use [Conventional Commits](https://www.conventionalcommits.org/) for your commit
   messages (`feat:`, `fix:`, `docs:`, `chore:` …). This drives the automated changelog
   and version bump.
4. Open a pull request against `main`.

## Releases

Releases are automated with [release-please](https://github.com/googleapis/release-please).
Merging conventional commits into `main` maintains a release pull request; merging that
pull request publishes the release (tag + `apexcharts-card.js` asset).

## Dependency management

This repo uses **Renovate** (not Dependabot). Dependency update pull requests are opened
by `@renovate[bot]` — see the Dependency Dashboard issue for the full queue.
