import { ensureBlingAuthorized, fetchFromBling } from './server-bling.js';
import {
  isBlingDailyQuotaExceeded,
  isBlingRateLimitError,
  tryAcquireHeavyBlingLock,
  releaseHeavyBlingLock,
} from './lib/blingToken.js';
import type { Product } from './src/types/index.js';

const IMAGE_STORE_VERSION = 5;
const DETAIL_CHECK_COOLDOWN_MS = 45 * 1000;

export interface BlingImageStore {
  version?: number;
  updatedAt: string;
  bySku: Record<string, string[]>;
  byName: Record<string, string[]>;
  byId: Record<string, string[]>;
  checkedAtById?: Record<string, number>;
  summaryKeyById?: Record<string, string>;
}

let cachedImageStore: BlingImageStore | null = null;
let lastSyncCompletedAt = 0;

export function getLastBlingImageSyncTime(): number {
  return lastSyncCompletedAt;
}

export function getImageStoreSnapshot(): BlingImageStore {
  return loadImageStore();
}

export function isExpiredPresignedUrl(url?: string): boolean {
  const clean = String(url || '').trim();
  if (!clean || !clean.startsWith('http')) return false;
  try {
    const parsed = new URL(clean);
    const expiresParam = parsed.searchParams.get('Expires');
    if (expiresParam) {
      const expSec = Number(expiresParam);
      if (Number.isFinite(expSec) && expSec > 0 && expSec * 1000 <= Date.now()) {
        return true;
      }
    }
    const amzDate = parsed.searchParams.get('X-Amz-Date');
    const amzExpires = parsed.searchParams.get('X-Amz-Expires');
    if (amzDate && amzExpires) {
      const m = amzDate.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
      if (m) {
        const startMs = Date.UTC(
          Number(m[1]),
          Number(m[2]) - 1,
          Number(m[3]),
          Number(m[4]),
          Number(m[5]),
          Number(m[6])
        );
        const ttlSec = Number(amzExpires);
        if (Number.isFinite(ttlSec) && startMs + ttlSec * 1000 <= Date.now()) {
          return true;
        }
      }
    }
  } catch {
    // ignore
  }
  return false;
}

/**
 * Clears the in-memory Bling image store and resets sync timestamp
 * so original high-res images are re-fetched live from Bling.
 */
export function clearImageCache(_preserveManualUploads: boolean = false): BlingImageStore {
  const fresh: BlingImageStore = {
    version: IMAGE_STORE_VERSION,
    updatedAt: new Date().toISOString(),
    bySku: {},
    byName: {},
    byId: {},
    checkedAtById: {},
    summaryKeyById: {},
  };

  lastSyncCompletedAt = 0;
  saveImageStore(fresh);
  console.log('[Bling Images] In-memory image cache cleared cleanly.');
  return fresh;
}

export function loadImageStore(): BlingImageStore {
  if (cachedImageStore && cachedImageStore.version === IMAGE_STORE_VERSION) {
    return cachedImageStore;
  }

  cachedImageStore = {
    version: IMAGE_STORE_VERSION,
    updatedAt: new Date().toISOString(),
    bySku: {},
    byName: {},
    byId: {},
    checkedAtById: {},
    summaryKeyById: {},
  };
  return cachedImageStore;
}

export function saveImageStore(store: BlingImageStore): void {
  store.version = IMAGE_STORE_VERSION;
  store.updatedAt = new Date().toISOString();
  cachedImageStore = store;
}

export function removeProductFromImageStore(identifier: {
  id?: string | number;
  sku?: string;
  name?: string;
}): boolean {
  const store = loadImageStore();
  let changed = false;
  if (identifier.id !== undefined && identifier.id !== null) {
    const idKey = String(identifier.id).trim();
    if (idKey) {
      if (store.byId[idKey]) {
        delete store.byId[idKey];
        changed = true;
      }
      if (store.checkedAtById?.[idKey]) {
        delete store.checkedAtById[idKey];
        changed = true;
      }
      if (store.summaryKeyById?.[idKey]) {
        delete store.summaryKeyById[idKey];
        changed = true;
      }
    }
  }
  if (identifier.sku) {
    const skuKey = String(identifier.sku).toUpperCase().trim();
    if (skuKey && store.bySku[skuKey]) {
      delete store.bySku[skuKey];
      changed = true;
    }
  }
  if (identifier.name) {
    const nameKey = normalizeProductName(identifier.name);
    if (nameKey && store.byName[nameKey]) {
      delete store.byName[nameKey];
      changed = true;
    }
  }
  if (changed) {
    saveImageStore(store);
  }
  return changed;
}

export function isLegacyExternalUrl(url?: string): boolean {
  if (!url || typeof url !== 'string') return false;
  const u = url.toLowerCase();
  return u.includes('mitiendanube.com') || u.includes('tiendanube.com');
}

export function isPlaceholderImageUrl(url?: string): boolean {
  if (!url || typeof url !== 'string') return true;
  const u = url.trim().toLowerCase();
  if (!u) return true;
  if (u.includes('unsplash.com') || u.includes('streetstore-fallback') || u.includes('placeholder')) return true;
  if (
    u.startsWith('/src/assets/') ||
    u.startsWith('/assets/uploads/') ||
    u.startsWith('/assets/aistudio/')
  ) {
    return true;
  }
  return false;
}

