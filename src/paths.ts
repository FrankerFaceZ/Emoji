import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '..');

/** Downloaded upstream sources and tools. Safe to delete; never committed. */
export const CACHE = path.join(ROOT, '.cache');
export const SOURCES_DIR = path.join(CACHE, 'sources');
export const TOOLS_DIR = path.join(CACHE, 'tools');

/**
Build output, laid out the way it is published under /static/emoji/ on the
CDN, plus a few files that only go into the GitHub release. Never committed.
*/
export const DIST = path.join(ROOT, 'dist');
export const DIST_IMAGES = path.join(DIST, 'images');
export const DIST_PREVIEW = path.join(DIST, 'preview');

/** Published name of the compact data file. v3.2.json stays frozen on the CDN for old clients. */
export const PUBLISHED_DATA_NAME = 'v3.3.json';

/** The compact data the client downloads. */
export const COMPACT_FILE = path.join(DIST, PUBLISHED_DATA_NAME);
/** The same data, spelled out, for people (release asset only). */
export const DATA_FILE = path.join(DIST, 'emoji.json');
/** Source image hashes per style and key, to list changed artwork (release asset only). */
export const MANIFEST_FILE = path.join(DIST, 'manifest.json');

/** Committed files. */
export const SOURCES_FILE = path.join(ROOT, 'sources.json');
export const ALLOW_FILE = path.join(ROOT, 'allow.json');
export const SHIPPED_FILE = path.join(ROOT, 'shipped.json');
export const PACKAGE_FILE = path.join(ROOT, 'package.json');

/** Where the 2020 build kept its data, read from git history until master has a shipped.json. */
export const LEGACY_COMPACT_FILE = path.join(ROOT, 'emoji-compact.json');

/** Latest published release, for listing changed artwork. */
export const RELEASE_BASE = 'https://github.com/FrankerFaceZ/Emoji/releases/latest/download';
