# Orbit Core runtime and platform portability

Added in Update 4.0.4, which resolved the portability blocker Update 4.0.3
found: the only bundled Swiss Ephemeris executable was macOS/arm64, and Vercel
functions run Linux x64.

---

## 1. The boundary

Nothing above `lib/astro/` knows that an executable exists.

```
Orbit application
  (charts · transits · Current Sky · fortune · Ask Orbit evidence)
        ↓
lib/astro/ephemeris.js          shapes and parses only
        ↓
lib/astro/runtime/resolve.js    platform → executable + data paths
        ↓
lib/astro/runtime/exec.js       validation · spawn · timeout · classification
        ↓
vendor/orbit-axis-engine/bin/<platform>/swetest
        ↓
structured calculation result
```

Before 4.0.4 `ephemeris.js` hardcoded one path and called `execFileSync`
directly. There is now exactly one place that resolves a binary, so chart,
transit, sky, fortune, and Ask Orbit code cannot drift apart or pick different
runtimes.

| File | Responsibility |
|---|---|
| `vendor/orbit-axis-engine/src/adapters/swiss-ephemeris/manifest.json` | Which runtimes exist, their checksums, origin, licence status |
| `runtime/resolve.js` | Platform detection, executable + data resolution, permission and checksum verification |
| `runtime/exec.js` | Input validation, argument allow-list, spawn, timeout, output cap, error classification, customer-safe messages |
| `ephemeris.js` | Argument construction and output parsing only |

---

## 2. Supported platforms

| Runtime | OS / arch | Linkage | Purpose | Status |
|---|---|---|---|---|
| `darwin-arm64` | macOS Apple Silicon | dynamic | Local development | Supported |
| `linux-x64` | Linux x86-64 | **static** | Vercel functions, CI, containers | Supported |
| `darwin-x64` | macOS Intel | — | — | Not shipped: no Intel Mac to verify on |
| `linux-arm64` | Linux ARM | — | — | Not shipped: Vercel is x64 and nothing needs it |

Unsupported platforms fail with a named `unsupported_platform` error. Orbit
**never** falls back to a binary built for another operating system.

### Why the Linux build is statically linked

Vercel's Node runtime is Amazon Linux based; the build container was Debian
bookworm. A dynamically linked binary would depend on the build host's glibc
version and could fail at runtime on a different one. The static build removes
that class of failure entirely — verified by running it on **busybox**, which
ships no glibc at all.

### Provenance of the Linux executable

Built from official Astrodienst source. No binary was downloaded from any
mirror.

- Repository: `https://github.com/aloistr/swisseph`
- Tag: `v2.10.03`, commit `175e1fc`
- Target: upstream `Makefile`'s `swetests` (static) target
- Container: `debian:bookworm-slim`, `--platform linux/amd64`, gcc 12.2.0

Reproduce:

```bash
docker run --rm --platform linux/amd64 -v "$PWD/out":/out debian:bookworm-slim bash -c '
  apt-get update -qq && apt-get install -y -qq build-essential git ca-certificates
  git clone --depth 1 --branch v2.10.03 https://github.com/aloistr/swisseph /src
  cd /src && make swetests && cp swetests /out/swetest-linux-x64'
```

Neither source archives nor build debris are committed — only the resulting
executable.

---

## 3. Integrity

`vendor/orbit-axis-engine/src/adapters/swiss-ephemeris/manifest.json` records,
per runtime: OS, architecture,
relative executable path, Swiss Ephemeris version, SHA-256, linkage, origin,
supported status, and verification date. It also records the SHA-256 of each
`.se1` data file.

Checksums are real digests. A test fails the build if any of them ever becomes
a placeholder.

```bash
npm run orbit:runtime:check                      # verify this machine
npm run orbit:runtime:check -- --json            # machine-readable
npm run orbit:runtime:check -- --print-checksums # regenerate after a rebuild
```

It validates platform support, manifest integrity, presence of every declared
artifact, permissions, checksums, ephemeris data, a real smoke calculation, and
parser compatibility. It contacts nothing.

---

## 4. Execution safety

- Arguments are passed as an **array** to `execFileSync` with `shell: false`.
  No shell is ever involved, so metacharacters cannot become commands. An
  argument allow-list rejects malformed input as defence in depth.
- Dates, coordinates, and house systems are range-checked *before* a process
  starts.
- A strict timeout (10s default) and an output cap (1 MB) are always applied.
- `cwd` is pinned to the ephemeris directory, so a caller's working directory
  cannot influence data lookup.