/**
 * Normalizes product name for robust matching (e.g. "TENIS TESLA HERTZ BLACK:39" -> "tenis tesla hertz black")
 */
export function normalizeProductName(name: string): string {
  let n = (name || '').toLowerCase().trim();
  if (n.includes(':')) n = n.split(':')[0].trim();
  if (n.includes(' // ')) n = n.split(' // ')[0].trim();
  n = n.replace(/\s+-\s+(pp|p|m|g|gg|xg|xgg|g1|g2|g3|g4|\d{2})$/i, '').trim();
  return n.replace(/\s+/g, ' ');
}

const RESIZE_QUERY_PARAMS = new Set([
  'w', 'h', 'width', 'height', 'max-w', 'max-h', 'maxwidth', 'maxheight',
  'size', 'resize', 'quality', 'q', 'auto', 'fit', 'crop', 'dpr',
  'compress', 'compression', 'format', 'fm', 'fl', 'scale',
  'thumb', 'thumbnail', 'mini', 'miniatura', 'mode', 'blur', 'pixel', 'opt', 'optimize'
]);

/**
 * Strips resize/compression query parameters and filename suffixes from external image URLs
 * while preserving signed URL tokens/auth params (X-Amz-*, Signature, Expires, Policy, etc.).
 */
export function stripResizeAndCompressionParams(rawUrl: string): string {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed || trimmed.startsWith('data:image') || trimmed.startsWith('/')) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    const keysToDelete: string[] = [];
    parsed.searchParams.forEach((_val, key) => {
      if (RESIZE_QUERY_PARAMS.has(key.toLowerCase())) {
        keysToDelete.push(key);
      }
    });
    for (const key of keysToDelete) {
      parsed.searchParams.delete(key);
    }

    // Remove common resize/compression path suffixes before extension (skipping mitiendanube fixed asset hashes)
    if (!parsed.hostname.includes('mitiendanube.com') && !parsed.hostname.includes('tiendanube.com')) {
      parsed.pathname = parsed.pathname.replace(
        /(?:_miniatura|-miniatura|_mini|-mini|_thumb|-thumb|_small|-small|_medium|-medium|_low|-low|_\d{2,4}x\d{2,4}|-\d{2,4}x\d{2,4})(?=\.(?:jpe?g|png|webp|avif|gif)$)/i,
        ''
      );
    }

    return parsed.toString();
  } catch {
    return trimmed;
  }
}

export function isThumbnailLikeUrl(url: string): boolean {
  const u = (url || '').toLowerCase();
  if (!u) return false;
  if (
    u.includes('miniatura') ||
    u.includes('/thumb/') ||
    u.includes('_thumb.') ||
    u.includes('-thumb.') ||
    u.includes('_mini.') ||
    u.includes('-mini.') ||
    /-(?:50|100|150|200|240|250|300|320|480)-\d+\.(?:jpe?g|png|webp|avif)/i.test(u)
  ) {
    return true;
  }
  // Bling S3 thumbnails live under /<tenant>/t/<hash> or /p/<hash> while full-res originals omit /t/ & /p/
  if (u.includes('orgbling.s3.amazonaws.com') || u.includes('bling.com')) {
    try {
      const parsed = new URL(u);
      if (
        /\/(?:t|p|m)\/[^/]+$/i.test(parsed.pathname) ||
        /\/(?:t|p|m)\/[a-z0-9_-]{8,}/i.test(parsed.pathname)
      ) {
        return true;
      }
    } catch {
      if (/\/(?:t|p|m)\/[a-z0-9_-]{8,}/i.test(u)) return true;
    }
  }
  return false;
}

const AUTH_SIGNATURE_PARAMS = new Set([
  'awsaccesskeyid',
  'expires',
  'signature',
  'x-amz-algorithm',
  'x-amz-credential',
  'x-amz-date',
  'x-amz-expires',
  'x-amz-signedheaders',
  'x-amz-signature',
  'x-amz-security-token'
]);

/**
 * Produces a canonical comparison key for image deduplication so the exact same
 * Bling S3 object with different Expires/Signature timestamps isn't saved multiple times.
 */
export function getCanonicalImageKey(url: string): string {
  const clean = (url || '').trim();
  if (!clean || clean.startsWith('data:image') || clean.startsWith('/')) return clean;
  try {
    const parsed = new URL(clean);
    const toDelete: string[] = [];
    parsed.searchParams.forEach((_v, k) => {
      if (AUTH_SIGNATURE_PARAMS.has(k.toLowerCase())) {
        toDelete.push(k);
      }
    });
    for (const k of toDelete) {
      parsed.searchParams.delete(k);
    }
    return parsed.toString();
  } catch {
    return clean;
  }
}

