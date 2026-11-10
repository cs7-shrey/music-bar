{
  description = "Music Bar: a Raycast-style launcher for YouTube Music in your browser";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      forEachSystem = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      packages = forEachSystem (pkgs: {
        music-bar = pkgs.callPackage ./nix/package.nix { };
        default = self.packages.${pkgs.stdenv.hostPlatform.system}.music-bar;
      });

      # For NixOS or home-manager: `nixpkgs.overlays = [ music-bar.overlays.default ];`,
      # then `pkgs.music-bar`.
      overlays.default = final: _prev: { music-bar = final.callPackage ./nix/package.nix { }; };

      # `nix develop`: pnpm dev with nixpkgs' Electron (the one Electron's npm
      # package downloads doesn't run on NixOS), and dpkg for `pnpm make`.
      devShells = forEachSystem (pkgs: {
        default = pkgs.mkShell {
          packages = [
            pkgs.nodejs_24
            pkgs.pnpm_12
            pkgs.dpkg
            pkgs.fakeroot
          ];
          ELECTRON_OVERRIDE_DIST_PATH = "${pkgs.electron_44}/bin";
        };
      });
    };
}
