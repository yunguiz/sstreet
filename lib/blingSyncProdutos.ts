import crypto from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminFirestore } from './firebaseAdmin.js';
import {
  blingApiRequest,
  interceptBlingTokenBeforeSync,
  isBlingDailyQuotaExceeded,
  isBlingRateLimitError,
  tryAcquireHeavyBlingLock,
  releaseHeavyBlingLock,
  BLING_OFFICIAL_API_BASE,
  BLING_API_BASE,
} from './blingToken.js';
import {
  detectColorFromText,
  inferStoreCategory,
  normalizeColorName,
  parseBlingVariantMeta,
  sortSizes,
} from '../src/lib/catalogVariants.js';
import { isExcludedCatalogItem } from '../src/lib/hiddenProducts.js';

export { BLING_OFFICIAL_API_BASE, BLING_API_BASE };

export interface SyncProdutosPageResult {
  success: boolean;
  finalizado: boolean;
  totalImportado?: number;
  proximaPagina?: number;
  importadosNaPagina?: number;
  documentosGravados?: number;
  docIds?: string[];
}

export interface SyncAllResult {
  success: boolean;
  finalizado: boolean;
  paginaInicial: number;
  ultimaPagina: number;
  proximaPagina?: number;
  paginasProcessadas: number;
  totalImportado: number;
  documentosGravados: number;
  desativados?: number;
  duracaoMs: number;
  paradoPorTempoLimite?: boolean;
}

interface BlingCategoriaRaw {
  id?: number | string;
  descricao?: string;
}

interface BlingMediaEntry {
  link?: string;
  url?: string;
  linkMiniatura?: string;
  ordem?: number;
}

interface BlingProdutoRaw {
  id: number | string;
  nome?: string;
  codigo?: string;
  preco?: number | string;
  tipo?: string;
  situacao?: string;
  formato?: string;
  idProdutoPai?: number | string | null;
  imagemURL?: string;
  descricaoCurta?: string;
  descricaoComplementar?: string;
  categoria?: BlingCategoriaRaw | null;
  estoque?: {
    saldoVirtualTotal?: number | string;
    saldoFisicoTotal?: number | string;
    saldoFisico?: number | string;
  } | null;
  midia?: {
    imagens?: {
      internas?: BlingMediaEntry[];
      externas?: BlingMediaEntry[];
    };
  } | null;
  variacao?: {
    nome?: string;
    ordem?: number;
    produtoPai?: { id?: number | string };
  } | null;
  variacoes?: BlingProdutoRaw[];
}