function normalizeImageUrl(val: any, allowThumbnailFallback: boolean = false): string | null {
  if (!val) return null;
  if (typeof val === 'object') {
    const primaryCandidate =
      val.link ||
      val.url ||
      val.caminho ||
      val.src ||
      val.imagemURL ||
      val.urlImagem ||
      val.foto ||
      val.anexo?.link ||
      val.anexo?.url;
    if (typeof primaryCandidate === 'string' && primaryCandidate.trim()) {
      return normalizeImageUrl(primaryCandidate, allowThumbnailFallback);
    }
    if (allowThumbnailFallback) {
      const thumbCandidate = val.linkMiniatura || val.thumbnail;
      if (typeof thumbCandidate === 'string' && thumbCandidate.trim()) {
        return normalizeImageUrl(thumbCandidate, true);
      }
    }
    return null;
  }
  if (typeof val !== 'string') return null;
  let clean = val.trim();
  if (!clean || clean === 'null' || clean === 'undefined') return null;
  if (clean.startsWith('//')) {
    clean = `https:${clean}`;
  }
  if (
    clean.startsWith('http://') ||
    clean.startsWith('https://') ||
    clean.startsWith('/') ||
    clean.startsWith('data:image')
  ) {
    return stripResizeAndCompressionParams(clean);
  }
  return null;
}

function extractImagesFromSingleObject(
  item: any,
  urls: string[],
  allowThumbnailFallback: boolean = false
) {
  if (!item || typeof item !== 'object') return;

  const push = (val: any, forceAllowThumb: boolean = allowThumbnailFallback) => {
    const normalized = normalizeImageUrl(val, forceAllowThumb);
    if (normalized && !urls.includes(normalized)) {
      urls.push(normalized);
    }
  };

  const pushArray = (arr: any, forceAllowThumb: boolean = allowThumbnailFallback) => {
    if (!Array.isArray(arr)) return;
    const sorted = [...arr].sort((a: any, b: any) => (a?.ordem ?? 0) - (b?.ordem ?? 0));
    for (const entry of sorted) {
      push(entry, forceAllowThumb);
    }
  };

  if (!allowThumbnailFallback) {
    if (item.midia) {
      const imagens = item.midia.imagens;
      if (Array.isArray(imagens)) {
        pushArray(imagens, false);
      } else if (imagens && typeof imagens === 'object') {
        if (Array.isArray(imagens.internas)) {
          const sortedInternas = [...imagens.internas].sort((a: any, b: any) => (a?.ordem ?? 0) - (b?.ordem ?? 0));
          for (const imgObj of sortedInternas) {
            if (typeof imgObj === 'string') {
              push(imgObj, false);
            } else if (imgObj && typeof imgObj === 'object') {
              push(imgObj.link || imgObj.url, false);
            }
          }
        }
        if (Array.isArray(imagens.externas)) {
          const sortedExternas = [...imagens.externas].sort((a: any, b: any) => (a?.ordem ?? 0) - (b?.ordem ?? 0));
          for (const imgObj of sortedExternas) {
            if (typeof imgObj === 'string') {
              push(imgObj, false);
            } else if (imgObj && typeof imgObj === 'object') {
              push(imgObj.link || imgObj.url, false);
            }
          }
        }
        pushArray(imagens.imagensURL, false);
        pushArray(imagens.url, false);
      }
      if (Array.isArray(item.midia.fotos)) {
        pushArray(item.midia.fotos, false);
      }
    }

    if (Array.isArray(item.imagens)) {
      pushArray(item.imagens, false);
    } else if (item.imagens && typeof item.imagens === 'object') {
      if (Array.isArray(item.imagens.internas)) pushArray(item.imagens.internas, false);
      if (Array.isArray(item.imagens.externas)) pushArray(item.imagens.externas, false);
      if (Array.isArray(item.imagens.imagensURL)) pushArray(item.imagens.imagensURL, false);
    }

    push(item.imagemURL, false);
    push(item.urlImagem, false);
    push(item.imagem, false);

    if (Array.isArray(item.anexos)) pushArray(item.anexos, false);
    if (item.anexo) push(item.anexo, false);

    if (Array.isArray(item.fotos)) {
      pushArray(item.fotos, false);
    } else if (item.fotos && typeof item.fotos === 'object' && Array.isArray(item.fotos.foto)) {
      pushArray(item.fotos.foto, false);
    }
  } else {
    if (item.midia?.imagens && typeof item.midia.imagens === 'object' && !Array.isArray(item.midia.imagens)) {
      if (Array.isArray(item.midia.imagens.internas)) {
        const sortedInternas = [...item.midia.imagens.internas].sort((a: any, b: any) => (a?.ordem ?? 0) - (b?.ordem ?? 0));
        for (const imgObj of sortedInternas) {
          if (imgObj && typeof imgObj === 'object') {
            push(imgObj.linkMiniatura || imgObj.thumbnail, true);
          }
        }
      }
      if (Array.isArray(item.midia.imagens.externas)) {
        const sortedExternas = [...item.midia.imagens.externas].sort((a: any, b: any) => (a?.ordem ?? 0) - (b?.ordem ?? 0));
        for (const imgObj of sortedExternas) {
          if (imgObj && typeof imgObj === 'object') {
            push(imgObj.linkMiniatura || imgObj.thumbnail, true);
          }
        }
      }
    }
    if (item.imagens && typeof item.imagens === 'object' && !Array.isArray(item.imagens)) {
      if (Array.isArray(item.imagens.internas)) pushArray(item.imagens.internas, true);
      if (Array.isArray(item.imagens.externas)) pushArray(item.imagens.externas, true);
    }
    push(item.thumbnail, true);
  }
}

/**
 * Extracts all valid image URLs from any Bling API v3 or webhook product payload.
 * Always prioritizes original high-resolution URLs (midia.imagens.internas[x].link / externas[x].link),
 * leaving linkMiniatura strictly as a last-resort fallback when .link is empty.
 */
