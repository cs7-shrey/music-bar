# Music Bar for NixOS (and Nix on other Linux), built from source.
#
# Builds with Electron Forge as on any other platform, then runs the app
# with nixpkgs' Electron instead of the one Forge downloads (which wouldn't
# run on NixOS). The layout mirrors a packaged build: resources/ holds
# app.asar beside the browser extension, its native messaging host and the
# icons, which the app finds next to app.asar (src/main/resources.ts).
{
  lib,
  stdenv,
  fetchPnpmDeps,
  pnpmConfigHook,
  pnpm_12,
  nodejs_24,
  electron_44,
  makeWrapper,
  makeDesktopItem,
  copyDesktopItems,
  zip,
}:

let
  electron = electron_44;
  packageJson = lib.importJSON ../package.json;
  # Electron's name for the architecture.
  arch = if stdenv.hostPlatform.isAarch64 then "arm64" else "x64";
in
stdenv.mkDerivation (finalAttrs: {
  pname = "music-bar";
  inherit (packageJson) version;

  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [
      ../assets
      ../extension
      ../native-host
      ../scripts
      ../src
      ../forge.config.ts
      ../index.html
      ../package.json
      ../pnpm-lock.yaml
      ../pnpm-workspace.yaml
      ../tsconfig.json
      ../tsconfig.node.json
      ../tsconfig.web.json
      ../vite.main.config.mjs
      ../vite.preload.config.mjs
      ../vite.renderer.config.mjs
    ];
  };

  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs) pname version src;
    pnpm = pnpm_12;
    fetcherVersion = 3;
    hash = "sha256-fhILsr3qtqVQ9RhHegaP1hyGJlq6smx7DUoRXO67X+A=";
  };

  nativeBuildInputs = [
    nodejs_24
    pnpmConfigHook
    pnpm_12
    makeWrapper
    copyDesktopItems
    zip
  ];

  env = {
    # Electron's npm package fetches its binary on first launch; nothing here
    # launches it, and the build has no network anyway.
    ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
    # pnpm would otherwise fetch the exact version in packageManager.
    npm_config_manage_package_manager_versions = "false";
  };

  buildPhase = ''
    runHook preBuild

    # Forge's packager wants an Electron zip to package the app into; give
    # it nixpkgs' Electron under the version the lockfile names. Only
    # resources/ is kept from what it makes (see installPhase).
    electronVersion=$(node -p "require('./node_modules/electron/package.json').version")
    # Writable copies: the packager edits the files it unzips.
    cp -r ${electron.dist} "$TMPDIR/electron-dist"
    chmod -R u+w "$TMPDIR/electron-dist"
    mkdir -p "$TMPDIR/electron-zip"
    (cd "$TMPDIR/electron-dist" && zip -q -0 -r "$TMPDIR/electron-zip/electron-v$electronVersion-linux-${arch}.zip" .)
    MUSIC_BAR_ELECTRON_ZIP_DIR="$TMPDIR/electron-zip" pnpm exec electron-forge package --platform linux --arch ${arch}

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p $out/share/music-bar
    cp -r "out/Music Bar-linux-${arch}/resources" $out/share/music-bar/resources

    # MUSIC_BAR_LAUNCHER: what open-at-login runs (src/main/login-item.ts);
    # a command on PATH, so it survives updates to new store paths.
    # ELECTRON_RUN_AS_NODE: set in terminals of Electron apps such as VS
    # Code, where it would start the app as plain Node.
    makeWrapper ${lib.getExe electron} $out/bin/music-bar \
      --add-flags $out/share/music-bar/resources/app.asar \
      --unset ELECTRON_RUN_AS_NODE \
      --set ELECTRON_FORCE_IS_PACKAGED 1 \
      --set MUSIC_BAR_LAUNCHER music-bar \
      --add-flags "\''${NIXOS_OZONE_WL:+\''${WAYLAND_DISPLAY:+--ozone-platform-hint=auto --enable-features=WaylandWindowDecorations --enable-wayland-ime=true}}" \
      --inherit-argv0

    install -Dm644 assets/icon.png $out/share/icons/hicolor/512x512/apps/music-bar.png

    runHook postInstall
  '';

  desktopItems = [
    (makeDesktopItem {
      name = "music-bar";
      desktopName = "Music Bar";
      genericName = "Music Controller";
      comment = finalAttrs.meta.description;
      exec = "music-bar %U";
      icon = "music-bar";
      categories = [
        "AudioVideo"
        "Audio"
      ];
    })
  ];

  meta = {
    description = "Raycast-style launcher for YouTube Music in your browser";
    homepage = "https://github.com/cs7-shrey/music-bar";
    license = lib.licenses.mit;
    mainProgram = "music-bar";
    platforms = [
      "x86_64-linux"
      "aarch64-linux"
    ];
  };
})
