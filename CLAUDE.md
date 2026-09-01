# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Roadmap and TODO live in pnb-app

`ROADMAP.md` and `TODO.md` in the sibling `pnb-app` repo are the canonical, cross-repo
tracker for the whole platform (this repo's `backend/`, plus `pnb-app` and
`pnb-database`) — don't create a separate copy here. After shipping a change to
`backend/` or deciding on next steps for it, update those two files in `pnb-app`: append
a dated bullet to `ROADMAP.md`'s "Done", and check off / append to `TODO.md` (append
rather than reword/reorder existing entries, so parallel edits merge cleanly).

## Source restored from upstream

This fork's initial commit shipped without the actual TypeScript implementation (only config/assets were checked in). The real source has since been restored from `drake7707/paintbynumbersgenerator@master` on GitHub into `src/` and `src-cli/main.ts`, and confirmed to compile and run end-to-end against `src-cli/testinput.png` (see "Verifying the CLI still works" below). `dist/index.html`'s bundled web build (`scripts/main.js`) is a separate build artifact, not required for the CLI/backend path.

Two dependency/toolchain fixes were needed to get it running on a modern machine and are reflected in `package.json`/`src-cli/tsconfig.json`/`src-cli/main.ts`:
- `canvas` was bumped from the pinned `2.5.0` to `^3.2.3` — the old version has no prebuilt binary for current Node, and this machine's Xcode Command Line Tools are unable to compile native modules from source (missing installer receipts).
- `svg2img` was dropped as a dependency entirely — it depends on its own old, uncompilable `canvas@2.x` transitively. It's only used for the CLI's optional PNG/JPG output profiles (SVG output doesn't need it), so `src-cli/main.ts` now `require("svg2img")`s it lazily inside those branches instead of at module load, and it must be installed separately (`npm install svg2img`) before using a `png`/`jpg` output profile.
- `src-cli/tsconfig.json` restricts `types` to `["node"]` (stray `@types/ws` in `node_modules/@types` was otherwise picked up and conflicted), and a couple of `canvas`-vs-DOM `ImageData`/`CanvasRenderingContext2D` type mismatches in `src-cli/main.ts` are bridged with `as unknown as ...` casts — cosmetic, upstream's runtime behavior is unchanged.

## Commands

- `npm install` — restore dependencies (also needs Homebrew's `cairo`/`pango`/`pixman`/etc. present on this machine for `canvas`'s native module; already installed here)
- `npm start` (alias for `npm run lite`) — serve the web app locally via `lite-server` on port 10001, for the browser version (uses root `index.html`, which loads `scripts/main.js` compiled from `src/` — that compiled bundle isn't currently checked in; only the CLI path has been verified)
- Web TypeScript build: compile `src/` per `src/tsconfig.json` (AMD modules, ES6 target, bundled via `outFile` into `scripts/main.js`, loaded through `require.js`)
- CLI TypeScript build: from `src-cli/`, run `../node_modules/.bin/tsc` (no local `typescript` was on `PATH`/pinned before; `^4.9.5` is now a devDependency). Per `src-cli/tsconfig.json`: ES5 target, per-file output, sourcemaps on. This is what CI (`.github/workflows/main.yml`) does.
- CLI packaging: `npm install pkg -g` then `pkg .` from repo root, producing standalone `paint-by-numbers-generator-{win,macos,linux}` executables (per README and CI workflow)
- Run CLI directly (after building): `node src-cli/main.js -i input.png -o output.svg -c settings.json` (see `.vscode/launch.json` for the debug config, which uses `testinputmedium.png`; only `testinput.png` is actually checked in)
- No test suite, linter script, or `tsc` npm script is currently defined in `package.json`; `tslint.json` files exist in both `src/` and `src-cli/` but there's no `npm run lint`.

### Verifying the CLI still works

```
cd src-cli
../node_modules/.bin/tsc
node main.js -i testinput.png -o /tmp/out.svg -c settings.json
```

Note `settings.json`'s default `outputProfiles` include `png`/`jpg` profiles, which will fail with `Cannot find module 'svg2img'` unless you `npm install svg2img` first (see above) — the `svg` profile works with just the base install.

## Architecture

Two independent entry points share the same core image-processing pipeline, compiled separately:

- **Web app** (`src/`, → `scripts/main.js` via AMD/require.js, driven by `index.html`) — lets a user paste/upload an image and tune options interactively, using Materialize CSS (`styles/main.css`, `styles/lib/materialize.min.css`) for the UI.
- **CLI** (`src-cli/`, → per-file ES5 JS) — takes `-i input.png -o output.svg`, an optional `-c path_to_settings.json` (defaults to `src-cli/settings.json`), and produces SVG/PNG/JPG output plus a JSON palette report, using `canvas` for image decoding/encoding and `svg2img` for raster export.

The processing pipeline, per `README.md` and `src-cli/settings.json`, runs in this order:
1. Optional resize (`resizeImageIfTooLarge`, `resizeImageWidth/Height`) to bound processing cost
2. K-means color quantization (`kMeansNrOfClusters`, `kMeansMinDeltaDifference`, `kMeansClusteringColorSpace`, optional `kMeansColorRestrictions` tied to named `colorAliases`)
3. Facet extraction from the quantized regions, then facet cleanup: small-facet removal (`removeFacetsSmallerThanNrOfPoints`, `removeFacetsFromLargeToSmall` controls removal order/quality tradeoff) and a facet-count cap (`maximumNumberOfFacets`)
4. Narrow pixel-strip cleanup, run iteratively (`narrowPixelStripCleanupRuns`) since facet removal can reintroduce narrow strips
5. Border segment simplification via Haar wavelet reduction (`nrOfTimesToHalveBorderSegments`) — smooths curves at the cost of detail, while segment endpoints are always preserved
6. Output rendering per `outputProfiles`: each profile independently controls labels (`svgShowLabels`), fill (`svgFillFacets`), borders (`svgShowBorders`), scale (`svgSizeMultiplier`), font (`svgFontSize`/`svgFontColor`), and output `filetype` (svg/png/jpg, with `filetypeQuality` for jpg)
7. A JSON report alongside the image output, listing each palette color's `index`, `color` (RGB), `frequency` (pixel count), and `areaPercentage`

CI (`.github/workflows/main.yml`) builds only the CLI path (Windows, Node 10.x): `tsc` in `src-cli/`, then `pkg .`, bundling the native `canvas` binaries from `node_modules/canvas/build/Release`, and publishes them as a rolling "latest" prerelease via `ncipollo/release-action`.
