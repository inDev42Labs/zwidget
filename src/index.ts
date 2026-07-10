import { Buffer } from "node:buffer";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { zipSync, type Zippable, type ZipOptions } from "fflate";
import type { Plugin, ResolvedConfig, UserConfig } from "vite";

const APP_DIRECTORY = "app";
const MANIFEST_FILE = "plugin-manifest.json";
const ZIP_FILE = "widget.zip";
const ZIP_MTIME = new Date(1980, 0, 1, 0, 0, 0);
const DIRECTORY_ZIP_OPTIONS = {
  os: 3,
  attrs: 0o40755 << 16,
  level: 0,
  mtime: ZIP_MTIME,
} satisfies ZipOptions;
const FILE_ZIP_OPTIONS = {
  os: 3,
  attrs: 0o100644 << 16,
  mtime: ZIP_MTIME,
} satisfies ZipOptions;

export function zwidget(): Plugin {
  let config: ResolvedConfig | undefined;
  let manifest: Uint8Array | undefined;

  return {
    name: "zwidget",
    apply: "build",

    config(userConfig, environment): UserConfig | void {
      if (environment.command !== "build") {
        return;
      }

      if (userConfig.base === undefined) {
        return { base: "./" };
      }

      assertRelativeBase(userConfig.base);
    },

    configResolved(resolvedConfig): void {
      config = resolvedConfig;

      assertRelativeBase(resolvedConfig.base);

      if (resolvedConfig.build.ssr) {
        throw new Error(
          "zwidget supports standard client builds only; build.ssr is not supported.",
        );
      }

      if (resolvedConfig.build.lib) {
        throw new Error(
          "zwidget supports standard client builds only; build.lib is not supported.",
        );
      }
    },

    async buildStart(): Promise<void> {
      if (!config) {
        return;
      }

      manifest = await readValidatedManifest(config.root);
    },

    async closeBundle(): Promise<void> {
      if (!config || !manifest) {
        return;
      }

      const zipPath = await writeWidgetZip(config, manifest);
      config.logger.info(`zwidget: created ${path.relative(config.root, zipPath)}`);
    },
  };
}

function assertRelativeBase(base: string): void {
  if (isRelativeBase(base)) {
    return;
  }

  throw new Error(`zwidget requires a relative Vite base, but received ${JSON.stringify(base)}.`);
}

function isRelativeBase(base: string): boolean {
  return base === "" || (!base.startsWith("/") && !/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(base));
}

async function readValidatedManifest(root: string): Promise<Uint8Array> {
  const manifestPath = path.resolve(root, MANIFEST_FILE);
  let manifest: Uint8Array;

  try {
    manifest = await readFile(manifestPath);
  } catch (error) {
    if (isFileNotFoundError(error)) {
      throw new Error(`zwidget requires ${MANIFEST_FILE} at the Vite project root.`);
    }

    throw error;
  }

  try {
    JSON.parse(Buffer.from(manifest).toString("utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`zwidget requires ${MANIFEST_FILE} to contain valid JSON. ${message}`);
  }

  return manifest;
}

async function writeWidgetZip(config: ResolvedConfig, manifest: Uint8Array): Promise<string> {
  const outDir = path.resolve(config.root, config.build.outDir);
  const zipPath = path.resolve(outDir, ZIP_FILE);
  const entries = await collectBuildEntries(outDir, zipPath);

  if (!entries.some((entry) => entry.type === "file")) {
    throw new Error(`zwidget could not find any build output files in ${outDir}.`);
  }

  const archive: Zippable = {
    [MANIFEST_FILE]: [manifest, FILE_ZIP_OPTIONS],
  };

  for (const entry of entries) {
    archive[entry.archivePath] =
      entry.type === "directory"
        ? [new Uint8Array(), DIRECTORY_ZIP_OPTIONS]
        : [await readFile(entry.filePath), FILE_ZIP_OPTIONS];
  }

  await writeFile(zipPath, zipSync(archive, { mtime: ZIP_MTIME }));
  return zipPath;
}

async function collectBuildEntries(outDir: string, zipPath: string): Promise<ArchiveEntry[]> {
  const entries: ArchiveEntry[] = [
    {
      type: "directory",
      archivePath: `${APP_DIRECTORY}/`,
    },
  ];

  try {
    await walkBuildOutput(outDir, outDir, zipPath, entries);
  } catch (error) {
    if (isFileNotFoundError(error)) {
      throw new Error(`zwidget could not find Vite build output directory ${outDir}.`);
    }

    throw error;
  }

  return entries.sort((a, b) => a.archivePath.localeCompare(b.archivePath));
}

async function walkBuildOutput(
  root: string,
  directory: string,
  zipPath: string,
  entries: ArchiveEntry[],
): Promise<void> {
  const directoryEntries = await readdir(directory, { withFileTypes: true });

  for (const entry of directoryEntries.sort((a, b) => a.name.localeCompare(b.name))) {
    const filePath = path.resolve(directory, entry.name);

    if (entry.isDirectory()) {
      entries.push({
        type: "directory",
        archivePath: `${APP_DIRECTORY}/${toZipPath(path.relative(root, filePath))}/`,
      });
      await walkBuildOutput(root, filePath, zipPath, entries);
      continue;
    }

    if (!entry.isFile() || filePath === zipPath) {
      continue;
    }

    entries.push({
      type: "file",
      filePath,
      archivePath: `${APP_DIRECTORY}/${toZipPath(path.relative(root, filePath))}`,
    });
  }
}

function toZipPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function isFileNotFoundError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

type ArchiveEntry = ArchiveDirectory | ArchiveFile;

interface ArchiveDirectory {
  type: "directory";
  archivePath: string;
}

interface ArchiveFile {
  type: "file";
  filePath: string;
  archivePath: string;
}
