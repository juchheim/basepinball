import * as THREE from 'three/webgpu';

/**
 * Loads texture slots built by tools/build-assets.ts (docs/MVP/05 § 5). Each slot has several
 * widths; the renderer asks for the size its quality tier wants.
 */

interface ManifestEntry {
  files: Record<string, string>;
  aspect: number;
}

let manifest: Promise<Record<string, ManifestEntry>> | null = null;
const loader = new THREE.TextureLoader();

function getManifest(): Promise<Record<string, ManifestEntry>> {
  manifest ??= fetch(`${import.meta.env.BASE_URL}tex/manifest.json`).then((r) => {
    if (!r.ok) throw new Error(`texture manifest: ${r.status}`);
    return r.json() as Promise<Record<string, ManifestEntry>>;
  });
  return manifest;
}

/** Load `slot` at the largest available width not above `maxWidth` (or the smallest). */
export async function loadSlot(
  slot: string,
  maxWidth: number,
  srgb = true,
): Promise<THREE.Texture | null> {
  try {
    const m = await getManifest();
    const entry = m[slot];
    if (!entry) return null;
    const widths = Object.keys(entry.files)
      .map(Number)
      .sort((a, b) => a - b);
    const width = [...widths].reverse().find((w) => w <= maxWidth) ?? widths[0]!;
    const tex = await loader.loadAsync(`${import.meta.env.BASE_URL}tex/${entry.files[width]}`);
    if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  } catch (err) {
    console.warn(`texture slot ${slot} unavailable`, err);
    return null;
  }
}