export function verifySyncSecret(providedSecret?: string | null): boolean {
  const expected = (process.env.CRON_SECRET || '').trim();
  const actual = (providedSecret || '').trim();

  if (!expected || !actual) {
    return false;
  }

  const expectedBuf = Buffer.from(expected, 'utf8');
  const actualBuf = Buffer.from(actual, 'utf8');
  if (expectedBuf.length !== actualBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

function cleanBlingDescription(raw?: string): string {
  if (!raw) return '';
  return String(raw)
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>?/gm, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 1500);
}

function isPlaceholderImageUrl(url?: string): boolean {
  const u = String(url || '').toLowerCase().trim();
  if (!u) return true;
  if (u.startsWith('data:image/')) return true;
  if (u.startsWith('/src/assets/')) return true;
  if (
    u.includes('unsplash.com') ||
    u.includes('placeholder') ||
    u.includes('via.placeholder') ||
    u.includes('streetstore-fallback') ||
    u.startsWith('/assets/uploads/') ||
    u.startsWith('/assets/aistudio/')
  ) {
    return true;
  }
  return false;
}

function isExpiredPresignedUrl(url?: string): boolean {
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

function isLegacyExternalUrl(url?: string): boolean {
  const u = String(url || '').toLowerCase();
  return u.includes('mitiendanube.com') || u.includes('nuvemshop') || u.includes('dcdn-us.mitiendanube');
}

function isThumbnailLikeUrl(url: string): boolean {
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

const SYNC_RESIZE_QUERY_PARAMS = new Set([
  'w', 'h', 'width', 'height', 'max-w', 'max-h', 'maxwidth', 'maxheight',
  'size', 'resize', 'quality', 'q', 'auto', 'fit', 'crop', 'dpr',
  'compress', 'compression', 'format', 'fm', 'fl', 'scale',
  'thumb', 'thumbnail', 'mini', 'miniatura', 'mode', 'blur', 'pixel', 'opt', 'optimize',
]);

function cleanBlingImageUrl(url?: string): string {
  const raw = String(url || '').trim();
  if (!raw || isPlaceholderImageUrl(raw) || isExpiredPresignedUrl(raw)) return '';
  if (raw.startsWith('/assets/')) return raw;
  if (!raw.startsWith('http://') && !raw.startsWith('https://')) {
    return '';
  }
  try {
    const parsed = new URL(raw);
    let mutated = false;
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (SYNC_RESIZE_QUERY_PARAMS.has(key.toLowerCase())) {
        parsed.searchParams.delete(key);
        mutated = true;
      }
    }
    return mutated ? parsed.toString() : raw;
  } catch {
    return raw;
  }
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
  'x-amz-security-token',
]);

function getCanonicalImageKey(url: string): string {
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

/**
 * Classifica qualidade da imagem para proteger fotos em alta resolução contra sobrescrita:
 * 3 = URL original nativa Bling/S3 ou asset oficial sem ser miniatura
 * 2 = URL externa de alta resolução (não-legada, não-miniatura)
 * 1 = URL externa legada (ex: Nuvemshop/Mitiendanube) em alta resolução
 * 0 = Miniatura / thumbnail
 * -1 = Inválida / placeholder
 */
function getImageQualityTier(url?: string): number {
  const clean = cleanBlingImageUrl(url);
  if (!clean) return -1;
  if (isThumbnailLikeUrl(clean)) return 0;
  if (isLegacyExternalUrl(clean)) return 1;
  if (
    clean.includes('orgbling.s3.amazonaws.com') ||
    clean.includes('bling.com') ||
    clean.startsWith('/assets/')
  ) {
    return 3;
  }
  return 2;
}

function mergeImagesSafe(
  preferred: string[],
  secondary: string[] = [],
  options?: { replaceRemoteBling?: boolean }
): string[] {
  const seenKeys = new Set<string>();
  const tagged: Array<{ url: string; tier: number; order: number }> = [];
  let order = 0;

  const filteredSecondary = options?.replaceRemoteBling ? [] : secondary;

  for (const raw of [...preferred, ...filteredSecondary]) {
    const clean = cleanBlingImageUrl(raw);
    if (!clean) continue;
    const key = getCanonicalImageKey(clean);
    if (seenKeys.has(key)) continue;
    const tier = getImageQualityTier(clean);
    if (tier < 0) continue;
    seenKeys.add(key);
    tagged.push({ url: clean, tier, order: order++ });
  }

  if (tagged.length === 0) return [];

  const hasFullRes = tagged.some((entry) => entry.tier >= 1);
  const filtered = hasFullRes ? tagged.filter((entry) => entry.tier >= 1) : tagged;

  filtered.sort((a, b) => {
    if (b.tier !== a.tier) return b.tier - a.tier;
    return a.order - b.order;
  });

  return filtered.slice(0, 10).map((entry) => entry.url);
}

function pickBestSingleImage(
  incoming?: string,
  existing?: string,
  options?: { forceIncoming?: boolean }
): string {
  const cleanIn = cleanBlingImageUrl(incoming);
  const cleanEx = cleanBlingImageUrl(existing);
  const tierIn = getImageQualityTier(cleanIn);
  const tierEx = getImageQualityTier(cleanEx);

  if (options?.forceIncoming && tierIn >= 0 && (tierIn >= tierEx || tierIn >= 2)) {
    return cleanIn;
  }
  if (tierEx >= 0 && (tierIn < 0 || tierIn < tierEx)) {
    return cleanEx;
  }
  return cleanIn || cleanEx || '';
}

function extractSummarySignatureKeys(item: BlingProdutoRaw): string[] {
  const keys: string[] = [];
  const pushKey = (raw?: string) => {
    const cleaned = cleanBlingImageUrl(raw);
    if (!cleaned) return;
    const k = getCanonicalImageKey(cleaned);
    if (k && !keys.includes(k)) keys.push(k);
  };
  const internas = Array.isArray(item.midia?.imagens?.internas) ? item.midia!.imagens!.internas! : [];
  const externas = Array.isArray(item.midia?.imagens?.externas) ? item.midia!.imagens!.externas! : [];
  for (const entry of [...internas, ...externas]) {
    pushKey(entry?.link || entry?.url);
  }
  pushKey(item.imagemURL);
  return keys;
}

function extractAllImageUrls(item: BlingProdutoRaw): string[] {
  const highRes: string[] = [];
  const seenHighRes = new Set<string>();

  const pushUrl = (raw: string | undefined) => {
    const cleaned = cleanBlingImageUrl(raw);
    if (!cleaned || isThumbnailLikeUrl(cleaned)) return;
    const key = getCanonicalImageKey(cleaned);
    if (key && !seenHighRes.has(key)) {
      seenHighRes.add(key);
      highRes.push(cleaned);
    }
  };

  const internas = Array.isArray(item.midia?.imagens?.internas)
    ? [...item.midia!.imagens!.internas!].sort((a, b) => (a?.ordem ?? 0) - (b?.ordem ?? 0))
    : [];
  const externas = Array.isArray(item.midia?.imagens?.externas)
    ? [...item.midia!.imagens!.externas!].sort((a, b) => (a?.ordem ?? 0) - (b?.ordem ?? 0))
    : [];

  for (const entry of [...internas, ...externas]) {
    const full = entry?.link || entry?.url;
    if (full) {
      pushUrl(full);
    }
  }

  if (item.imagemURL) {
    pushUrl(item.imagemURL);
  }

  return highRes;
}

export interface InMemoryImageStoreSnapshot {
  byId: Record<string, string[]>;
  bySku: Record<string, string[]>;
  byName?: Record<string, string[]>;
}

function inferCategory(item: BlingProdutoRaw): {
  label: string;
  categoriaStore: 'roupas' | 'calcados' | 'acessorios';
  subcategoriaStore: 'hoodies' | 'camisetas' | 'calcas' | 'shorts' | 'sneakers' | 'bones' | 'bags' | 'acessorios-metal';
} {
  const rawDesc = String(item.categoria?.descricao || '').trim();
  const { category, subcategory } = inferStoreCategory(String(item.nome || ''), rawDesc);

  const labelBySubcategory: Record<string, string> = {
    bones: 'Acessórios',
    bags: 'Acessórios',
    'acessorios-metal': 'Acessórios',
    sneakers: 'Calçados',
    hoodies: 'Moletons & Jaquetas',
    calcas: 'Calças',
    shorts: 'Bermudas & Shorts',
    camisetas: 'Camisetas & Vestuário',
  };

  return {
    label: rawDesc || labelBySubcategory[subcategory] || 'Camisetas & Vestuário',
    categoriaStore: category,
    subcategoriaStore: subcategory,
  };
}

function parseVariantMeta(item: BlingProdutoRaw): {
  baseName: string;
  size: string;
  color: string;
} {
  const isParent = item.formato === 'V' && !item.idProdutoPai;
  const parsed = parseBlingVariantMeta({
    nome: item.nome,
    variacaoNome: item.variacao?.nome,
    isParentContainer: isParent,
  });

  return {
    baseName: parsed.baseName || `Produto ${item.id}`,
    size: parsed.size,
    color: parsed.color?.name || 'Padrão',
  };
}

interface StockResolution {
  stock: number;
  rawStock: number;
}

function resolveStockQuantity(item: BlingProdutoRaw, realStockMap?: Map<string, StockResolution>): StockResolution {
  const idKey = String(item.id);
  if (realStockMap && realStockMap.has(idKey)) {
    return realStockMap.get(idKey)!;
  }
  const raw =
    item.estoque?.saldoVirtualTotal ??
    item.estoque?.saldoFisicoTotal ??
    item.estoque?.saldoFisico ??
    0;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return { stock: 0, rawStock: 0 };
  }
  return {
    stock: Math.max(0, parsed),
    rawStock: parsed,
  };
}

async function fetchBlingJson<T = unknown>(pathAndQuery: string): Promise<T> {
  return blingApiRequest<T>(pathAndQuery, { method: 'GET' });
}

async function fetchStockBalancesForIds(ids: string[]): Promise<Map<string, StockResolution>> {
  const stockMap = new Map<string, StockResolution>();
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  const chunks: string[][] = [];
  for (let i = 0; i < uniqueIds.length; i += 50) {
    chunks.push(uniqueIds.slice(i, i + 50));
  }

  const results: Array<{
    data?: Array<{
      produto?: { id?: number | string };
      saldoVirtualTotal?: number | string;
      saldoFisicoTotal?: number | string;
      saldoFisico?: number | string;
    }>;
  } | null> = [];

  for (const chunk of chunks) {
    if (isBlingDailyQuotaExceeded()) break;
    const qs = chunk.map((id) => `idsProdutos[]=${encodeURIComponent(id)}`).join('&');
    try {
      const res = await fetchBlingJson<{
        data?: Array<{
          produto?: { id?: number | string };
          saldoVirtualTotal?: number | string;
          saldoFisicoTotal?: number | string;
          saldoFisico?: number | string;
        }>;
      }>(`/estoques/saldos?${qs}`);
      results.push(res);
    } catch (err) {
      results.push(null);
      if (isBlingRateLimitError(err) || isBlingDailyQuotaExceeded()) break;
    }
  }

  for (const res of results) {
    for (const entry of res?.data || []) {
      const pId = entry?.produto?.id;
      if (pId !== undefined && pId !== null) {
        const bal = entry.saldoVirtualTotal ?? entry.saldoFisicoTotal ?? entry.saldoFisico ?? 0;
        const parsed = Number(bal);
        const safeRaw = Number.isFinite(parsed) ? parsed : 0;
        stockMap.set(String(pId), {
          stock: Math.max(0, safeRaw),
          rawStock: safeRaw,
        });
      }
    }
  }
  return stockMap;
}

/**
 * Busca uma página (100 produtos ativos) na API v3 do Bling e grava em lote via WriteBatch
 * na coleção `products` do Firestore usando o `id` do Bling (ou `idProdutoPai` para variações)
 * como ID do documento com `{ merge: true }` e mesclagem segura entre páginas.
 */
export async function syncBlingProdutosPageToFirestore(
  paginaInput: number,
  options?: { enrichHighResImages?: boolean; maxDetailMs?: number; forceRefresh?: boolean }
): Promise<SyncProdutosPageResult> {
  if (isBlingDailyQuotaExceeded()) {
    return {
      success: true,
      finalizado: true,
      totalImportado: 0,
      docIds: [],
    };
  }
  const pagina = Number.isFinite(paginaInput) && paginaInput >= 1 ? Math.floor(paginaInput) : 1;
  const forceRefresh = Boolean(options?.forceRefresh);
  // Interceptor de pré-sincronização: valida expiração e renova via refresh_token se necessário
  await interceptBlingTokenBeforeSync();

  const json = await fetchBlingJson<{ data?: BlingProdutoRaw[] }>(
    `/produtos?pagina=${pagina}&limite=100&criterio=2`
  );

  const lista = Array.isArray(json.data) ? json.data : [];

  if (lista.length === 0) {
    return {
      success: true,
      finalizado: true,
      totalImportado: 0,
      docIds: [],
    };
  }

  // Busca saldos reais de estoque em até 2 chamadas (chunks de 50 IDs)
  const itemIds = lista.map((item) => String(item.id));
  const realStockMap = await fetchStockBalancesForIds(itemIds);
  const loggedNegativeIds = new Set<string>();

  const readStockWithLog = (targetItem: BlingProdutoRaw): number => {
    const resolved = resolveStockQuantity(targetItem, realStockMap);
    const idKey = String(targetItem.id);
    if (resolved.rawStock < 0 && !loggedNegativeIds.has(idKey)) {
      loggedNegativeIds.add(idKey);
      console.warn(
        `[Bling Sync][Estoque Negativo] pagina=${pagina} id=${idKey} codigo="${String(
          targetItem.codigo || 'N/A'
        )}" nome="${String(targetItem.nome || '')}" saldo_bling=${resolved.rawStock} -> ajustado para 0 na loja.`
      );
    }
    return resolved.stock;
  };

  type GroupedVariation = {
    blingId: string;
    codigo: string;
    nome: string;
    tamanho: string;
    cor: string;
    preco: number;
    estoque: number;
    imagemURL: string;
    imagens?: string[];
  };

  type GroupedProductWrite = {
    docId: string;
    blingId: string;
    nome?: string;
    codigo?: string;
    preco?: number;
    estoqueDireto?: number;
    imagens: string[];
    imagemURL?: string;
    summaryRawUrls: string[];
    summaryImageKey?: string;
    replaceRemoteImages: boolean;
    authoritativeVariacoesLoaded: boolean;
    deletedInBling?: boolean;
    categoria?: string;
    categoriaStore?: 'roupas' | 'calcados' | 'acessorios';
    subcategoriaStore?: string;
    categoriaId?: string | null;
    descricao?: string;
    sizes: Set<string>;
    colors: Set<string>;
    variacoes: Record<string, GroupedVariation>;
    hasParentRecord: boolean;
  };

  const grouped = new Map<string, GroupedProductWrite>();

  const ensureGroup = (docId: string): GroupedProductWrite => {
    let entry = grouped.get(docId);
    if (!entry) {
      entry = {
        docId,
        blingId: docId,
        imagens: [],
        summaryRawUrls: [],
        replaceRemoteImages: false,
        authoritativeVariacoesLoaded: false,
        sizes: new Set<string>(),
        colors: new Set<string>(),
        variacoes: {},
        hasParentRecord: false,
      };
      grouped.set(docId, entry);
    }
    return entry;
  };

  const mergeImages = (target: string[], incoming: string[]) => mergeImagesSafe(target, incoming);

  for (const item of lista) {
    const itemId = String(item.id);
    const parentIdRaw = item.idProdutoPai ?? item.variacao?.produtoPai?.id ?? null;
    const hasParent = parentIdRaw !== null && parentIdRaw !== undefined && Number(parentIdRaw) > 0;
    const docId = hasParent ? String(parentIdRaw) : itemId;

    if (item.situacao === 'I' || item.situacao === 'E') {
      if (!hasParent) {
        const inactiveGroup = ensureGroup(docId);
        inactiveGroup.hasParentRecord = true;
        inactiveGroup.blingId = itemId;
        inactiveGroup.nome = String(item.nome || inactiveGroup.nome || '');
        inactiveGroup.deletedInBling = true;
      }
      continue;
    }

    const group = ensureGroup(docId);
    const meta = parseVariantMeta(item);
    const stock = readStockWithLog(item);
    const price = Number(item.preco || 0);
    const directItemImgs = extractAllImageUrls(item);
    for (const rawKey of extractSummarySignatureKeys(item)) {
      if (!group.summaryRawUrls.includes(rawKey)) {
        group.summaryRawUrls.push(rawKey);
      }
    }
    const itemImgs = mergeImages([], directItemImgs);
    const primaryImg = itemImgs[0] || '';
    const catInfo = inferCategory(item);
    const desc = cleanBlingDescription(item.descricaoCurta || item.descricaoComplementar);

    if (itemImgs.length > 0) {
      group.imagens = mergeImages(group.imagens, itemImgs);
      group.imagemURL = group.imagens[0] || group.imagemURL;
    }

    if (!hasParent) {
      group.hasParentRecord = true;
      group.blingId = itemId;
      group.nome = meta.baseName;
      group.codigo = String(item.codigo || '');
      group.preco = price;
      group.estoqueDireto = stock;
      group.categoria = catInfo.label;
      group.categoriaStore = catInfo.categoriaStore;
      group.subcategoriaStore = catInfo.subcategoriaStore;
      group.categoriaId = item.categoria?.id ? String(item.categoria.id) : null;
      if (desc) group.descricao = desc;

      if (Array.isArray(item.variacoes) && item.variacoes.length > 0) {
        group.authoritativeVariacoesLoaded = true;
        for (const v of item.variacoes) {
          if (v?.situacao === 'I' || v?.situacao === 'E') continue;
          const vMeta = parseVariantMeta(v);
          const vStock = readStockWithLog(v);
          const vPrice = Number(v.preco || price || 0);
          const vImgs = extractAllImageUrls(v);
          for (const rawKey of extractSummarySignatureKeys(v)) {
            if (!group.summaryRawUrls.includes(rawKey)) {
              group.summaryRawUrls.push(rawKey);
            }
          }
          const vImg = vImgs[0] || primaryImg;
          if (vImgs.length > 0) {
            group.imagens = mergeImages(group.imagens, vImgs);
            group.imagemURL = group.imagens[0] || group.imagemURL;
          }
          group.sizes.add(vMeta.size);
          group.colors.add(vMeta.color);
          group.variacoes[String(v.id)] = {
            blingId: String(v.id),
            codigo: String(v.codigo || ''),
            nome: String(v.nome || meta.baseName),
            tamanho: vMeta.size,
            cor: vMeta.color,
            preco: vPrice,
            estoque: vStock,
            imagemURL: vImg,
            ...(vImgs.length > 0 ? { imagens: vImgs } : {}),
          };
        }
      } else {
        if (meta.size !== 'Único') group.sizes.add(meta.size);
        if (meta.color !== 'Padrão') group.colors.add(meta.color);
      }
    } else {
      if (!group.nome) group.nome = meta.baseName;
      if (!group.categoria) {
        group.categoria = catInfo.label;
        group.categoriaStore = catInfo.categoriaStore;
        group.subcategoriaStore = catInfo.subcategoriaStore;
      }
      if (!group.preco && price > 0) group.preco = price;
      if (!group.descricao && desc) group.descricao = desc;

      group.sizes.add(meta.size);
      if (meta.color !== 'Padrão') group.colors.add(meta.color);

      group.variacoes[itemId] = {
        blingId: itemId,
        codigo: String(item.codigo || ''),
        nome: String(item.nome || meta.baseName),
        tamanho: meta.size,
        cor: meta.color,
        preco: price,
        estoque: stock,
        imagemURL: primaryImg,
        ...(itemImgs.length > 0 ? { imagens: itemImgs } : {}),
      };
    }
  }

  const db = getAdminFirestore();
  const entries = Array.from(grouped.values());
  for (const group of entries) {
    if (group.summaryRawUrls.length > 0) {
      const keys = Array.from(new Set(group.summaryRawUrls.map(getCanonicalImageKey))).sort();
      group.summaryImageKey = keys.join('|');
    }
  }

  // Lê os documentos existentes no Firestore ANTES do enriquecimento para:
  // 1) Evitar chamar GET /produtos/{id} quando já há imagens em alta resolução salvas e a foto não mudou;
  // 2) Detectar troca de foto no Bling (summaryImageKey diferente) e forçar atualização limpa.
  const existingByDocId = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < entries.length; i += 400) {
    const slice = entries.slice(i, i + 400);
    const docRefs = slice.map((g) => db.collection('products').doc(g.docId));
    const existingSnaps = docRefs.length > 0 ? await db.getAll(...docRefs) : [];
    existingSnaps.forEach((snap) => {
      if (snap.exists) {
        existingByDocId.set(snap.id, (snap.data() || {}) as Record<string, unknown>);
      }
    });
  }

  const detailCheckedAtMap = new Map<string, number>();

  // Busca detalhe GET /produtos/{id} no Bling v3 quando:
  // - a listagem vier sem mídia ou apenas com miniatura (/t/);
  // - ou sem pai na página;
  // - ou summaryImageKey mudou no Bling;
  // - ou forceRefresh estiver ativo.
  if (options?.enrichHighResImages !== false && !isBlingDailyQuotaExceeded()) {
    const detailBudgetMs = options?.maxDetailMs ?? (process.env.VERCEL ? 2800 : 25000);
    const detailStart = Date.now();
    const DETAIL_COOLDOWN_MS = 45 * 1000;

    const candidates = entries
      .filter((g) => {
        if (g.deletedInBling) return false;
        const existingData = existingByDocId.get(g.docId);
        if (
          isExcludedCatalogItem({
            name: String(g.nome || existingData?.nome || ''),
            integration: { sku: String(g.codigo || existingData?.codigo || '') },
            category: String(g.categoriaStore || existingData?.categoriaStore || ''),
            subcategory: String(g.subcategoriaStore || existingData?.subcategoriaStore || ''),
          })
        ) {
          return false;
        }
        const prevSummaryKey = typeof existingData?.summaryImageKey === 'string' ? existingData.summaryImageKey : '';
        const summaryChanged = Boolean(g.summaryImageKey && prevSummaryKey && g.summaryImageKey !== prevSummaryKey);
        const lastChecked = Number(existingData?.detailCheckedAt || 0);

        if (!forceRefresh && !summaryChanged && lastChecked > 0 && Date.now() - lastChecked < DETAIL_COOLDOWN_MS) {
          return false;
        }

        const existingImgs = Array.isArray(existingData?.imagens)
          ? (existingData.imagens as string[]).filter((u) => getImageQualityTier(u) >= 2)
          : [];
        const groupHighRes = g.imagens.filter((u) => getImageQualityTier(u) >= 2);
        const needsHighResPhoto =
          groupHighRes.length === 0 ||
          g.imagens.every((u) => isThumbnailLikeUrl(u)) ||
          existingImgs.length === 0;
        const needsOrphanParent = !g.hasParentRecord && !existingData?.codigo;
        const staleDetailCheck = g.hasParentRecord && Date.now() - lastChecked >= DETAIL_COOLDOWN_MS;
        return needsHighResPhoto || needsOrphanParent || summaryChanged || forceRefresh || staleDetailCheck;
      })
      .sort((a, b) => {
        const aChecked = Number(existingByDocId.get(a.docId)?.detailCheckedAt || 0);
        const bChecked = Number(existingByDocId.get(b.docId)?.detailCheckedAt || 0);
        return aChecked - bChecked;
      });

    const maxToEnrich = forceRefresh ? (process.env.VERCEL ? 25 : 100) : (process.env.VERCEL ? 20 : 60);
    const targets = candidates.slice(0, maxToEnrich);
    const CONCURRENCY = 1;

    for (let i = 0; i < targets.length; i += CONCURRENCY) {
      if (Date.now() - detailStart >= detailBudgetMs || isBlingDailyQuotaExceeded()) break;
      const chunk = targets.slice(i, i + CONCURRENCY);
      await Promise.all(
        chunk.map(async (group) => {
          try {
            const detail = await fetchBlingJson<{ data?: BlingProdutoRaw }>(`/produtos/${group.docId}`);
            detailCheckedAtMap.set(group.docId, Date.now());
            const fullItem = detail?.data;
            if (!fullItem) return;

            if (fullItem.situacao === 'I' || fullItem.situacao === 'E') {
              group.deletedInBling = true;
              return;
            }

            group.replaceRemoteImages = true;
            const fullImgs = extractAllImageUrls(fullItem);
            group.imagens = mergeImagesSafe(fullImgs, [], { replaceRemoteBling: true });
            group.imagemURL = group.imagens[0] || '';

            if (!group.hasParentRecord && fullItem.nome) {
              const parentMeta = parseVariantMeta(fullItem);
              const parentCat = inferCategory(fullItem);
              group.nome = parentMeta.baseName || group.nome;
              group.codigo = String(fullItem.codigo || group.codigo || '');
              if (Number(fullItem.preco || 0) > 0) {
                group.preco = Number(fullItem.preco);
              }
              group.categoria = parentCat.label;
              group.categoriaStore = parentCat.categoriaStore;
              group.subcategoriaStore = parentCat.subcategoriaStore;
              group.categoriaId = fullItem.categoria?.id ? String(fullItem.categoria.id) : group.categoriaId;
            }

            const fullDesc = cleanBlingDescription(fullItem.descricaoCurta || fullItem.descricaoComplementar);
            if (fullDesc && !group.descricao) {
              group.descricao = fullDesc;
            }

            const detailVarIds: string[] = [];
            if (Array.isArray(fullItem.variacoes) && fullItem.variacoes.length > 0) {
              group.authoritativeVariacoesLoaded = true;
              const activeFullVars = fullItem.variacoes.filter(
                (v) => v?.situacao !== 'I' && v?.situacao !== 'E'
              );
              const activeIds = new Set(activeFullVars.map((v) => String(v.id)));
              for (const existingVarKey of Object.keys(group.variacoes)) {
                if (!activeIds.has(existingVarKey)) {
                  delete group.variacoes[existingVarKey];
                }
              }

              const activeVarCombinedImgs: string[] = [];
              for (const v of activeFullVars) {
                if (v?.id) detailVarIds.push(String(v.id));
                const vImgs = extractAllImageUrls(v);
                if (vImgs.length > 0) {
                  activeVarCombinedImgs.push(...vImgs);
                }
                const existingVar = group.variacoes[String(v.id)];
                if (existingVar) {
                  existingVar.imagemURL = vImgs[0] || group.imagemURL || '';
                  existingVar.imagens = vImgs.length > 0 ? vImgs : group.imagens;
                }
              }
              if (fullImgs.length === 0 && activeVarCombinedImgs.length > 0) {
                group.imagens = mergeImagesSafe(activeVarCombinedImgs, [], { replaceRemoteBling: true });
                group.imagemURL = group.imagens[0] || '';
              } else if (activeVarCombinedImgs.length > 0) {
                group.imagens = mergeImagesSafe(fullImgs, activeVarCombinedImgs);
                group.imagemURL = group.imagens[0] || '';
              }
            }

            // Fallback: se o pai não trouxe mídia própria em alta resolução, tenta até 2 variações
            const varCandidates = Array.from(new Set([...Object.keys(group.variacoes), ...detailVarIds])).slice(0, 2);
            for (const varId of varCandidates) {
              const stillLowRes = group.imagens.every((u) => getImageQualityTier(u) < 2);
              if (!stillLowRes || Date.now() - detailStart >= detailBudgetMs || isBlingDailyQuotaExceeded()) break;
              const varDetail = await fetchBlingJson<{ data?: BlingProdutoRaw }>(`/produtos/${varId}`).catch(
                () => null
              );
              const varFullImgs = varDetail?.data ? extractAllImageUrls(varDetail.data) : [];
              if (varFullImgs.length > 0 && varFullImgs.some((u) => getImageQualityTier(u) >= 2)) {
                group.imagens = mergeImagesSafe(varFullImgs, [], { replaceRemoteBling: true });
                group.imagemURL = group.imagens[0] || '';
                if (group.variacoes[varId]) {
                  group.variacoes[varId].imagemURL = varFullImgs[0] || '';
                  group.variacoes[varId].imagens = varFullImgs;
                }
              }
            }
          } catch (detailErr: any) {
            const msg = String(detailErr?.message || '');
            if (msg.includes('[404]')) {
              group.deletedInBling = true;
            }
          }
        })
      );

      if (i + CONCURRENCY < targets.length && Date.now() - detailStart < detailBudgetMs) {
        await new Promise((r) => setTimeout(r, 80));
      }
    }
  }

  const nowIso = new Date().toISOString();

  // Firestore WriteBatch suporta no máximo 500 operações por commit
  for (let i = 0; i < entries.length; i += 400) {
    const slice = entries.slice(i, i + 400);
    const docRefs = slice.map((g) => db.collection('products').doc(g.docId));
    const batch = db.batch();

    for (let idx = 0; idx < slice.length; idx++) {
      const group = slice[idx];
      const docRef = docRefs[idx];
      const existingData = existingByDocId.get(group.docId);

      if (group.deletedInBling) {
        batch.set(
          docRef,
          {
            blingId: group.blingId,
            ativo: false,
            deletedInBling: true,
            deletedInBlingAt: nowIso,
            updatedAt: FieldValue.serverTimestamp(),
            syncedAtIso: nowIso,
          },
          { merge: true }
        );
        continue;
      }

      const existingVariacoes =
        existingData && typeof existingData.variacoes === 'object' && existingData.variacoes !== null
          ? (existingData.variacoes as Record<string, GroupedVariation>)
          : {};

      const mergedVariacoes: Record<string, GroupedVariation> = group.authoritativeVariacoesLoaded
        ? {}
        : { ...existingVariacoes };
      for (const [vId, incomingVar] of Object.entries(group.variacoes)) {
        const prevVar = existingVariacoes[vId];
        const liveVarUrl = cleanBlingImageUrl(incomingVar.imagemURL);
        mergedVariacoes[vId] = {
          ...incomingVar,
          imagemURL:
            liveVarUrl ||
            (group.replaceRemoteImages || group.authoritativeVariacoesLoaded ? '' : cleanBlingImageUrl(prevVar?.imagemURL)),
        };
      }

      const mergedVariacoesList = Object.values(mergedVariacoes);
      const estoqueTotalVariacoes = mergedVariacoesList.reduce((acc, v) => {
        const parsedVarStock = Number(v?.estoque ?? 0);
        return acc + (Number.isFinite(parsedVarStock) ? Math.max(0, parsedVarStock) : 0);
      }, 0);

      if (!group.hasParentRecord) {
        const orphanKeys = Object.values(group.variacoes)
          .map((v) => v.codigo || v.blingId)
          .join(', ');
        console.warn(
          `[Bling Sync][Variação sem Pai na Página ${pagina}] produtoPaiId=${group.docId} não veio na página ${pagina} (${Object.keys(group.variacoes).length} variação(ões): ${orphanKeys}). Mesclagem preservando campos existentes do pai.`
        );
      }

      const existingMainUrl =
        typeof existingData?.imagemURL === 'string' ? cleanBlingImageUrl(existingData.imagemURL) : '';

      const prevSummaryKey = typeof existingData?.summaryImageKey === 'string' ? existingData.summaryImageKey : '';
      const summaryChanged = Boolean(
        group.summaryImageKey && prevSummaryKey && group.summaryImageKey !== prevSummaryKey
      );
      const shouldReplaceRemote = Boolean(group.replaceRemoteImages || summaryChanged || forceRefresh || group.hasParentRecord);

      const mergedImagens = mergeImagesSafe(group.imagens, [], { replaceRemoteBling: true }).filter(
        (u) => !isThumbnailLikeUrl(u)
      );
      const mergedImagemURL = mergedImagens[0] || (group.imagemURL && !isThumbnailLikeUrl(group.imagemURL) ? cleanBlingImageUrl(group.imagemURL) : '') || '';

      if (mergedImagemURL) {
        for (const vKey of Object.keys(mergedVariacoes)) {
          if (getImageQualityTier(mergedVariacoes[vKey].imagemURL) < 2) {
            mergedVariacoes[vKey].imagemURL = mergedImagemURL;
          }
        }
      }

      const existingHasFullRes = Array.isArray(existingData?.imagens)
        ? (existingData.imagens as string[]).some((u) => getImageQualityTier(u) >= 2 && !isExpiredPresignedUrl(u))
        : false;
      const shouldUpdateImages =
        group.replaceRemoteImages ||
        (mergedImagens.length > 0 && (group.hasParentRecord || shouldReplaceRemote || !existingData || !existingHasFullRes));

      const existingSizes = Array.isArray(existingData?.tamanhos)
        ? (existingData.tamanhos as string[]).filter((s) => typeof s === 'string' && s.trim() !== '')
        : [];
      const inStockVarSizes = mergedVariacoesList
        .filter((v) => Number(v?.estoque ?? 0) > 0 && v?.tamanho)
        .map((v) => String(v.tamanho));
      const activeTamanhos =
        mergedVariacoesList.length > 0
          ? sortSizes(inStockVarSizes)
          : sortSizes([...existingSizes, ...Array.from(group.sizes)]);

      const existingColors = Array.isArray(existingData?.cores)
        ? (existingData.cores as string[]).filter((c) => typeof c === 'string' && c.trim() !== '')
        : [];
      const inStockVarColors = mergedVariacoesList
        .filter((v) => Number(v?.estoque ?? 0) > 0)
        .map((v) => {
          const parsedVar = parseBlingVariantMeta({ nome: v.nome || '', isParentContainer: false });
          return parsedVar.color?.name || normalizeColorName(String(v.cor || ''));
        })
        .filter(Boolean);
      const fallbackTitleColor =
        inStockVarColors.length === 0
          ? detectColorFromText(String(group.nome || existingData?.nome || ''))?.name || ''
          : '';
      const activeCores = Array.from(
        new Set(
          (inStockVarColors.length > 0
            ? inStockVarColors
            : [
                ...Array.from(group.colors).map((c) => normalizeColorName(c)),
                ...existingColors.map((c) => normalizeColorName(c)),
                fallbackTitleColor,
              ]
          ).filter(Boolean)
        )
      );

      const checkedAtTs = detailCheckedAtMap.get(group.docId);
      const effectiveName = String(group.nome || existingData?.nome || '');
      const effectiveSku = String(group.codigo || existingData?.codigo || '');
      const effectiveCat = String(group.categoriaStore || existingData?.categoriaStore || '');
      const effectiveSubcat = String(group.subcategoriaStore || existingData?.subcategoriaStore || '');
      const effectiveDesc = String(group.descricao || existingData?.descricao || '');
      const excludedFromStore = isExcludedCatalogItem({
        name: effectiveName,
        integration: { sku: effectiveSku },
        category: effectiveCat,
        subcategory: effectiveSubcat,
        description: effectiveDesc,
        sizes: activeTamanhos,
        variacoes: mergedVariacoes,
      });

      const effectiveStock =
        mergedVariacoesList.length > 0
          ? estoqueTotalVariacoes
          : group.hasParentRecord
            ? Math.max(0, group.estoqueDireto ?? 0)
            : Math.max(0, Number(existingData?.estoque ?? 0));

      const payload: Record<string, unknown> = {
        blingId: group.blingId,
        ativo: !excludedFromStore && effectiveStock > 0,
        deletedInBling: false,
        updatedAt: FieldValue.serverTimestamp(),
        syncedAtIso: nowIso,
        ...(group.summaryImageKey ? { summaryImageKey: group.summaryImageKey } : {}),
        ...(checkedAtTs ? { detailCheckedAt: checkedAtTs } : {}),
      };

      if (group.hasParentRecord) {
        payload.nome = group.nome;
        payload.codigo = group.codigo;
        payload.preco = group.preco ?? 0;
        payload.estoque = effectiveStock;
        payload.pendingParentSync = false;
        if (shouldUpdateImages) {
          payload.imagemURL = mergedImagemURL;
          payload.imagens = mergedImagens;
        }
        if (group.categoria) payload.categoria = group.categoria;
        if (group.categoriaStore) payload.categoriaStore = group.categoriaStore;
        if (group.subcategoriaStore) payload.subcategoriaStore = group.subcategoriaStore;
        if (group.categoriaId !== undefined) payload.categoriaId = group.categoriaId;
        if (group.descricao) payload.descricao = group.descricao;
      } else {
        // Variação sem pai na página: apenas preenche campos faltantes sem sobrescrever dados autoritativos do pai já salvos
        if (group.nome && !existingData?.nome) payload.nome = group.nome;
        if (group.codigo && !existingData?.codigo) payload.codigo = group.codigo;
        if (group.categoria && !existingData?.categoria) payload.categoria = group.categoria;
        if (group.categoriaStore && !existingData?.categoriaStore) payload.categoriaStore = group.categoriaStore;
        if (group.subcategoriaStore && !existingData?.subcategoriaStore) {
          payload.subcategoriaStore = group.subcategoriaStore;
        }
        if (shouldUpdateImages && mergedImagens.length > 0) {
          payload.imagemURL = mergedImagemURL;
          payload.imagens = mergedImagens;
        } else if (
          mergedImagemURL &&
          !existingMainUrl &&
          getImageQualityTier(mergedImagemURL) > getImageQualityTier(existingMainUrl)
        ) {
          payload.imagemURL = mergedImagemURL;
        }
        if (group.preco !== undefined && group.preco > 0 && !(Number(existingData?.preco || 0) > 0)) {
          payload.preco = group.preco;
        }
        if (group.descricao && !existingData?.descricao) payload.descricao = group.descricao;
        if (!existingData?.codigo && !group.codigo) {
          payload.pendingParentSync = true;
        }
        if (mergedVariacoesList.length > 0) {
          payload.estoque = estoqueTotalVariacoes;
        }
      }

      payload.tamanhos = activeTamanhos;
      if (activeCores.length > 0) {
        payload.cores = activeCores;
      }
      if (mergedVariacoesList.length > 0) {
        payload.variacoes = mergedVariacoes;
      }

      if (existingData && (group.authoritativeVariacoesLoaded || group.hasParentRecord)) {
        batch.update(docRef, payload);
      } else {
        batch.set(docRef, payload, { merge: true });
      }
    }

    await batch.commit();
  }

  const isLastPage = lista.length < 100;
  const activeDocIds = entries.filter((g) => !g.deletedInBling).map((g) => g.docId);

  return {
    success: true,
    finalizado: isLastPage,
    ...(isLastPage ? { totalImportado: lista.length } : { proximaPagina: pagina + 1 }),
    importadosNaPagina: lista.length,
    documentosGravados: grouped.size,
    docIds: activeDocIds,
  };
}

