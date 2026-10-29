/**
 * Resolve a public-asset path against Vite `base` (e.g. `/ABI-Merchant/` on GitHub Pages).
 * Data JSON stores root-absolute paths like `/sounds/foo.ogg`; without this they 404 on Pages.
 */
export function assetUrl(path: string): string {
  if (!path) return path;
  if (/^(https?:|blob:|data:)/i.test(path)) return path;
  const base = import.meta.env.BASE_URL || '/';
  const normalized = path.startsWith('/') ? path.slice(1) : path;
  const baseSlash = base.endsWith('/') ? base : `${base}/`;
  return `${baseSlash}${normalized}`;
}