export function extractImagesFromBlingItem(rawItem: any, includeVariations: boolean = true): string[] {
  if (!rawItem) return [];
  const item = rawItem?.data && typeof rawItem.data === 'object' && !Array.isArray(rawItem.data)
    ? rawItem.data
    : rawItem;

  const highResUrls: string[] = [];
  extractImagesFromSingleObject(item, highResUrls, false);

  if (includeVariations && Array.isArray(item.variacoes)) {
    for (const v of item.variacoes) {
      if (v?.situacao === 'I' || v?.situacao === 'E') continue;
      extractImagesFromSingleObject(v, highResUrls, false);
    }
  }

  const nonThumbHighRes = highResUrls.filter(u => !isThumbnailLikeUrl(u) && !isExpiredPresignedUrl(u));
  if (nonThumbHighRes.length > 0) {
    return nonThumbHighRes;
  }
  const nonExpiredHighRes = highResUrls.filter(u => !isExpiredPresignedUrl(u));
  if (nonExpiredHighRes.length > 0) {
    return nonExpiredHighRes;
  }

  const fallbackUrls: string[] = [];
  extractImagesFromSingleObject(item, fallbackUrls, true);
  if (includeVariations && Array.isArray(item.variacoes)) {
    for (const v of item.variacoes) {
      if (v?.situacao === 'I' || v?.situacao === 'E') continue;
      extractImagesFromSingleObject(v, fallbackUrls, true);
    }
  }

  return fallbackUrls.filter(u => !isExpiredPresignedUrl(u));
}

function replaceWithIncomingImages(incoming: string[]): string[] {
  const cleanedIncoming = incoming
    .map(u => stripResizeAndCompressionParams(u))
    .filter(img => Boolean(img) && !isPlaceholderImageUrl(img) && !isExpiredPresignedUrl(img));

  const incomingHasFullRes = cleanedIncoming.some(u => !isThumbnailLikeUrl(u));
  const result: string[] = [];
  const seenKeys = new Set<string>();
  for (const img of cleanedIncoming) {
    if (incomingHasFullRes && isThumbnailLikeUrl(img)) continue;
    const key = getCanonicalImageKey(img);
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      result.push(img);
    }
  }
  return result.slice(0, 12);
}

/**
 * Mutates an in-memory store object without writing disk yet (used for batch sync)
 */
export function applyImageRecordToStore(
  store: BlingImageStore,
  identifier: { sku?: string; name?: string; id?: string | number; parentId?: string | number },
  images: string[],
  _options?: { replaceRemoteBling?: boolean }
): boolean {
  if (!images || images.length === 0) return false;
  const validImages = images
    .map(u => normalizeImageUrl(u, true))
    .filter((u): u is string => Boolean(u) && !isPlaceholderImageUrl(u!) && !isExpiredPresignedUrl(u!));

  const replaced = replaceWithIncomingImages(validImages);
  if (replaced.length === 0) return false;

  if (identifier.sku) {
    const s = String(identifier.sku).toUpperCase().trim();
    if (s) store.bySku[s] = [...replaced];
  }
  if (identifier.id) {
    const i = String(identifier.id).trim();
    if (i) store.byId[i] = [...replaced];
  }
  if (identifier.parentId) {
    const pid = String(identifier.parentId).trim();
    if (pid) store.byId[pid] = [...replaced];
  }
  if (identifier.name) {
    const n = normalizeProductName(identifier.name);
    if (n) store.byName[n] = [...replaced];
  }

  return true;
}

/**
 * Saves image URLs for a specific product
 */
export function recordProductImage(
  identifier: { sku?: string; name?: string; id?: string | number; parentId?: string | number },
  images: string[],
  options?: { replaceRemoteBling?: boolean }
): void {
  const store = loadImageStore();
  if (applyImageRecordToStore(store, identifier, images, options)) {
    saveImageStore(store);
  }
}

/**
 * Gets real Bling images for a given product
 */
export function getBlingImagesForProduct(product: Partial<Product> | any): string[] | null {
  const store = loadImageStore();

  const sanitizeUrls = (urls?: string[]): string[] | null => {
    if (!urls || urls.length === 0) return null;
    const cleaned = urls
      .filter((u): u is string =>
        typeof u === 'string' &&
        u.trim().length > 0 &&
        !isPlaceholderImageUrl(u) &&
        !isExpiredPresignedUrl(u)
      )
      .map(u => stripResizeAndCompressionParams(u));
    if (cleaned.length === 0) return null;
    const fullRes = cleaned.filter(u => !isThumbnailLikeUrl(u));
    return fullRes.length > 0 ? fullRes : cleaned;
  };

  // 1. By SKU
  const sku = product.integration?.sku || product.sku;
  if (sku) {
    const s = String(sku).toUpperCase().trim();
    if (store.bySku[s] && store.bySku[s].length > 0) {
      const clean = sanitizeUrls(store.bySku[s]);
      if (clean) return clean;
    }
  }

  // 2. By variant SKUs or IDs
  if (Array.isArray(product.variantsList)) {
    for (const v of product.variantsList) {
      if (v.sku) {
        const vs = String(v.sku).toUpperCase().trim();
        if (store.bySku[vs] && store.bySku[vs].length > 0) {
          const clean = sanitizeUrls(store.bySku[vs]);
          if (clean) return clean;
        }
      }
      if (v.id) {
        const vId = String(v.id).trim();
        if (store.byId[vId] && store.byId[vId].length > 0) {
          const clean = sanitizeUrls(store.byId[vId]);
          if (clean) return clean;
        }
      }
    }
  }

  // 3. By Bling ID
  const blingId = product.integration?.blingId || product.blingId;
  if (blingId) {
    const bId = String(blingId).trim();
    if (store.byId[bId] && store.byId[bId].length > 0) {
      const clean = sanitizeUrls(store.byId[bId]);
      if (clean) return clean;
    }
  }

  // 4. By normalized product name
  if (product.name) {
    const n = normalizeProductName(product.name);
    if (store.byName[n] && store.byName[n].length > 0) {
      const clean = sanitizeUrls(store.byName[n]);
      if (clean) return clean;
    }

    if (n.length >= 8) {
      for (const [storedName, imgs] of Object.entries(store.byName)) {
        if (imgs.length > 0 && storedName.length >= 8 && (n.includes(storedName) || storedName.includes(n))) {
          const clean = sanitizeUrls(imgs);
          if (clean) return clean;
        }
      }
    }
  }

  return null;
}