- Failures are classified distinctly: `unsupported_platform`, `runtime_missing`,
  `runtime_not_executable`, `runtime_wrong_platform`, `runtime_checksum_mismatch`,
  `ephemeris_data_missing`, `ephemeris_data_corrupt`, `timeout`, `invalid_input`,
  `invalid_output`, `output_too_large`, `nonzero_exit`, `execution_failed`.
- Customer-facing messages contain no path, no native error text, and no birth
  data. Diagnostics record the failure, never the input.
- An incomplete planet set or missing houses is **rejected**, not returned. A
  truncated run must never surface as a structurally valid chart.

**A calculation failure never becomes invented astrology.** The deterministic
Ask Orbit presenter is a *wording* fallback for evidence that was already
calculated — it is not a substitute for astronomy that failed. With no chart,
Ask Orbit produces zero astrological evidence and shows `limitation:` rows
explaining what it could not use.

---

## 5. Calculation parity

Fixture: `test/fixtures/calculation-parity.json`, generated on `darwin-arm64`
by `node scripts/generate-parity-fixture.mjs`. The same assertions run on both
platforms; if both pass, the runtimes agree.

Measured difference between macOS (clang, dynamic) and Linux (gcc 12, static)
builds of 2.10.03 against the **same** `.se1` files, over 440 compared values:

| Quantity | Observed difference | Test tolerance |
|---|---|---|
| Planetary longitude | **0.0°** (bit-identical) | 1e-6° (0.0036 arcsec) |
| Speed | 1e-7 °/day (last printed digit) | 1e-6 °/day |
| Sign, degree, minute, retrograde | identical | exact match required |
| House cusps, Ascendant, MC | **0.0°** | 1e-6° |
| Lunar phase, illumination | identical | 0.01% |
| Sky snapshot hash | identical | exact match required |
| Transit orb + applying/separating | identical | 1e-6° / exact |

Tolerances are orders of magnitude looser than the observed difference, purely
to absorb last-digit formatting. **They must not be widened to make a failing
test pass.**

> An early smoke run did show ~1e-6° drift. The cause was the *build
> container's own* bundled ephemeris data, not the compiler. With Orbit's
> `.se1` files the results are identical. That is precisely the kind of
> difference these tolerances exist to expose rather than hide.

Cases cover: known and unknown birth time, northern and southern latitude,
eastern and western longitude, both sides of a day boundary, a leap day, the
equator, retrograde motion, houses, far past (1911) and far future (2040), and
a no-houses case.

---

## 6. Verifying on Linux

Exact commands used, all against throwaway containers. No existing Orbit or
Lorehouse Supabase container was touched.

```bash
# runtime check on the deployment target architecture
docker run --rm --platform linux/amd64 -v "$PWD":/work:ro -w /work \
  node:22-slim node scripts/runtime-check.js

# whole calculation chain: natal → sky → transits → Ask evidence → fortune
docker run --rm --platform linux/amd64 -v "$PWD":/work:ro -w /work \
  node:22-slim node scripts/core-smoke.js

# the full test suite
docker run --rm --platform linux/amd64 -v "$PWD":/work:ro -w /work \
  -e ORBIT_ENVIRONMENT=test -e SUPABASE_URL=http://127.0.0.1:55321 \
  node:22-slim node --test

# static-linkage proof: busybox has no glibc
docker run --rm --platform linux/amd64 -v "$PWD":/work:ro \
  busybox:1.36 /work/vendor/orbit-axis-engine/bin/linux-x64/swetest \
  -edir/work/vendor/orbit-axis-engine/ephemeris \
  -b01.01.2000 -ut12:00:00 -p0 -fPlZs -head
```

---

## 7. Vercel packaging

Vercel's Node builder traces `import` statements. The executable and `.se1`
data are opened **by path**, not imported, so tracing misses them. They ship
only because `vercel.json` force-includes them:

```json
"functions": { "api/index.js": { "includeFiles": "vendor/orbit-axis-engine/**" } }
```

`.vercelignore` excludes `vendor/orbit-axis-engine/bin/darwin-arm64/` — a macOS binary cannot
run on a Linux function and should not be in a public deployment.

`lib/deploy/bundle.js` models the upload from the real `.vercelignore` and
`vercel.json`, and both `npm run build` and `test/deployment-packaging.test.js`
assert against it. It is a model, not a substitute for `npx vercel build`.

---

## 8. Regenerating after a Swiss Ephemeris upgrade

1. Rebuild each executable from the new upstream tag (§2).
2. `npm run orbit:runtime:check -- --print-checksums`, paste into the manifest,
   update `swissEphemerisVersion`, `tag`, `commit`, and `verified`.
3. `node scripts/generate-parity-fixture.mjs` — **only** when the version change
   is intentional, never to silence a failing test.
4. Run the full suite on macOS and inside a Linux container.
5. `npm run deploy:check`.
