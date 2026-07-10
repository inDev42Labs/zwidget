# zwidget

A Vite plugin for creating Zoho widget build artifacts.

## Usage

```ts
import { defineConfig } from "vite";
import { zwidget } from "@indev42/zwidget";

export default defineConfig({
  plugins: [zwidget()],
});
```

Run `vite build` with a valid `plugin-manifest.json` at the Vite project root. The plugin writes `widget.zip` to Vite's resolved `build.outDir`.

## Artifact Layout

```txt
widget.zip
  widget/
    plugin-manifest.json
    app/
      index.html
      assets/
```

`plugin-manifest.json` is parsed to verify that it contains valid JSON, then copied into the zip using its original bytes. Vite build output remains unchanged on disk and is mapped under `widget/app/` only inside `widget.zip`.

## Behavior

- Runs only during `vite build`.
- Defaults Vite `base` to `"./"` when no base is configured.
- Rejects explicit non-relative Vite `base` values.
- Supports standard client app builds only, not SSR or library builds.
- Includes all files emitted to `build.outDir`, including dotfiles, except `widget.zip` itself.
- Sorts archive entries and normalizes zip timestamps for deterministic output.

## Release Process

This repo uses Changesets for versioning and GitHub Actions for CI/CD.

Create a changeset for user-facing changes:

```sh
bun run changeset
```

When changesets are merged to `main`, the `Release` workflow creates or updates a version PR. Merge that version PR, then create a GitHub Release with a tag matching the package version to publish to npm.

The npm publish job uses Trusted Publishing/OIDC. Configure npm's trusted publisher for this package with workflow filename `release.yml` and ensure `package.json` `repository.url` exactly matches the GitHub repository.