/**
 * Replaces product images strictly with active Bling images (never merging stale cached URLs).
 */
export function applyBlingImageOverrides<T extends { images?: string[]; [key: string]: any } = Product>(
  products: T[],
  options?: { preferStore?: boolean }
): T[] {
  return products.map(product => {
    const existingClean = replaceWithIncomingImages(
      Array.isArray(product.images) ? product.images : []
    );
    const existingFullRes = existingClean.filter((img: string) => !isThumbnailLikeUrl(img) && !isLegacyExternalUrl(img));

    const realImagesRaw = getBlingImagesForProduct(product);
    const realImages = realImagesRaw ? replaceWithIncomingImages(realImagesRaw) : null;
    if (realImages && realImages.length > 0) {
      if (options?.preferStore) {
        return {
          ...product,
          images: realImages,
        };
      }

      const realCanonicalSet = new Set(realImages.map(getCanonicalImageKey));
      const existingHasNewLivePhoto = existingFullRes.some(
        (u) => !realCanonicalSet.has(getCanonicalImageKey(u))
      );

      if (existingHasNewLivePhoto || product._liveDetailFetched) {
        return {
          ...product,
          images: existingFullRes.length > 0 ? existingFullRes : realImages,
        };
      }

      if (existingFullRes.length === 1 && realImages.length > 1) {
        return {
          ...product,
          images: realImages,
        };
      }

      if (existingFullRes.length > 0) {
        return {
          ...product,
          images: existingFullRes,
        };
      }

      return {
        ...product,
        images: realImages,
      };
    }
    return existingClean.length > 0 ? { ...product, images: existingClean } : product;
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

let activeSyncPromise: Promise<any> | null = null;
let catalogFetchInProgress = false;

export function isImageSyncRunning(): boolean {
  return Boolean(activeSyncPromise);
}

export function setCatalogFetchInProgress(val: boolean): void {
  catalogFetchInProgress = val;
}

const MIN_IMAGE_SYNC_COOLDOWN_MS = 30 * 1000;

export async function syncImagesFromBling(options?: {
  maxDetailFetches?: number;
  clearCache?: boolean;
  forceRefresh?: boolean;
  onBatchSaved?: () => void;
}): Promise<{
  success: boolean;
  updatedCount: number;
  detailedFetched: number;
  totalWithImages: number;
  prunedDeletedCount?: number;
  sources: { bling: number };
  connected: boolean;
  message: string;
  error?: string;
}> {
  if (activeSyncPromise) {
    return activeSyncPromise;
  }

  const bypassCache = Boolean(options?.clearCache || options?.forceRefresh);

  if (!bypassCache && lastSyncCompletedAt > 0 && Date.now() - lastSyncCompletedAt < MIN_IMAGE_SYNC_COOLDOWN_MS) {
    const store = loadImageStore();
    const totalWithImages = Object.keys(store.bySku).length + Object.keys(store.byName).length;
    return {
      success: true,
      updatedCount: 0,
      detailedFetched: 0,
      totalWithImages,
      sources: { bling: 0 },
      connected: true,
      message: `Sincronização de imagens recente em cache (${totalWithImages} mapeamentos).`,
    };
  }

  if (!tryAcquireHeavyBlingLock('bling-image-sync', 10 * 60 * 1000)) {
    const store = loadImageStore();
    const totalWithImages = Object.keys(store.bySku).length + Object.keys(store.byName).length;
    return {
      success: true,
      updatedCount: 0,
      detailedFetched: 0,
      totalWithImages,
      sources: { bling: 0 },
      connected: true,
      message: `Sincronização de imagens já possui trava ativa (${totalWithImages} mapeamentos).`,
    };
  }

  activeSyncPromise = (async () => {
    const store = options?.clearCache ? clearImageCache(true) : loadImageStore();
    if (!store.checkedAtById) store.checkedAtById = {};
    if (!store.summaryKeyById) store.summaryKeyById = {};
    let blingCount = 0;
    let detailedFetched = 0;
    let prunedDeletedCount = 0;
    const maxDetailFetches = options?.maxDetailFetches ?? (bypassCache ? 200 : 45);

    if (isBlingDailyQuotaExceeded()) {
      const totalWithImages = Object.keys(store.bySku).length + Object.keys(store.byName).length;
      return {
        success: true,
        updatedCount: 0,
        detailedFetched: 0,
        totalWithImages,
        sources: { bling: 0 },
        connected: true,
        message: `Limite diário do Bling ativo no momento; mantendo banco de imagens local (${totalWithImages} mapeamentos).`
      };
    }

    const authorized = await ensureBlingAuthorized({ verifyLive: false });
    if (!authorized) {
      console.log('[Bling Image Sync] Bling OAuth token not connected or expired; skipped direct API fetch.');
      const totalWithImages = Object.keys(store.bySku).length + Object.keys(store.byName).length;
      return {
        success: true,
        updatedCount: 0,
        detailedFetched: 0,
        totalWithImages,
        sources: { bling: 0 },
        connected: false,
        message: `Banco de imagens local ativo (${totalWithImages} mapeamentos). Conecte o Bling ERP para puxar as fotos armazenadas no Bling.`
      };
    }

    try {
      console.log('[Bling Image Sync] Querying Bling API v3 /produtos to collect all active product IDs...');
      const allItems: any[] = [];
      const seenItemIds = new Set<number>();
      const activeIdAndParentStrings = new Set<string>();
      const MAX_ITEMS = 10000;
      let reachedCleanListEnd = true;

      const pushUniqueItems = (items: any[]) => {
        for (const it of items) {
          if (it?.situacao === 'I' || it?.situacao === 'E') continue;
          if (it?.id && !seenItemIds.has(it.id) && allItems.length < MAX_ITEMS) {
            seenItemIds.add(it.id);
            allItems.push(it);
            activeIdAndParentStrings.add(String(it.id));
            if (it.idProdutoPai) activeIdAndParentStrings.add(String(it.idProdutoPai));
          }
        }
      };

      for (let p = 1; p <= 2 && allItems.length < MAX_ITEMS; p++) {
        if (isBlingDailyQuotaExceeded()) {
          reachedCleanListEnd = false;
          break;
        }
        const latestPage = await fetchFromBling(
          `/produtos?pagina=${p}&limite=100&criterio=1&tipo=T`,
          bypassCache ? ({ bypassCache: true } as any) : {}
        );
        const latestItems = latestPage?.data || [];
        if (latestItems.length === 0) break;
        pushUniqueItems(latestItems);
        if (latestItems.length < 100) break;
        await sleep(160);
      }

      for (let p = 1; p <= 100 && allItems.length < MAX_ITEMS; p++) {
        if (isBlingDailyQuotaExceeded()) {
          reachedCleanListEnd = false;
          break;
        }
        const pageData = await fetchFromBling(
          `/produtos?pagina=${p}&limite=100&criterio=2&tipo=T`,
          bypassCache ? ({ bypassCache: true } as any) : {}
        );
        const items = pageData?.data || [];
        if (items.length === 0) break;
        pushUniqueItems(items);
        if (items.length < 100) break;
        await sleep(180);
      }

      console.log(`[Bling Image Sync] Listed ${allItems.length} Bling items. Extracting summary & preparing GET /produtos/{id} detail sync...`);

      const detailTargetMap = new Map<number, any>();
      const childItems: any[] = [];
      const changedSummaryIds = new Set<number>();

      for (const item of allItems) {
        const summaryExtracted = extractImagesFromBlingItem(item);
        const summarySignature = summaryExtracted.map(getCanonicalImageKey).slice(0, 3).join('|');
        const idStr = item.id ? String(item.id) : '';
        const prevSignature = idStr ? store.summaryKeyById[idStr] : '';
        const summaryChanged = Boolean(idStr && summarySignature && prevSignature && summarySignature !== prevSignature);

        if (summaryChanged && item.id) {
          changedSummaryIds.add(item.id);
          if (item.idProdutoPai) changedSummaryIds.add(Number(item.idProdutoPai));
        }
        if (idStr && summarySignature) {
          store.summaryKeyById[idStr] = summarySignature;
        }

        const listImgs = summaryExtracted.filter(u => !isThumbnailLikeUrl(u) && !isExpiredPresignedUrl(u));
        const hasDetailInStore = Boolean(idStr && store.byId[idStr]?.length && store.checkedAtById?.[idStr]);
        if (listImgs.length > 0 && (!hasDetailInStore || summaryChanged || bypassCache || listImgs.length >= 2)) {
          applyImageRecordToStore(
            store,
            {
              sku: item.codigo,
              id: item.id,
              name: item.nome
            },
            listImgs
          );
        }

        if (item.id && !item.idProdutoPai) {
          detailTargetMap.set(item.id, item);
        } else if (item.id) {
          childItems.push(item);
        }
      }

      for (const child of childItems) {
        if (child.idProdutoPai && !detailTargetMap.has(child.idProdutoPai)) {
          detailTargetMap.set(child.idProdutoPai, {
            id: child.idProdutoPai,
            nome: child.nome,
            codigo: child.codigo
          });
        }
      }

      // Prune deleted/inactivated Bling IDs from image store when full crawl completed cleanly
      if (reachedCleanListEnd && activeIdAndParentStrings.size > 0) {
        for (const storedId of Object.keys(store.byId)) {
          if (!activeIdAndParentStrings.has(storedId)) {
            delete store.byId[storedId];
            delete store.checkedAtById[storedId];
            delete store.summaryKeyById[storedId];
            prunedDeletedCount++;
          }
        }
      }

      const hasFullResInStore = (target: any): boolean => {
        const idKey = target?.id ? String(target.id).trim() : '';
        const parentKey = target?.idProdutoPai ? String(target.idProdutoPai).trim() : '';
        const skuKey = target?.codigo ? String(target.codigo).toUpperCase().trim() : '';
        const pools = [
          ...(idKey ? store.byId[idKey] || [] : []),
          ...(parentKey ? store.byId[parentKey] || [] : []),
          ...(skuKey ? store.bySku[skuKey] || [] : []),
        ];
        return pools.some(
          (u) =>
            typeof u === 'string' &&
            !isPlaceholderImageUrl(u) &&
            !isLegacyExternalUrl(u) &&
            !isThumbnailLikeUrl(u) &&
            !isExpiredPresignedUrl(u)
        );
      };

      const nowTs = Date.now();
      const allTargets = Array.from(detailTargetMap.values());
      const missingOrStaleTargets = allTargets.filter((t) => {
        if (changedSummaryIds.has(Number(t.id))) return true;
        if (!hasFullResInStore(t)) {
          if (!bypassCache) {
            const lastChecked = store.checkedAtById?.[String(t.id)] || 0;
            if (nowTs - lastChecked < DETAIL_CHECK_COOLDOWN_MS) return false;
          }
          return true;
        }
        const lastChecked = store.checkedAtById?.[String(t.id)] || 0;
        return nowTs - lastChecked >= DETAIL_CHECK_COOLDOWN_MS;
      });
      const detailTargets = (
        bypassCache ? allTargets : missingOrStaleTargets
      )
        .sort((a, b) => {
          const aChanged = changedSummaryIds.has(Number(a?.id)) ? 1 : 0;
          const bChanged = changedSummaryIds.has(Number(b?.id)) ? 1 : 0;
          if (aChanged !== bChanged) return bChanged - aChanged;
          const aHas = hasFullResInStore(a) ? 1 : 0;
          const bHas = hasFullResInStore(b) ? 1 : 0;
          if (aHas !== bHas) return aHas - bHas;
          const aChecked = store.checkedAtById?.[String(a?.id)] || 0;
          const bChecked = store.checkedAtById?.[String(b?.id)] || 0;
          if (aChecked !== bChecked) return aChecked - bChecked;
          return Number(b?.id || 0) - Number(a?.id || 0);
        })
        .slice(0, maxDetailFetches);

      console.log(
        `[Bling Image Sync] Fetching GET /produtos/{id} for ${detailTargets.length} products (${changedSummaryIds.size} with photo change, ${missingOrStaleTargets.length} stale/missing, ${allTargets.length} total parents)...`
      );

      const parentsWithImages = new Set<number>();

      for (let idx = 0; idx < detailTargets.length; idx++) {
        if (isBlingDailyQuotaExceeded()) break;
        while (catalogFetchInProgress) {
          await sleep(300);
        }
        const item = detailTargets[idx];
        try {
          const detail = await fetchFromBling(
            `/produtos/${item.id}`,
            bypassCache ? ({ bypassCache: true } as any) : {}
          );
          const fullData = detail?.data || detail;
          detailedFetched++;
          store.checkedAtById![String(item.id)] = Date.now();

          let fullImgs = extractImagesFromBlingItem(fullData);
          let hasTrueFullRes = fullImgs.some((u) => !isThumbnailLikeUrl(u) && !isPlaceholderImageUrl(u) && !isExpiredPresignedUrl(u));

          if (!hasTrueFullRes && Array.isArray(fullData?.variacoes) && fullData.variacoes.length > 0) {
            for (const v of fullData.variacoes.filter((vr: any) => vr?.situacao !== 'I' && vr?.situacao !== 'E').slice(0, 2)) {
              if (!v?.id || isBlingDailyQuotaExceeded()) continue;
              try {
                const vDetail = await fetchFromBling(
                  `/produtos/${v.id}`,
                  bypassCache ? ({ bypassCache: true } as any) : {}
                );
                const vFullData = vDetail?.data || vDetail;
                detailedFetched++;
                const vDetailImgs = extractImagesFromBlingItem(vFullData);
                const vFullRes = vDetailImgs.filter((u) => !isThumbnailLikeUrl(u) && !isPlaceholderImageUrl(u) && !isExpiredPresignedUrl(u));
                if (vFullRes.length > 0) {
                  fullImgs = replaceWithIncomingImages([...vFullRes, ...fullImgs.filter((u) => !isThumbnailLikeUrl(u))]);
                  hasTrueFullRes = true;
                  break;
                }
              } catch {
                // continue checking next variation
              }
            }
          }

          if (fullImgs.length > 0) {
            parentsWithImages.add(item.id);
            applyImageRecordToStore(
              store,
              {
                sku: fullData?.codigo || item.codigo,
                id: fullData?.id || item.id,
                parentId: fullData?.idProdutoPai || item.idProdutoPai,
                name: fullData?.nome || item.nome
              },
              fullImgs,
              { replaceRemoteBling: true }
            );
            blingCount++;
          } else {
            removeProductFromImageStore({
              id: fullData?.id || item.id,
              sku: fullData?.codigo || item.codigo,
              name: fullData?.nome || item.nome,
            });
          }

          if (Array.isArray(fullData?.variacoes)) {
            for (const v of fullData.variacoes) {
              if (v?.situacao === 'I' || v?.situacao === 'E') {
                removeProductFromImageStore({ id: v.id, sku: v.codigo, name: v.nome });
                continue;
              }
              const vImgs = extractImagesFromBlingItem(v, false);
              const effectiveVarImgs = vImgs.length > 0 ? vImgs : fullImgs;
              if (effectiveVarImgs.length > 0) {
                applyImageRecordToStore(
                  store,
                  {
                    sku: v.codigo,
                    id: v.id,
                    name: v.nome || fullData?.nome || item.nome
                  },
                  effectiveVarImgs,
                  { replaceRemoteBling: true }
                );
              } else {
                removeProductFromImageStore({ id: v.id, sku: v.codigo, name: v.nome });
              }
            }
          }

          if (detailedFetched % 10 === 0) {
            saveImageStore(store);
            options?.onBatchSaved?.();
          }

          await sleep(80);
        } catch (detailErr: any) {
          console.warn(`[Bling Image Sync] Detail fetch skipped for ID ${item.id}:`, detailErr?.message || detailErr);
          if (isBlingRateLimitError(detailErr) || isBlingDailyQuotaExceeded()) {
            break;
          }
        }
      }

      if (detailedFetched < maxDetailFetches && !isBlingDailyQuotaExceeded()) {
        const orphanChildren = childItems.filter(
          (c) =>
            c.id &&
            (!hasFullResInStore(c) || changedSummaryIds.has(Number(c.id)) || bypassCache) &&
            (!c.idProdutoPai || !parentsWithImages.has(c.idProdutoPai)) &&
            (bypassCache || Date.now() - (store.checkedAtById?.[String(c.id)] || 0) >= DETAIL_CHECK_COOLDOWN_MS)
        );
        for (const child of orphanChildren) {
          if (detailedFetched >= maxDetailFetches || isBlingDailyQuotaExceeded()) break;
          while (catalogFetchInProgress) {
            await sleep(300);
          }

          try {
            const detail = await fetchFromBling(
              `/produtos/${child.id}`,
              bypassCache ? ({ bypassCache: true } as any) : {}
            );
            const fullData = detail?.data || detail;
            detailedFetched++;
            store.checkedAtById![String(child.id)] = Date.now();
            const childImgs = extractImagesFromBlingItem(fullData);
            if (childImgs.length > 0) {
              applyImageRecordToStore(
                store,
                {
                  sku: fullData?.codigo || child.codigo,
                  id: fullData?.id || child.id,
                  parentId: fullData?.idProdutoPai || child.idProdutoPai,
                  name: fullData?.nome || child.nome
                },
                childImgs,
                { replaceRemoteBling: true }
              );
              blingCount++;
            }
            await sleep(80);
          } catch (childErr: any) {
            if (isBlingRateLimitError(childErr) || isBlingDailyQuotaExceeded()) {
              break;
            }
          }
        }
      }

      saveImageStore(store);
      lastSyncCompletedAt = Date.now();
      options?.onBatchSaved?.();

      console.log(`[Bling Image Sync] Finished: ${blingCount} Bling products synced (${detailedFetched} detail requests, ${prunedDeletedCount} pruned).`);

      const totalWithImages = Object.keys(store.bySku).length + Object.keys(store.byName).length;

      return {
        success: true,
        updatedCount: blingCount,
        detailedFetched,
        totalWithImages,
        prunedDeletedCount,
        sources: { bling: blingCount },
        connected: true,
        message: blingCount > 0
          ? `Sincronização concluída! ${blingCount} produtos atualizados com fotos em alta resolução do Bling ERP.`
          : `Conexão com Bling verificada (${allItems.length} itens consultados).`
      };
    } catch (blingErr: any) {
      const errMessage = blingErr?.message || String(blingErr);
      const isAuthErr =
        errMessage.includes('401') ||
        errMessage.includes('OAuth') ||
        errMessage.includes('invalid_grant') ||
        errMessage.includes('expirad');
      saveImageStore(store);
      const totalWithImages = Object.keys(store.bySku).length + Object.keys(store.byName).length;
      if (isAuthErr) {
        console.log('[Bling Image Sync] Sessão OAuth do Bling pendente de nova autorização; mantendo banco de imagens local.');
        return {
          success: true,
          updatedCount: blingCount,
          detailedFetched,
          totalWithImages,
          sources: { bling: blingCount },
          connected: false,
          error: errMessage,
          message: `Banco de imagens local ativo (${totalWithImages} mapeamentos). Reconecte o Bling ERP via OAuth para atualizar fotos.`
        };
      }
      console.warn('[Bling Image Sync] Notice during Bling API fetch:', errMessage);
      return {
        success: false,
        updatedCount: blingCount,
        detailedFetched,
        totalWithImages,
        sources: { bling: blingCount },
        connected: await ensureBlingAuthorized(),
        error: errMessage,
        message: `Erro ao consultar API do Bling: ${errMessage}`
      };
    }
  })().finally(() => {
    releaseHeavyBlingLock('bling-image-sync');
    activeSyncPromise = null;
  });

  return activeSyncPromise;
}
