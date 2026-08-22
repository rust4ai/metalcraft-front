#!/usr/bin/env bash
#
# Build the downloadable macOS app.
#
#   ./build_dmg.sh              universal (arm64 + x86_64) — what the website serves
#   ./build_dmg.sh --native     this machine's arch only; much faster, for testing
#
# The artefact is a **.dmg**, which is a macOS disk image. It is deliberately not
# an iOS build: an iOS app ships as a .ipa and cannot be installed from a web
# download at all — that route is the App Store or TestFlight — so a "download
# for Mac" link on metalcraftai.com can only ever be served by this.
#
# This is the same sequence as .github/workflows/release-macos.yml. Keep them in
# step: the workflow is what actually ships, and a local script that drifts from
# it turns "works on my machine" into a release-day surprise.
set -euo pipefail
cd "$(dirname "$0")"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "build_dmg.sh: a .dmg can only be built on macOS (this is $(uname -s))." >&2
  exit 1
fi

target="universal-apple-darwin"
if [[ "${1:-}" == "--native" ]]; then
  target="$(uname -m | sed 's/arm64/aarch64/')-apple-darwin"
  echo "build_dmg.sh: native-only build ($target) — not for distribution."
fi

for t in ${target/universal-apple-darwin/aarch64-apple-darwin x86_64-apple-darwin}; do
  rustup target list --installed | grep -qx "$t" || {
    echo "build_dmg.sh: installing rust target $t…"
    rustup target add "$t"
  }
done

# tauri-build embeds frontendDist at compile time, so the renderer has to exist
# on disk before the shell is built (same ordering as run.sh --release).
echo "build_dmg.sh: building the renderer…"
npm --prefix frontend ci
npm --prefix frontend run build

# Signing and notarisation switch on only when the environment supplies them.
# Set APPLE_CERTIFICATE, APPLE_CERTIFICATE_PASSWORD, APPLE_SIGNING_IDENTITY,
# APPLE_ID, APPLE_PASSWORD and APPLE_TEAM_ID to produce a distributable build.
if [[ -z "${APPLE_SIGNING_IDENTITY:-}" ]]; then
  echo "build_dmg.sh: no APPLE_SIGNING_IDENTITY — this .dmg will be UNSIGNED."
fi

echo "build_dmg.sh: bundling…"
( cd crates/front-tauri && npx --yes @tauri-apps/cli@^2 build --target "$target" --bundles dmg )

dmg="$(find "target/$target/release/bundle/dmg" -name '*.dmg' -maxdepth 1 2>/dev/null | head -1)"
if [[ -z "$dmg" ]]; then
  echo "build_dmg.sh: no .dmg was produced — the bundle step failed silently." >&2
  exit 1
fi

echo
echo "build_dmg.sh: $dmg"
if codesign -dv --verbose=2 "$dmg" 2>&1 | grep -q "Authority"; then
  codesign -dv --verbose=2 "$dmg" 2>&1 | grep "Authority" | head -1
else
  # Worth being blunt: an unsigned .dmg opens fine here and fails for everyone
  # else, which is the most expensive kind of "it worked when I tested it".
  echo "build_dmg.sh: UNSIGNED — Gatekeeper will refuse to open this on any Mac"
  echo "build_dmg.sh: but this one. Do not link it from metalcraftai.com."
fi