let activeSyncAllPromise: Promise<SyncAllResult> | null = null;

/**
 * Percorre automaticamente páginas do Bling (`pagina = startPage` até o fim)
 * dentro de um orçamento de tempo seguro para nunca estourar o timeout da Vercel.
 * Quando inicia na página 1 e finaliza sem erros/timeouts, desativa no Firestore
 * documentos de produtos que foram removidos/inativados no Bling.
 */
export async function syncAllBlingProdutosToFirestore(options?: {
  startPage?: number;
  maxExecutionMs?: number;
  maxPages?: number;
  enrichHighResImages?: boolean;
  forceRefresh?: boolean;
}): Promise<SyncAllResult> {
  if (activeSyncAllPromise) {
    return activeSyncAllPromise;
  }

  const startPage = Math.max(1, Math.floor(options?.startPage || 1));
  if (!tryAcquireHeavyBlingLock('bling-firestore-sync', 10 * 60 * 1000)) {
    return {
      success: true,
      finalizado: true,
      paginaInicial: startPage,
      ultimaPagina: startPage,
      paginasProcessadas: 0,
      totalImportado: 0,
      documentosGravados: 0,
      duracaoMs: 0,
    };
  }

  activeSyncAllPromise = (async () => {
    const startedAt = Date.now();
    const maxExecutionMs = Math.max(2000, options?.maxExecutionMs ?? (process.env.VERCEL ? 8200 : 180000));
    const maxPages = Math.max(1, options?.maxPages ?? 100);

    let currentPage = startPage;
    let ultimaPagina = startPage;
    let paginasProcessadas = 0;
    let totalImportado = 0;
    let documentosGravados = 0;
    let desativados = 0;
    let finalizado = false;
    let paradoPorTempoLimite = false;
    let hadError = false;
    const seenDocIds = new Set<string>();

    while (paginasProcessadas < maxPages) {
      if (isBlingDailyQuotaExceeded()) {
        paradoPorTempoLimite = true;
        break;
      }
      const elapsed = Date.now() - startedAt;
      if (paginasProcessadas > 0 && elapsed >= maxExecutionMs) {
        paradoPorTempoLimite = true;
        break;
      }

      const remainingBudget = Math.max(500, maxExecutionMs - elapsed);
      const shouldEnrich = options?.enrichHighResImages ?? true;
      let pageResult: SyncProdutosPageResult;
      try {
        pageResult = await syncBlingProdutosPageToFirestore(currentPage, {
          enrichHighResImages: shouldEnrich,
          forceRefresh: Boolean(options?.forceRefresh),
          maxDetailMs: shouldEnrich
            ? (process.env.VERCEL ? Math.min(2000, Math.floor(remainingBudget * 0.3)) : Math.min(20000, Math.floor(remainingBudget * 0.5)))
            : 0,
        });
      } catch (err) {
        hadError = true;
        throw err;
      }

      for (const id of pageResult.docIds || []) {
        seenDocIds.add(id);
      }

      ultimaPagina = currentPage;
      paginasProcessadas++;
      totalImportado += pageResult.importadosNaPagina || 0;
      documentosGravados += pageResult.documentosGravados || 0;

      if (pageResult.finalizado) {
        finalizado = true;
        break;
      }

      currentPage = pageResult.proximaPagina || currentPage + 1;
    }

    // Reconciliação de exclusões: ao concluir crawl completo a partir da página 1, desativa no Firestore
    // quaisquer produtos que não estão mais ativos no Bling.
    if (
      finalizado &&
      startPage === 1 &&
      !paradoPorTempoLimite &&
      !isBlingDailyQuotaExceeded() &&
      !hadError
    ) {
      try {
        const db = getAdminFirestore();
        const activeSnap = await db.collection('products').where('ativo', '==', true).select('blingId').get();
        const staleRefs: FirebaseFirestore.DocumentReference[] = [];
        activeSnap.forEach((docSnap) => {
          const data = docSnap.data() || {};
          const blingId = String(data.blingId || '').trim();
          const isBlingDoc = Boolean(blingId) || /^\d+$/.test(docSnap.id);
          if (isBlingDoc && !seenDocIds.has(docSnap.id) && (!blingId || !seenDocIds.has(blingId))) {
            staleRefs.push(docSnap.ref);
          }
        });

        const nowIso = new Date().toISOString();
        for (let i = 0; i < staleRefs.length; i += 400) {
          const chunk = staleRefs.slice(i, i + 400);
          const batch = db.batch();
          for (const ref of chunk) {
            batch.set(
              ref,
              {
                ativo: false,
                deletedInBling: true,
                deletedInBlingAt: nowIso,
                updatedAt: FieldValue.serverTimestamp(),
              },
              { merge: true }
            );
          }
          await batch.commit();
        }
        desativados = staleRefs.length;
        if (desativados > 0) {
          console.log(`[Bling Sync] Reconciliação concluiu: ${desativados} produto(s) removido(s)/inativado(s) no Bling foram desativados no Firestore.`);
        }
      } catch (reconcileErr) {
        console.warn('[Bling Sync] Erro ao desativar produtos removidos do Bling no Firestore:', reconcileErr);
      }
    }

    return {
      success: true,
      finalizado,
      paginaInicial: startPage,
      ultimaPagina,
      ...(finalizado ? {} : { proximaPagina: currentPage }),
      paginasProcessadas,
      totalImportado,
      documentosGravados,
      desativados,
      duracaoMs: Date.now() - startedAt,
      ...(paradoPorTempoLimite ? { paradoPorTempoLimite: true } : {}),
    };
  })().finally(() => {
    releaseHeavyBlingLock('bling-firestore-sync');
    activeSyncAllPromise = null;
  });

  return activeSyncAllPromise;
}

