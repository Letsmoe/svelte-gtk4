# Maintainer: Moritz Utcke <moritz.utcke@gmx.de>
#
# Builds from the checkout this PKGBUILD lives in (the SDK and UI kit are local
# git submodules, so there is no upstream tarball/remote to fetch yet). Run from
# the repo root:  makepkg -si
#
# The dependency arrays below are the source of truth for distribution; see
# DEPENDENCIES.md for the per-component rationale.

pkgname=neoshell
pkgver=0
pkgrel=1
pkgdesc="Wayland desktop shell rendered via a C++/WPE host, driven by a TypeScript host on bun"
arch=('x86_64')
url="https://github.com/neoworks/neoshell"
license=('MIT')

# Runtime shared libraries. wpewebkit pulls the rest of the render host's closure
# (gstreamer, icu, harfbuzz, libsoup, …) transitively, so only direct deps appear.
depends=(
  'bun'             # runs the host and the emit CLI
  'wpewebkit'       # libWPEWebKit-2.0 / wpe-platform-2.0 — render host web engine
  'libwpe'          # libwpe-1.0.so.1
  'wayland'         # libwayland-client/cursor/egl — render host + wallpaper daemon
  'libdrm'          # dmabuf / DRM
  'mesa'            # libgbm
  'libglvnd'        # libEGL / libGLX dispatch
  'libxkbcommon'    # keyboard mapping
)

# Toolchains + headers needed only to compile.
makedepends=(
  'go'              # notifications D-Bus bridge
  'rust'            # cargo: wallpaper daemon
  'go-task'         # Taskfile.yml build orchestrator
  'base-devel'      # g++ for the render host
  'make'
  'pkgconf'         # pkg-config in the render host Makefile
  'nlohmann-json'   # JSON header for the render host control protocol
)

# A wlroots-based compositor (Hyprland, Sway, river, …) implementing
# wlr-layer-shell + linux-dmabuf is required at runtime but is not a package dep.
optdepends=(
  'gst-plugins-good: <video>/<audio> playback in web surfaces'
  'gst-plugins-bad: extra media codecs in web surfaces'
)

source=()
sha256sums=()

pkgver() {
  cd "$startdir"
  printf '0.r%s.%s' "$(git rev-list --count HEAD)" "$(git rev-parse --short HEAD)"
}

build() {
  cd "$startdir"
  bun install
  task build
}

package() {
  cd "$startdir"

  install -Dm755 apps/render-host/neoshell-render                     "$pkgdir/usr/lib/neoshell/neoshell-render"
  install -Dm755 apps/bg/target/release/neoshell-bg                   "$pkgdir/usr/lib/neoshell/neoshell-bg"

  # The host, kernel, surface runtime, and extensions run from source on bun.
  install -d "$pkgdir/usr/lib/neoshell"
  cp -r apps/host apps/extensions packages node_modules package.json  "$pkgdir/usr/lib/neoshell/"

  install -Dm755 /dev/stdin "$pkgdir/usr/bin/neoshell" <<'EOF'
#!/bin/sh
export NEOSHELL_RENDER_BIN="${NEOSHELL_RENDER_BIN:-/usr/lib/neoshell/neoshell-render}"
export NEOSHELL_EXTENSIONS="${NEOSHELL_EXTENSIONS:-/usr/lib/neoshell/extensions}"
exec bun /usr/lib/neoshell/host/src/main.ts "$@"
EOF

  install -Dm755 /dev/stdin "$pkgdir/usr/bin/neoshell-emit" <<'EOF'
#!/bin/sh
exec bun /usr/lib/neoshell/host/src/emit.ts "$@"
EOF

  ln -s /usr/lib/neoshell/neoshell-bg "$pkgdir/usr/bin/neoshell-bg"
}
