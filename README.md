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
  plugin-manifest.json
  app/
    index.html
    assets/
```

`plugin-manifest.json` is parsed to verify that it contains valid JSON, then copied into the zip using its original bytes. Vite build output remains unchanged on disk and is mapped under `app/` only inside `widget.zip`.

## Behavior

- Runs only during `vite build`.
- Defaults Vite `base` to `"./"` when no base is configured.
- Rejects explicit non-relative Vite `base` values.
- Supports standard client app builds only, not SSR or library builds.
- Includes all files emitted to `build.outDir`, including dotfiles, except `widget.zip` itself.
- Sorts archive entries and normalizes zip timestamps for deterministic output.
- Warns when `widget.zip` approaches observed Zoho entry-count or file-size rejection ranges.

## Zoho Size Limits

Zoho uploads have been observed to reject widget archives near 300 zip entries, even when the compressed size is accepted. Zoho has also been observed to reject individual uncompressed files over 5 MB.

If `zwidget` warns about the entry count or file size, adjust your Vite build so that `widget.zip` stays below both limits:

- Keep the archive below roughly 250 entries.
- Keep each emitted file below 5 MB uncompressed.
- Avoid fully inlining dynamic imports when the resulting JavaScript file exceeds 5 MB.

For many apps, the right fix is bounded manual chunking: group small dynamic chunks into a few larger chunks, but keep each output file under Zoho's per-file limit.

To decide how to chunk your app:

- Build once without `inlineDynamicImports`.
- Inspect `widget.zip` for total entry count and uncompressed file sizes.
- Identify dependencies or app features that create many small chunks, then group those related modules into named chunks.
- Avoid grouping everything into one `vendor` chunk unless that chunk stays under 5 MB uncompressed.
- Rebuild and repeat until the archive has a comfortable entry-count margin and every emitted file is below 5 MB.

The exact groups depend on your app. Start with packages or feature areas that account for the most emitted files, then split any group that grows too large.

```ts
import { defineConfig } from "vite";
import { zwidget } from "@indev42/zwidget";

const chunkGroups = [
  {
    name: "vendor-core",
    matches: ["/node_modules/package-a/", "/node_modules/package-b/"],
  },
  {
    name: "vendor-feature",
    matches: ["/node_modules/package-c/", "/src/feature/"],
  },
];

export default defineConfig({
  plugins: [zwidget()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.split("\\").join("/");
          const group = chunkGroups.find(({ matches }) =>
            matches.some((match) => normalizedId.includes(match)),
          );

          return group?.name;
        },
      },
    },
  },
});
```

Replace the placeholder package and source paths with the modules that dominate your own build output. If a manual chunk exceeds 5 MB, split that chunk further or reduce what the app imports.

## Release Process

This repo uses Changesets for versioning and GitHub Actions for CI/CD.

Create a changeset for user-facing changes:

```sh
bun run changeset
```

When changesets are merged to `main`, the `Release` workflow creates or updates a version PR. Merge that version PR, then create a GitHub Release with a tag matching the package version to publish to npm.

The npm publish job uses Trusted Publishing/OIDC. Configure npm's trusted publisher for this package with workflow filename `release.yml` and ensure `package.json` `repository.url` exactly matches the GitHub repository.