/**
 * Atualiza documentos existentes na coleção `products` do Firestore com imagens em alta resolução
 * vindas do store em memória do Bling sempre que estiverem sem foto ou usando miniatura (`/t/`).
 */
export async function syncImageStoreToFirestore(imageSeed?: InMemoryImageStoreSnapshot): Promise<{ updated: number }> {
  if (!imageSeed) return { updated: 0 };
  const hasAnyImage =
    Object.keys(imageSeed.byId || {}).length > 0 || Object.keys(imageSeed.bySku || {}).length > 0;
  if (!hasAnyImage) return { updated: 0 };
  const db = getAdminFirestore();
  const snap = await db.collection('products').get();
  if (snap.empty) return { updated: 0 };

  const updates: Array<{ ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown> }> = [];

  snap.forEach((docSnap) => {
    const d = (docSnap.data() || {}) as Record<string, unknown>;
    const docId = docSnap.id;
    const blingId = String(d.blingId || docId).trim();
    const codigo = String(d.codigo || '').toUpperCase().trim();

    const candidatePools: string[] = [
      ...(imageSeed.byId[docId] || []),
      ...(imageSeed.byId[blingId] || []),
      ...(codigo ? imageSeed.bySku[codigo] || [] : []),
    ];

    if (d.variacoes && typeof d.variacoes === 'object') {
      for (const v of Object.values(d.variacoes as Record<string, Record<string, unknown>>)) {
        const vId = String(v?.blingId || '').trim();
        const vSku = String(v?.codigo || '').toUpperCase().trim();
        if (vId && imageSeed.byId[vId]) candidatePools.push(...imageSeed.byId[vId]);
        if (vSku && imageSeed.bySku[vSku]) candidatePools.push(...imageSeed.bySku[vSku]);
      }
    }

    const activeImages = mergeImagesSafe(
      candidatePools.filter((u) => getImageQualityTier(u) >= 2 && !isThumbnailLikeUrl(u)),
      [],
      { replaceRemoteBling: true }
    );
    if (activeImages.length === 0) return;

    const existingImagens = Array.isArray(d.imagens)
      ? (d.imagens as unknown[]).filter((u): u is string => typeof u === 'string' && u.trim() !== '')
      : [];

    const existingCanonical = existingImagens.map(getCanonicalImageKey).join('|');
    const activeCanonical = activeImages.map(getCanonicalImageKey).join('|');

    if (existingCanonical !== activeCanonical) {
      updates.push({
        ref: docSnap.ref,
        data: {
          imagemURL: activeImages[0],
          imagens: activeImages,
          updatedAt: FieldValue.serverTimestamp(),
        },
      });
    }
  });

  for (let i = 0; i < updates.length; i += 400) {
    const chunk = updates.slice(i, i + 400);
    const batch = db.batch();
    for (const u of chunk) {
      batch.set(u.ref, u.data, { merge: true });
    }
    await batch.commit();
  }

  if (updates.length > 0) {
    console.log(`[Bling Images -> Firestore] Upgraded ${updates.length} product docs to high-resolution images.`);
  }
  return { updated: updates.length };
}

