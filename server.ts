import express, { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import QRCode from 'qrcode';
import crypto from 'crypto';
import { getAdminAuth, getAdminFirestore } from './lib/firebaseAdmin.js';
import { registerBlingRoutes, blingRouter, blingAuthInterceptorMiddleware, fetchFromBling, loadBlingTokens, ensureBlingAuthorized, refreshBlingToken } from './server-bling.js';
import { registerMelhorEnvioRoutes, startMelhorEnvioAutoSync } from './server-melhor-envio.js';
import { hasFirebaseAdminEnv, hasFirestoreBlingToken, getValidBlingToken as getFirestoreValidToken } from './lib/blingToken.js';
import { syncAllBlingProdutosToFirestore, syncImageStoreToFirestore } from './lib/blingSyncProdutos.js';
import { filterVisibleProducts } from './src/lib/hiddenProducts.js';
import {
  detectColorFromText,
  inferStoreCategory,
  normalizeColorOptions,
  parseBlingVariantMeta,
  sortSizes,
} from './src/lib/catalogVariants.js';
import {
  applyBlingImageOverrides,
  recordProductImage,
  syncImagesFromBling,
  extractImagesFromBlingItem,
  loadImageStore,
  saveImageStore,
  clearImageCache,
  stripResizeAndCompressionParams,
  applyImageRecordToStore,
  getBlingImagesForProduct,
  isPlaceholderImageUrl,
  isLegacyExternalUrl,
  isThumbnailLikeUrl,
  isImageSyncRunning,
  setCatalogFetchInProgress,
  getLastBlingImageSyncTime
} from './server-bling-images.js';
import {
  createStoreOrder,
  getCustomerOrders,
  retryPendingBlingOrders,
  trackStoreOrders,
  requestStoreOrderReturn
} from './server-orders.js';

dotenv.config({ override: !process.env.VERCEL });

const __filename =
  typeof import.meta?.url === 'string'
    ? fileURLToPath(import.meta.url)
    : path.resolve(process.cwd(), 'server.ts');
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// In-memory catalog cache for instant responses and automatic background sync (up to 1350 Bling products)
let catalogCache: {
  products: any[];
  count: number;
  blingConnected: boolean;
  blingCount: number;
  blingRawCount: number;
  blingError: string | null;
  hiddenCount?: number;
  totalRegisteredItems?: number;
  uniqueModels?: number;
  totalUnitsInStock?: number;
  timestamp: number;
} | null = null;
const CATALOG_CACHE_TTL_MS = 4 * 60 * 1000; // 4 minutes fresh TTL with silent stale-while-revalidate

export function invalidateCatalogCache() {
  catalogCache = null;
  console.log('[Catalog Cache] Invalidated. Rebuilding fresh catalog from Bling ERP...');
}

export function reapplyImagesToCachedCatalog() {
  if (catalogCache && Array.isArray(catalogCache.products)) {
    catalogCache = {
      ...catalogCache,
      products: applyBlingImageOverrides(catalogCache.products),
    };
  }
}

// Mercado Pago Credentials
const MERCADO_PAGO_PUBLIC_KEY = process.env.MERCADO_PAGO_PUBLIC_KEY || 'APP_USR-20a95c8d-1249-4b33-b19f-39e50c1a8407';
const MERCADO_PAGO_ACCESS_TOKEN = process.env.MERCADO_PAGO_ACCESS_TOKEN || 'APP_USR-303476054689744-112315-34c48d816c8619d52cd21d0e66089953-2461933848';
const MERCADO_PAGO_CLIENT_ID = process.env.MERCADO_PAGO_CLIENT_ID || '303476054639744';
const MERCADO_PAGO_CLIENT_SECRET = process.env.MERCADO_PAGO_CLIENT_SECRET || '8rOCfqthFSr1w61r2PXOHf3yA4uAs8SM';
const MERCADO_PAGO_API_BASE = 'https://api.mercadopago.com';

// Robust HTML cleaning function that strips <p>, <br>, tags and entities
function cleanDescription(raw?: string): string {
  if (!raw) return '';
  let text = String(raw);
  text = text
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&');

  text = text
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<p[^>]*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<div[^>]*>/gi, '')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]*>?/gm, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&[a-zA-Z0-9#]+;/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text;
}

function detectColorFromName(name: string): { name: string; hex: string } | null {
  return detectColorFromText(name);
}

// Map product category and title to app categories
function mapCategoryAndSubcategory(
  productName: string,
  categories?: Array<{ name?: { pt?: string } | string }>
): { category: 'roupas' | 'calcados' | 'acessorios'; subcategory: 'hoodies' | 'camisetas' | 'calcas' | 'shorts' | 'sneakers' | 'bones' | 'bags' | 'acessorios-metal' } {
  const allCatNames = (categories || [])
    .map(c => (typeof c.name === 'object' && c.name?.pt ? c.name.pt : (c.name || '')))
    .join(' ');

  return inferStoreCategory(productName, allCatNames);
}

let activeCatalogBuildPromise: Promise<{
  success: boolean;
  count: number;
  products: any[];
  blingConnected: boolean;
  blingCount: number;
  blingRawCount: number;
  blingError: string | null;
  hiddenCount: number;
  totalRegisteredItems: number;
  blingRegisteredSKUs: number;
  uniqueModels: number;
  totalUnitsInStock: number;
  syncedAt: string;
}> | null = null;

async function buildAndCacheCatalog(options?: { forceImageSync?: boolean }) {
  if (activeCatalogBuildPromise) {
    return activeCatalogBuildPromise;
  }

  activeCatalogBuildPromise = (async () => {
    const products: any[] = [];
    let blingConnected = false;
    let blingCount = 0;
    let blingRawCount = 0;
    let blingError: string | null = null;
    const zeroStockFromBlingKeys = new Set<string>();

    // Merge all live products from Bling ERP seamlessly when connected (supports all 1411+ items & variations)
    try {
      const blingTokens = loadBlingTokens();
      const hasRemoteBling = hasFirebaseAdminEnv() ? await hasFirestoreBlingToken() : false;
      if (blingTokens?.access_token || blingTokens?.refresh_token || hasRemoteBling) {
        // Interceptor pré-sincronização: verifica validade/expiração e renova via refresh_token antes da paginação
        const tokenReady = await ensureBlingAuthorized({ verifyLive: true });
        if (!tokenReady) {
          throw new Error('Token do Bling expirado ou inválido; renovação automática pendente de nova autorização OAuth.');
        }
        setCatalogFetchInProgress(true);
        const MAX_BLING_PRODUCTS = 10000;
        const blingRaw: any[] = [];
        const seenBlingIds = new Set<number>();
        const pushUniqueBling = (items: any[]) => {
          for (const it of items) {
            if (it?.situacao === 'I' || it?.situacao === 'E') continue;
            if (it?.id && !seenBlingIds.has(it.id) && blingRaw.length < MAX_BLING_PRODUCTS) {
              seenBlingIds.add(it.id);
              blingRaw.push(it);
            }
          }
        };

        // 1. Fetch ALL active pages (criterio=2: Ativos) until Bling returns < 100 items
        for (let p = 1; p <= 100 && blingRaw.length < MAX_BLING_PRODUCTS; p++) {
          try {
            const pageData = await fetchFromBling(`/produtos?pagina=${p}&limite=100&criterio=2`);
            const items = pageData?.data || [];
            if (items.length > 0) {
              pushUniqueBling(items);
            }
            if (items.length < 100) break;
            await new Promise(resolve => setTimeout(resolve, 140));
          } catch (pageErr: any) {
            console.warn(`[Bling Sync] Stopped pagination at page ${p}:`, pageErr?.message || pageErr);
            break;
          }
        }

        blingConnected = true;
        blingRawCount = blingRaw.length;
        console.log(`[Bling Sync] Fetched ${blingRaw.length} total raw active items (limit ${MAX_BLING_PRODUCTS}) from Bling ERP.`);

        // 2. Fetch REAL stock balances via /estoques/saldos in sequential chunks of 50 (rate-limiter enforces safe Bling pace)
        const realStockMap = new Map<number, number>();
        let stockApiQueried = false;
        const allBlingIds = blingRaw.map((bp: any) => bp.id).filter(Boolean);
        const stockChunks: number[][] = [];
        for (let i = 0; i < allBlingIds.length; i += 50) {
          stockChunks.push(allBlingIds.slice(i, i + 50));
        }

        for (const chunk of stockChunks) {
          try {
            const qs = chunk.map((id: number) => `idsProdutos[]=${id}`).join('&');
            const stockRes = await fetchFromBling(`/estoques/saldos?${qs}`);
            stockApiQueried = true;
            const entries = stockRes?.data || [];
            for (const entry of entries) {
              const pId = entry?.produto?.id;
              if (pId) {
                const bal = entry.saldoVirtualTotal ?? entry.saldoFisicoTotal ?? entry.saldoFisico ?? 0;
                realStockMap.set(Number(pId), Math.max(0, Number(bal) || 0));
              }
            }
          } catch (stockChunkErr: any) {
            console.warn(`[Bling Stock] Chunk fetch notice:`, stockChunkErr?.message || stockChunkErr);
          }
        }

        // When explicitly requested, ensure high-res internal Bling images sync without racing catalog build
        if (options?.forceImageSync && Date.now() - getLastBlingImageSyncTime() > 3 * 60 * 1000) {
          syncImagesFromBling({ onBatchSaved: () => reapplyImagesToCachedCatalog() })
            .then(() => reapplyImagesToCachedCatalog())
            .catch(() => {});
        }

        // Index by Bling ID so parent products (formato === 'V') & their child variations (idProdutoPai) always stay unified
        const byBlingId = new Map<number, any>();
        blingRaw.forEach((bp: any) => {
          if (bp.id) byBlingId.set(bp.id, bp);
        });
        const referencedParentIds = new Set<number>();
        blingRaw.forEach((bp: any) => {
          if (bp.idProdutoPai) referencedParentIds.add(bp.idProdutoPai);
        });

        const productGroups: Record<string, {
          id: number;
          baseName: string;
          items: any[];
          parentItem: any | null;
          childItems: any[];
          price: number;
          category: 'roupas' | 'calcados' | 'acessorios';
          subcategory: any;
        }> = {};

        blingRaw.forEach((bp: any) => {
          const parentId = bp.idProdutoPai
            ? Number(bp.idProdutoPai)
            : (bp.formato === 'V' || referencedParentIds.has(bp.id) ? Number(bp.id) : null);
          const parentItem = parentId ? byBlingId.get(parentId) : null;
          const sourceForTitle = parentItem || bp;
          const rawName = (sourceForTitle.nome || bp.nome || '').trim();
          const parsedTitle = parseBlingVariantMeta({
            nome: rawName,
            variacaoNome: sourceForTitle.variacao?.nome,
            isParentContainer: Boolean(parentItem) || bp.formato === 'V' || referencedParentIds.has(bp.id),
          });
          const baseName = parsedTitle.baseName || rawName;
          const groupKey = parentId ? `parent:${parentId}` : `item:${bp.id}`;

          if (!productGroups[groupKey]) {
            const { category, subcategory } = mapCategoryAndSubcategory(baseName);
            productGroups[groupKey] = {
              id: parentId || bp.id,
              baseName,
              items: [],
              parentItem: null,
              childItems: [],
              price: parseFloat(sourceForTitle.preco || bp.preco || '99.90'),
              category,
              subcategory,
            };
          }

          if (parentId && bp.id === parentId) {
            productGroups[groupKey].parentItem = bp;
            productGroups[groupKey].items.unshift(bp);
            if (bp.preco && parseFloat(bp.preco) > 0) {
              productGroups[groupKey].price = parseFloat(bp.preco);
            }
          } else {
            productGroups[groupKey].childItems.push(bp);
            productGroups[groupKey].items.push(bp);
          }
        });

        // Sort newest Bling product IDs first so recently registered products show up right at the top
        const sortedGroups = Object.values(productGroups).sort((a, b) => Number(b.id) - Number(a.id));

        const existingBlingIds = new Set(products.map(p => String(p.integration?.blingId || '')));

        const STUDIO_CUTOUT_BY_SKU: Array<{ prefixes: string[]; images: string[] }> = [
          {
            prefixes: ['OTSR1977'],
            images: ['/assets/aistudio/C_pia_de_NOVIDADE__3__f437c7b1.png', '/assets/aistudio/C_pia_de_NOVIDADE__1__b4d9c4a8.png'],
          },
          {
            prefixes: ['OTSR506'],
            images: ['/assets/aistudio/Design_sem_nome__4__bfe5aaed.png', '/assets/aistudio/Design_sem_nome__3__5e605338.png'],
          },
          {
            prefixes: ['OTSBP501', 'OVTP501'],
            images: ['/assets/aistudio/Design_sem_nome__5__ef8bca41.png', '/assets/aistudio/Design_sem_nome__6__d3642ec7.png'],
          },
          {
            prefixes: ['OTSBP502'],
            images: ['/assets/aistudio/Design_sem_nome__8__f44ad096.png', '/assets/aistudio/Design_sem_nome__7__e6ab934f.png'],
          },
          {
            prefixes: ['OTSP500', 'OVTP502'],
            images: ['/assets/aistudio/Design_sem_nome__9__73306863.png'],
          },
          {
            prefixes: ['OTSR505'],
            images: ['/assets/aistudio/Design_sem_nome__10__4bbf1037.png'],
          },
          {
            prefixes: ['OTSPN500'],
            images: ['/assets/aistudio/Design_sem_nome__11__0eda0283.png'],
          },
        ];

        let addedFromBlingCount = 0;
        const imageStore = loadImageStore();
        let imageStoreDirty = false;
        const groupsNeedingDetailFetch: Array<{ id: number; sku: string; baseName: string; productRef: any }> = [];

        for (const [gIdx, group] of sortedGroups.entries()) {
          const firstItem = group.items[0];
          const groupSku = firstItem?.codigo || `BLING-${group.id}`;
          const normalizedBaseName = group.baseName.toLowerCase().trim();

          // Extract ALL images across parent & variation items (preferring full-res over /produtos list /t/ thumbnails)
          const blingImagesSet = new Set<string>();
          for (const it of group.items) {
            const itemImgs = extractImagesFromBlingItem(it);
            for (const url of itemImgs) {
              blingImagesSet.add(url);
            }
            const fullResItemImgs = itemImgs.filter(u => !isThumbnailLikeUrl(u));
            if (fullResItemImgs.length > 0) {
              if (
                applyImageRecordToStore(
                  imageStore,
                  {
                    sku: it.codigo,
                    id: it.id,
                    parentId: it.idProdutoPai || group.id,
                    name: group.baseName
                  },
                  fullResItemImgs
                )
              ) {
                imageStoreDirty = true;
              }
            }
          }
          const blingExtractedImages = Array.from(blingImagesSet);
          const fullResBlingExtracted = blingExtractedImages.filter(u => !isThumbnailLikeUrl(u));

          if (fullResBlingExtracted.length > 0) {
            if (
              applyImageRecordToStore(
                imageStore,
                {
                  sku: groupSku,
                  id: group.id,
                  name: group.baseName
                },
                fullResBlingExtracted
              )
            ) {
              imageStoreDirty = true;
            }
          }

          // Skip only exact duplicate Bling parent IDs
          if (existingBlingIds.has(String(group.id))) {
            continue;
          }

          const resolveItemStock = (it: any): number => {
            if (realStockMap.has(Number(it.id))) {
              return realStockMap.get(Number(it.id))!;
            }
            const summaryStock = it.estoque?.saldoVirtualTotal ?? it.estoque?.saldoFisicoTotal ?? it.estoque?.saldoFisico;
            if (summaryStock !== undefined && summaryStock !== null) {
              return Math.max(0, Number(summaryStock) || 0);
            }
            return stockApiQueried ? 0 : 0;
          };

          // Exclude the parent container item whenever real child variations exist so parent 0-stock/name never pollutes variantsList
          const effectiveItems = group.childItems.length > 0 ? group.childItems : group.items;

          const parsedVariants = effectiveItems.map(it => {
            const meta = parseBlingVariantMeta({
              nome: it.nome || '',
              variacaoNome: it.variacao?.nome || '',
              isParentContainer: group.childItems.length === 0 && (it.formato === 'V' || referencedParentIds.has(it.id)),
            });
            const vStock = resolveItemStock(it);
            return {
              item: it,
              meta,
              stock: vStock,
            };
          });

          const variantsList = parsedVariants.map(({ item: it, meta, stock: vStock }) => ({
            id: it.id,
            sku: it.codigo || `${groupSku}-${meta.size}`,
            price: parseFloat(it.preco || String(group.price || '119.90')),
            stock: vStock,
            size: meta.size,
            ...(meta.color?.name ? { color: meta.color.name } : {}),
          }));

          // Total stock across actual sellable items/variants
          const totalStock = variantsList.reduce((acc, v) => acc + Math.max(0, v.stock), 0);

          // Automatically hide out-of-stock products from the storefront
          if (totalStock <= 0) {
            zeroStockFromBlingKeys.add(normalizedBaseName);
            if (groupSku) zeroStockFromBlingKeys.add(String(groupSku).toUpperCase().trim());
            for (const it of group.items) {
              if (it.codigo) zeroStockFromBlingKeys.add(String(it.codigo).toUpperCase().trim());
            }
            continue;
          }

          // Strictly display ONLY sizes registered with stock > 0, sorted in canonical ascending order
          const inStockParsed = parsedVariants.filter(pv => pv.stock > 0);
          const hasExplicitSizes = parsedVariants.some(pv => pv.meta.hasExplicitSize);
          const activeSizes = hasExplicitSizes
            ? sortSizes(inStockParsed.map(pv => pv.meta.size))
            : ['Tamanho Único'];

          if (hasExplicitSizes && activeSizes.length === 0) {
            continue;
          }

          // Determine real colors strictly from in-stock sellable variants (never polluted by 0-stock variants or parent wash keywords)
          const rawVariantColors = inStockParsed
            .map(pv => pv.meta.color)
            .filter((c): c is { name: string; hex: string } => Boolean(c));
          const fallbackBaseColor = rawVariantColors.length === 0 ? detectColorFromName(group.baseName) : null;
          const finalColors = normalizeColorOptions(
            rawVariantColors.length > 0 ? rawVariantColors : (fallbackBaseColor ? [fallbackBaseColor] : [])
          );

          // Select images: 1. Full-res live/cached midia.imagens.internas[0].link -> 2. Studio HD cutouts -> 3. List fallback -> 4. Crisp SVG brand card
          const cachedBlingImages = getBlingImagesForProduct({
            name: group.baseName,
            integration: { sku: groupSku, blingId: String(group.id) },
            variantsList
          }) || [];
          const cachedFullRes = cachedBlingImages.filter(u => !isThumbnailLikeUrl(u));
          const combinedFullRes = Array.from(new Set([...fullResBlingExtracted, ...cachedFullRes]));

          const upperGroupSku = String(groupSku || '').toUpperCase().trim();
          const studioPresetMatch = STUDIO_CUTOUT_BY_SKU.find((entry) =>
            entry.prefixes.some((pref) => upperGroupSku.startsWith(pref))
          );

          let images: string[] = [];
          if (combinedFullRes.length > 0) {
            images = combinedFullRes;
          } else if (studioPresetMatch) {
            images = studioPresetMatch.images;
          } else if (cachedBlingImages.length > 0) {
            images = cachedBlingImages;
          } else if (blingExtractedImages.length > 0) {
            images = blingExtractedImages;
          } else {
            images = ['/assets/streetstore-fallback.svg'];
          }

          const priceVal = isNaN(group.price) || group.price <= 0 ? 119.90 : group.price;

          // Clean HTML tags (<p>, <br>, etc.) from product description
          const rawBlingDesc = firstItem?.descricaoCurta || firstItem?.descricaoComplementar || '';
          const cleanedBlingDesc = cleanDescription(rawBlingDesc) || `${group.baseName} - Produto autêntico da Street Store. Acabamento reforçado, resistência e caimento streetwear impecável para compor seu kit no dia a dia.`;

          const productObj = {
            id: `bling-${group.id}`,
            name: group.baseName,
            category: group.category,
            subcategory: group.subcategory,
            price: priceVal,
            originalPrice: Math.round(priceVal * 1.3),
            tag: totalStock <= 3 ? 'POUCAS UNIDADES' : (gIdx < 12 ? 'NOVO DROP' : null),
            rating: 4.8 + ((group.id % 3) / 10),
            reviewsCount: 15 + (group.id % 40),
            images,
            sizes: activeSizes,
            colors: finalColors,
            description: cleanedBlingDesc,
            stockCount: totalStock,
            details: {
              composition: group.category === 'calcados' ? 'Solado em borracha vulcanizada de alta durabilidade' : (group.category === 'acessorios' ? 'Material premium de alta durabilidade' : '100% Algodão Premium Heavyweight'),
              weight: group.category === 'calcados' ? '900g o par' : (group.category === 'acessorios' ? '120g' : '380g/m² Heavyweight'),
              modelInfo: group.category === 'acessorios' ? 'Tamanho e formato ergonômico' : 'Modelagem autêntica da marca',
              origin: 'Itabira - MG // Fabricado no Brasil',
            },
            integration: {
              sku: groupSku,
              barcode: firstItem?.codigo || `789${group.id}`,
              blingId: String(group.id),
              weightGrams: Math.round(parseFloat(firstItem?.pesoBruto || firstItem?.pesoLiquido || '0.450') * 1000),
              dimensionsCm: {
                width: parseFloat(firstItem?.largura || '28'),
                height: parseFloat(firstItem?.altura || '12'),
                depth: parseFloat(firstItem?.profundidade || '32'),
              },
            },
            canonicalUrl: 'https://www.streetstore.com.br',
            variantsList
          };

          const hasLowResOnly = images.length > 0 && images.every(u =>
            isPlaceholderImageUrl(u) || isThumbnailLikeUrl(u)
          );
          if ((blingExtractedImages.length === 0 && images.every(u => isPlaceholderImageUrl(u))) || hasLowResOnly) {
            groupsNeedingDetailFetch.push({
              id: group.id,
              sku: groupSku,
              baseName: group.baseName,
              productRef: productObj
            });
          }

          products.push(productObj);
          existingBlingIds.add(String(group.id));
          addedFromBlingCount++;
        }

        // If background image sync isn't already running, fetch up to 12 missing high-res items inline (including variations) & queue full background sync
        if (groupsNeedingDetailFetch.length > 0) {
          if (!isImageSyncRunning()) {
            const inlineBatch = groupsNeedingDetailFetch.slice(0, 12);
            console.log(`[Bling Sync] ${groupsNeedingDetailFetch.length} products lacked full-res images in /produtos summary. Fetching detail media for ${inlineBatch.length}...`);
            for (const target of inlineBatch) {
              try {
                const detail = await fetchFromBling(`/produtos/${target.id}`);
                const fullData = detail?.data || detail;
                let detailImgs = extractImagesFromBlingItem(fullData);
                let hasTrueFull = detailImgs.some((u: string) => !isThumbnailLikeUrl(u) && !isPlaceholderImageUrl(u));

                if (!hasTrueFull && Array.isArray(fullData?.variacoes) && fullData.variacoes.length > 0) {
                  for (const v of fullData.variacoes.slice(0, 2)) {
                    if (!v?.id) continue;
                    try {
                      const vDetail = await fetchFromBling(`/produtos/${v.id}`);
                      const vImgs = extractImagesFromBlingItem(vDetail?.data || vDetail);
                      const vFull = vImgs.filter((u: string) => !isThumbnailLikeUrl(u) && !isPlaceholderImageUrl(u));
                      if (vFull.length > 0) {
                        detailImgs = Array.from(new Set([...vFull, ...detailImgs.filter((u: string) => !isThumbnailLikeUrl(u))]));
                        hasTrueFull = true;
                        break;
                      }
                    } catch {
                      // continue
                    }
                  }
                }

                if (detailImgs.length > 0) {
                  const detailFull = detailImgs.filter((u: string) => !isThumbnailLikeUrl(u));
                  const existingImgs: string[] = Array.isArray(target.productRef.images)
                    ? target.productRef.images.filter((u: unknown): u is string => typeof u === 'string')
                    : [];
                  const existingFull = existingImgs.filter(
                    (u: string) => !isPlaceholderImageUrl(u) && !isThumbnailLikeUrl(u)
                  );
                  const merged: string[] = Array.from(
                    new Set<string>(
                      detailFull.length > 0
                        ? [...detailFull, ...existingFull]
                        : existingFull.length > 0
                        ? existingFull
                        : detailImgs
                    )
                  );
                  target.productRef.images = merged;
                  if (
                    applyImageRecordToStore(
                      imageStore,
                      { sku: target.sku, id: target.id, name: target.baseName },
                      merged
                    )
                  ) {
                    imageStoreDirty = true;
                  }
                }
              } catch {
                // continue gracefully
              }
            }

            if (groupsNeedingDetailFetch.length > inlineBatch.length) {
              syncImagesFromBling({ onBatchSaved: () => reapplyImagesToCachedCatalog() })
                .then(() => {
                  reapplyImagesToCachedCatalog();
                  if (hasFirebaseAdminEnv()) {
                    syncImageStoreToFirestore().catch(() => {});
                  }
                })
                .catch(() => {});
            }
          } else {
            console.log(`[Bling Sync] Background high-res image sync already active (${groupsNeedingDetailFetch.length} products awaiting detail media).`);
          }
        }

        if (imageStoreDirty) {
          saveImageStore(imageStore);
        }

        blingCount = addedFromBlingCount;
        console.log(`[Bling Sync] Successfully merged ${addedFromBlingCount} unique product models from Bling ERP into storefront catalog.`);
      }
    } catch (blingErr: any) {
      blingError = blingErr?.message || String(blingErr);
      blingConnected = Boolean(loadBlingTokens()?.access_token);
      console.warn('[Catalog] Notice during Bling merge:', blingError);
    } finally {
      setCatalogFetchInProgress(false);
    }

    // Helper to extract base product name (strips variation labels, sizes, colors)
    function extractBaseProductName(rawName: string): string {
      return parseBlingVariantMeta({ nome: rawName, isParentContainer: true }).baseName || rawName;
    }

    // DEDUPLICATION & STOCK AGGREGATION ENGINE
    // Rule: "verifique se tem algum item repetido caso tiver um repetido torne ele uma quantia no estoque do produto real dele sem que fique duplicado"
    const consolidatedMap = new Map<string, any>();

    function ingestOrAggregate(item: any) {
      const blingKey = String(item.integration?.blingId || item.id || '').trim();
      const key = blingKey || extractBaseProductName(item.name).toLowerCase().replace(/\s+/g, ' ');

      if (!consolidatedMap.has(key)) {
        const variants = Array.isArray(item.variantsList) ? [...item.variantsList] : [];
        const inStockSizesFromVars = sortSizes(
          variants.filter((v: any) => (v?.stock ?? 0) > 0 && v?.size).map((v: any) => String(v.size))
        );
        consolidatedMap.set(key, {
          ...item,
          name: extractBaseProductName(item.name) || item.name,
          stockCount: typeof item.stockCount === 'number' ? item.stockCount : 0,
          sizes: inStockSizesFromVars.length > 0
            ? inStockSizesFromVars
            : (Array.isArray(item.sizes) && item.sizes.length > 0 ? sortSizes(item.sizes) : ['Tamanho Único']),
          colors: normalizeColorOptions(Array.isArray(item.colors) ? item.colors : []),
          images: Array.isArray(item.images) ? [...item.images] : [],
          variantsList: variants
        });
      } else {
        const canonical = consolidatedMap.get(key);
        canonical.stockCount += (typeof item.stockCount === 'number' ? item.stockCount : 0);

        if (Array.isArray(item.variantsList)) {
          canonical.variantsList.push(...item.variantsList);
        }

        const inStockVars = canonical.variantsList.filter((v: any) => (v?.stock ?? 0) > 0);
        const aggregatedSizes = inStockVars.length > 0
          ? sortSizes(inStockVars.map((v: any) => String(v.size || '')).filter(Boolean))
          : sortSizes([...(canonical.sizes || []), ...(Array.isArray(item.sizes) ? item.sizes : [])]);
        canonical.sizes = aggregatedSizes.length > 0 ? aggregatedSizes : ['Tamanho Único'];

        const combinedColors = [
          ...(Array.isArray(canonical.colors) ? canonical.colors : []),
          ...(Array.isArray(item.colors) ? item.colors : []),
        ];
        canonical.colors = normalizeColorOptions(combinedColors);

        if (Array.isArray(item.images)) {
          const allCombined = [...canonical.images.map((u: string) => stripResizeAndCompressionParams(u))];
          item.images.forEach((rawImg: string) => {
            const img = stripResizeAndCompressionParams(rawImg);
            if (img && !allCombined.includes(img)) {
              allCombined.push(img);
            }
          });
          const realOnly = allCombined.filter((img: string) => !isPlaceholderImageUrl(img));
          const nativeBlingOnly = realOnly.filter((img: string) => !isLegacyExternalUrl(img));
          const pool = nativeBlingOnly.length > 0 ? nativeBlingOnly : (realOnly.length > 0 ? realOnly : allCombined);
          const nonThumb = pool.filter((img: string) => !isThumbnailLikeUrl(img));
          canonical.images = (nonThumb.length > 0 ? nonThumb : pool).slice(0, 8);
        }

        if (canonical.stockCount > 0 && canonical.tag === 'SEM ESTOQUE') {
          canonical.tag = canonical.stockCount <= 3 ? 'POUCAS UNIDADES' : null;
        }
      }
    }

    // Ingest ONLY live Bling ERP products (local/PDF catalog removed)
    products.forEach((p) => ingestOrAggregate(p));

    const allConsolidatedProducts = Array.from(consolidatedMap.values());
    const inStockProducts = allConsolidatedProducts.filter((p) => (p.stockCount ?? 0) > 0);
    const visibleProducts = filterVisibleProducts(inStockProducts);
    const finalProducts = applyBlingImageOverrides(visibleProducts)
      .sort((a, b) => Number(b.integration?.blingId || 0) - Number(a.integration?.blingId || 0))
      .map((p, idx) => ({
        ...p,
        tag: (p.stockCount ?? 0) <= 3 ? 'POUCAS UNIDADES' : (idx < 16 ? 'NOVO DROP' : null),
      }));

    console.log(`[Catalog Engine] Processed inventory: ${finalProducts.length} in-stock visible models (${allConsolidatedProducts.length - inStockProducts.length} out-of-stock auto-hidden, ${inStockProducts.length - visibleProducts.length} hidden per store rules).`);

    const hiddenCount = allConsolidatedProducts.length - finalProducts.length;
    const totalRegisteredItems = blingRawCount;
    const uniqueModels = finalProducts.length;
    const totalUnitsInStock = finalProducts.reduce((sum, p) => sum + (p.stockCount || 0), 0);
    const nowTs = Date.now();

    // Save to cache atomically for instant storefront responses & automatic background sync
    catalogCache = {
      products: finalProducts,
      count: finalProducts.length,
      blingConnected,
      blingCount,
      blingRawCount,
      blingError,
      hiddenCount,
      totalRegisteredItems,
      uniqueModels,
      totalUnitsInStock,
      timestamp: nowTs
    };

    return {
      success: true,
      count: finalProducts.length,
      products: finalProducts,
      blingConnected,
      blingCount,
      blingRawCount,
      blingError,
      hiddenCount,
      totalRegisteredItems,
      blingRegisteredSKUs: totalRegisteredItems,
      uniqueModels,
      totalUnitsInStock,
      syncedAt: new Date(nowTs).toISOString()
    };
  })().finally(() => {
    activeCatalogBuildPromise = null;
  });

  return activeCatalogBuildPromise;
}

// Health check endpoint
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ ok: true, status: 'healthy', timestamp: new Date().toISOString() });
});

// Unified Storefront Catalog API (Bling ERP v3 up to 1350 items + Automatic Stock & High-Res Images)
app.get('/api/catalog/products', async (req: Request, res: Response) => {
  try {
    const forceRefresh = req.query.refresh === 'true';
    const isCacheFresh = catalogCache && (Date.now() - catalogCache.timestamp < CATALOG_CACHE_TTL_MS);

    if (!forceRefresh && catalogCache) {
      if (!isCacheFresh) {
        // Stale-while-revalidate: serve immediately and pull latest 1350 Bling items silently in background
        buildAndCacheCatalog({ forceImageSync: false }).catch(() => {});
      }
      return res.json({
        success: true,
        count: catalogCache.count,
        products: catalogCache.products,
        blingConnected: catalogCache.blingConnected,
        blingCount: catalogCache.blingCount,
        blingRawCount: catalogCache.blingRawCount,
        blingError: catalogCache.blingError,
        hiddenCount: catalogCache.hiddenCount ?? 0,
        totalRegisteredItems: catalogCache.totalRegisteredItems ?? catalogCache.blingRawCount ?? 0,
        blingRegisteredSKUs: catalogCache.totalRegisteredItems ?? catalogCache.blingRawCount ?? 0,
        uniqueModels: catalogCache.uniqueModels ?? catalogCache.count,
        totalUnitsInStock: catalogCache.totalUnitsInStock ?? 0,
        cached: true,
        syncedAt: new Date(catalogCache.timestamp).toISOString()
      });
    }

    const payload = await buildAndCacheCatalog({ forceImageSync: req.query.refresh === 'true' });
    return res.json(payload);
  } catch (error: any) {
    console.error('Error fetching products:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro ao consultar produtos'
    });
  }
});

// Real-time Webhook for Bling ERP (estoque, produtos, imagens)
app.post(['/api/webhooks/bling', '/api/bling/webhook'], async (req: Request, res: Response) => {
  console.log('[Webhook] Bling ERP event received:', JSON.stringify(req.body));
  
  try {
    const payload = req.body || {};
    const itemData = payload.data || payload.produto || payload;
    
    // Extract images if provided in payload
    const extractedImages = extractImagesFromBlingItem(itemData);
    if (extractedImages.length > 0) {
      recordProductImage({
        sku: itemData.codigo || itemData.sku,
        name: itemData.nome,
        id: itemData.id
      }, extractedImages);
      console.log(`[Webhook Bling] Successfully captured ${extractedImages.length} updated images for product:`, itemData.nome || itemData.codigo);
    } else if (itemData.id) {
      // If only ID was sent in webhook, fetch the updated product images from Bling API
      try {
        const fullProd = await fetchFromBling(`/produtos/${itemData.id}`);
        const freshImgs = extractImagesFromBlingItem(fullProd?.data || fullProd);
        if (freshImgs.length > 0) {
          recordProductImage({
            sku: fullProd?.data?.codigo,
            name: fullProd?.data?.nome,
            id: itemData.id
          }, freshImgs);
          console.log(`[Webhook Bling] Fetched ${freshImgs.length} images from Bling API for product ID ${itemData.id}`);
        }
      } catch (fetchErr: any) {
        console.warn('[Webhook Bling] Notice: detailed product fetch skipped:', fetchErr?.message);
      }
    }
  } catch (err: any) {
    console.error('[Webhook Bling] Processing error:', err);
  }

  invalidateCatalogCache();
  res.status(200).json({ received: true, message: 'Bling webhook processed. Catalog and images updated.' });
});

// Direct Catalog Revalidation / Sync Trigger
app.all('/api/catalog/refresh', (req: Request, res: Response) => {
  if (req.query.clearImages === 'true') {
    clearImageCache(true);
  }
  invalidateCatalogCache();
  res.json({ success: true, message: 'Cache do catálogo limpo e sincronizado com sucesso!' });
});

// Clear cached images & catalog cache so full high-resolution Bling images are reloaded
app.all(['/api/bling/clear-cache', '/api/bling/clear-image-cache'], (_req: Request, res: Response) => {
  clearImageCache(true);
  invalidateCatalogCache();
  res.json({ success: true, message: 'Cache de imagens e do catálogo limpos com sucesso!' });
});

// Full Bling ERP Image Synchronizer (Interceptado por blingAuthInterceptorMiddleware)
app.all(['/api/bling/sync-images', '/api/bling/sync-media'], blingAuthInterceptorMiddleware, async (req: Request, res: Response) => {
  try {
    const clearCache = req.query.clearCache === 'true' || req.body?.clearCache === true;
    const result = await syncImagesFromBling({
      clearCache,
      onBatchSaved: () => reapplyImagesToCachedCatalog()
    });
    reapplyImagesToCachedCatalog();
    if (hasFirebaseAdminEnv()) {
      syncImageStoreToFirestore().catch(() => {});
    }
    res.json(result);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Falha ao sincronizar imagens do Bling'
    });
  }
});

// Update or set image for any product directly (by SKU, Name, or ID)
app.post('/api/products/update-image', (req: Request, res: Response) => {
  try {
    const { sku, name, id, imageUrl, images } = req.body;
    const urls: string[] = [];
    if (imageUrl && typeof imageUrl === 'string') urls.push(imageUrl.trim());
    if (Array.isArray(images)) {
      images.forEach(img => {
        if (typeof img === 'string' && (img.trim().startsWith('http') || img.trim().startsWith('/'))) urls.push(img.trim());
      });
    }

    if (urls.length === 0) {
      return res.status(400).json({ success: false, error: 'Forneça pelo menos uma URL de imagem válida (começando com http/https ou /assets)' });
    }

    recordProductImage({ sku, name, id }, urls);
    invalidateCatalogCache();

    res.json({
      success: true,
      message: 'Imagem atualizada com sucesso no catálogo!',
      identifier: { sku, name, id },
      images: urls
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Upload direct image file (base64) for any product
app.post('/api/products/upload-image', (req: Request, res: Response) => {
  try {
    const { sku, name, id, fileData, imageDataUrl, fileName } = req.body;
    const rawData = fileData || imageDataUrl;
    if (!rawData || typeof rawData !== 'string') {
      return res.status(400).json({ success: false, error: 'fileData ou imageDataUrl é obrigatório em formato base64' });
    }

    const matches = rawData.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    let buffer: Buffer;
    let ext = 'jpg';

    if (matches && matches.length === 3) {
      const mime = matches[1];
      if (mime.includes('png')) ext = 'png';
      else if (mime.includes('webp')) ext = 'webp';
      else if (mime.includes('gif')) ext = 'gif';
      buffer = Buffer.from(matches[2], 'base64');
    } else {
      buffer = Buffer.from(rawData, 'base64');
    }

    const cleanBase = (fileName || `${sku || 'prod'}_${Date.now()}`)
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 40);
    const finalFilename = `${cleanBase}_${Date.now()}.${ext}`;
    const uploadsDir = process.env.VERCEL
      ? path.resolve('/tmp', 'uploads')
      : path.resolve(process.cwd(), 'public/assets/uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const filePath = path.join(uploadsDir, finalFilename);
    fs.writeFileSync(filePath, buffer);

    const publicUrl = `/assets/uploads/${finalFilename}`;
    recordProductImage({ sku, name, id }, [publicUrl]);
    invalidateCatalogCache();

    res.json({
      success: true,
      message: 'Foto enviada e vinculada ao produto com sucesso!',
      imageUrl: publicUrl,
      identifier: { sku, name, id }
    });
  } catch (err: any) {
    console.error('[Upload Image Error]:', err);
    res.status(500).json({ success: false, error: err.message || 'Erro ao processar upload de imagem' });
  }
});

// Live Bling Catalog Metadata Endpoint
app.get('/api/bling/catalog-meta', (_req: Request, res: Response) => {
  const cachedProducts = catalogCache?.products || [];
  res.json({
    success: true,
    meta: {
      source: 'bling-erp-live',
      count: catalogCache?.count || cachedProducts.length,
      blingRawCount: catalogCache?.blingRawCount || 0,
      uniqueModels: catalogCache?.uniqueModels || cachedProducts.length,
      totalUnitsInStock: catalogCache?.totalUnitsInStock || 0,
      syncedAt: catalogCache?.timestamp ? new Date(catalogCache.timestamp).toISOString() : null,
    },
    sampleProducts: cachedProducts.slice(0, 10).map((p: any) => ({
      name: p.name,
      stockCount: p.stockCount,
      price: p.price,
      sizes: p.sizes,
      sku: p.integration?.sku,
      blingId: p.blingId,
    }))
  });
});

// Newsletter Subscription
const newsletterSubscribers = new Set<string>();

app.post('/api/newsletter', (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== 'string' || !email.includes('@') || !email.includes('.')) {
      return res.status(400).json({
        success: false,
        error: 'Por favor, informe um e-mail válido para assinar a newsletter.'
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    newsletterSubscribers.add(cleanEmail);
    console.log(`[Newsletter] Novo assinante exclusivo Street Store: ${cleanEmail} (Total: ${newsletterSubscribers.size})`);

    return res.json({
      success: true,
      message: 'Inscrição confirmada! Você receberá todos os novos drops e descontos exclusivos.',
      couponCode: 'STREETVIP',
      discount: '15% OFF'
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message || 'Erro ao processar inscrição na newsletter'
    });
  }
});

// Track Order with Store Database + Bling ERP & Melhor Envio
app.get('/api/orders/track', async (req: Request, res: Response) => {
  try {
    const q = (req.query.q as string || '').trim();
    if (!q) {
      return res.status(400).json({ success: false, error: 'Informe o número do pedido, CPF ou seu e-mail para rastreamento.' });
    }

    const orders = await trackStoreOrders(q);
    return res.json({
      success: true,
      orders
    });
  } catch (error: any) {
    console.error('Error tracking order:', error);
    return res.status(500).json({
      success: false,
      orders: [],
      error: error.message || 'Erro ao consultar pedidos'
    });
  }
});

// Authenticated Customer Account Orders (verified via Firebase ID token)
app.get('/api/orders/my-orders', async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  try {
    const authHeader = String(req.headers.authorization || '');
    const idToken = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';
    if (!idToken || !hasFirebaseAdminEnv()) {
      return res.status(401).json({ success: false, orders: [], error: 'Faça login para visualizar seus pedidos.' });
    }

    const decoded = await getAdminAuth().verifyIdToken(idToken);
    const uid = decoded.uid;
    let email = decoded.email || '';
    let phone = decoded.phone_number || '';

    try {
      const userSnap = await getAdminFirestore().collection('users').doc(uid).get();
      if (userSnap.exists) {
        const userData = userSnap.data() || {};
        if (userData.email) email = String(userData.email);
        if (userData.phone) phone = String(userData.phone);
      }
    } catch {
      // use decoded token claims
    }

    const orders = await getCustomerOrders({ uid, email, phone });
    return res.json({
      success: true,
      orders,
    });
  } catch (error: any) {
    console.warn('[Customer Orders] Auth/lookup notice:', error?.message || error);
    return res.status(401).json({
      success: false,
      orders: [],
      error: 'Sessão expirada ou inválida. Entre novamente na sua conta.',
    });
  }
});

// Request Return / Exchange (Melhor Envio Reverse Logistics Integration)
app.post('/api/orders/:id/return', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      orderNumber,
      customerEmail,
      customerName,
      customerPhone,
      reason,
      actionRequested,
      selectedItems,
      details
    } = req.body;

    const result = requestStoreOrderReturn({
      orderId: id,
      orderNumber: orderNumber || `#${id}`,
      customerEmail: customerEmail || '',
      customerName,
      customerPhone,
      reason,
      actionRequested,
      selectedItems: Array.isArray(selectedItems) ? selectedItems : [],
      details: details || ''
    });

    return res.json(result);
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message || 'Erro ao registrar solicitação de devolução'
    });
  }
});

// ==========================================
// MERCADO PAGO INTEGRATION ENDPOINTS
// ==========================================

// 1. Status / Config Check
app.get('/api/mercadopago/status', async (_req: Request, res: Response) => {
  try {
    // Validate access token with Mercado Pago user endpoint
    const response = await fetch(`${MERCADO_PAGO_API_BASE}/users/me`, {
      headers: {
        'Authorization': `Bearer ${MERCADO_PAGO_ACCESS_TOKEN}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({
        connected: false,
        publicKey: MERCADO_PAGO_PUBLIC_KEY,
        error: `Mercado Pago API validation failed: ${errorText}`
      });
    }

    const userData = await response.json();
    return res.json({
      connected: true,
      publicKey: MERCADO_PAGO_PUBLIC_KEY,
      clientId: MERCADO_PAGO_CLIENT_ID,
      siteId: userData.site_id || 'MLB',
      nickname: userData.nickname || 'Street Store',
      email: userData.email || 'streetstore364@gmail.com'
    });
  } catch (error: any) {
    return res.status(500).json({
      connected: false,
      error: error.message || 'Falha ao verificar status do Mercado Pago'
    });
  }
});

// 2. Create Checkout Pro Preference (Cards up to 6x/12x, Boleto, MP Account)
app.post('/api/mercadopago/create-preference', async (req: Request, res: Response) => {
  try {
    const { items, payer, discountAmount = 0 } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'O carrinho está vazio' });
    }

    // Format items for Mercado Pago Preference API
    const mpItems = items.map((it: any) => ({
      id: String(it.id || it.product?.id || 'item-1'),
      title: it.name || it.title || it.product?.name || 'Peça Street Store',
      description: `Tamanho: ${it.selectedSize || 'Único'} | Cor: ${it.selectedColor || 'Padrão'}`,
      picture_url: it.image || it.product?.images?.[0] || 'https://www.streetstore.com.br/logo.png',
      category_id: 'fashion',
      quantity: Number(it.quantity) || 1,
      currency_id: 'BRL',
      unit_price: Math.max(0.01, parseFloat(Number(it.price || it.product?.price || 99.90).toFixed(2)))
    }));

    // If discount was applied, add negative or discounted balance
    if (discountAmount > 0) {
      mpItems.push({
        id: 'discount-coupon',
        title: 'Desconto Cupom Street Store',
        description: 'Cupom promocional aplicado',
        picture_url: '',
        category_id: 'discounts',
        quantity: 1,
        currency_id: 'BRL',
        unit_price: -Math.abs(parseFloat(Number(discountAmount).toFixed(2)))
      });
    }

    // Determine valid public URL for redirects
    const appUrl = process.env.APP_URL || '';
    const rawOrigin = req.headers.origin || (req.headers.host ? `https://${req.headers.host}` : '');
    const validBaseUrl = (rawOrigin.startsWith('https://') && !rawOrigin.includes('localhost'))
      ? rawOrigin
      : (appUrl.startsWith('https://') ? appUrl : 'https://www.streetstore.com.br');

    const preferencePayload: Record<string, any> = {
      items: mpItems,
      payer: {
        name: payer?.name || 'Cliente Street Store',
        email: (payer?.email && payer.email.includes('@')) ? payer.email : 'streetstore364@gmail.com',
        phone: {
          area_code: '31',
          number: payer?.phone ? String(payer.phone).replace(/\D/g, '') : '984806556'
        }
      },
      back_urls: {
        success: `${validBaseUrl}/?payment_status=approved`,
        failure: `${validBaseUrl}/?payment_status=failure`,
        pending: `${validBaseUrl}/?payment_status=pending`
      },
      auto_return: 'approved',
      statement_descriptor: 'STREET STORE',
      external_reference: `ST-${Date.now()}`,
      payment_methods: {
        installments: 6,
        default_installments: 1
      }
    };

    if (validBaseUrl.startsWith('https://') && !validBaseUrl.includes('localhost')) {
      preferencePayload.notification_url = `${validBaseUrl}/api/mercadopago/webhook`;
    }

    const mpRes = await fetch(`${MERCADO_PAGO_API_BASE}/checkout/preferences`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MERCADO_PAGO_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(preferencePayload)
    });

    const data = await mpRes.json();

    if (!mpRes.ok) {
      console.error('Mercado Pago create-preference failed:', data);
      return res.status(mpRes.status).json({
        success: false,
        error: data.message || 'Erro ao criar preferência de checkout no Mercado Pago',
        details: data
      });
    }

    return res.json({
      success: true,
      preferenceId: data.id,
      initPoint: data.init_point,
      sandboxInitPoint: data.sandbox_init_point
    });
  } catch (error: any) {
    console.error('Error creating Mercado Pago preference:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Erro interno ao processar preferência de pagamento'
    });
  }
});

// In-memory + Firestore tracker for Pix & pending checkout transactions
interface LocalPayment {
  id: string;
  mpPaymentId?: string;
  pixTxId?: string;
  externalReference?: string;
  mpFallbackReason?: string;
  userId?: string;
  amount: number;
  status: 'pending' | 'approved' | 'rejected';
  statusDetail: string;
  createdAt: number;
  dateApproved?: string;
  movedToOrders?: boolean;
  payer?: any;
  items?: any[];
  shippingAddress?: any;
  shippingServiceId?: number;
  shippingCarrier?: string;
  paymentMethod?: string;
  orderId?: number;
  orderNumber?: string;
  blingOrderId?: number;
  blingSyncStatus?: string;
  raffleTicketCode?: string;
}

const localPaymentsMap = new Map<string, LocalPayment>();
const inFlightFinalizations = new Map<string, Promise<{
  orderId?: number;
  orderNumber?: string;
  blingOrderId?: number;
  blingSyncStatus?: string;
  raffleTicketCode?: string;
}>>();

let cachedMpCollectorEmail: { email: string; fetchedAt: number } | null = null;

async function getMpCollectorEmail(): Promise<string> {
  const now = Date.now();
  if (cachedMpCollectorEmail && now - cachedMpCollectorEmail.fetchedAt < 30 * 60 * 1000) {
    return cachedMpCollectorEmail.email;
  }
  try {
    const res = await fetch(`${MERCADO_PAGO_API_BASE}/users/me`, {
      headers: { Authorization: `Bearer ${MERCADO_PAGO_ACCESS_TOKEN}` },
    });
    if (res.ok) {
      const data = await res.json();
      const email = String(data?.email || '').trim().toLowerCase();
      cachedMpCollectorEmail = { email, fetchedAt: now };
      return email;
    }
  } catch {
    // ignore
  }
  return '';
}

function sanitizePaymentDocId(id: string | number): string {
  return String(id).replace(/[^a-zA-Z0-9_-]/g, '_');
}

async function savePendingPaymentContext(id: string | number, data: LocalPayment): Promise<void> {
  const key = String(id);
  localPaymentsMap.set(key, data);

  if (hasFirebaseAdminEnv()) {
    try {
      const db = getAdminFirestore();
      const cleanData = JSON.parse(JSON.stringify(data));
      await db.collection('pending_payments').doc(sanitizePaymentDocId(key)).set(cleanData, { merge: true });
    } catch (err) {
      console.warn(`[Pending Payment] Erro ao salvar contexto ${key} no Firestore:`, err);
    }
  }
}

async function loadPendingPaymentContext(id: string | number): Promise<LocalPayment | null> {
  const key = String(id);
  const local = localPaymentsMap.get(key);
  if (local) return local;

  if (hasFirebaseAdminEnv()) {
    try {
      const db = getAdminFirestore();
      const snap = await db.collection('pending_payments').doc(sanitizePaymentDocId(key)).get();
      if (snap.exists) {
        const data = snap.data() as LocalPayment;
        localPaymentsMap.set(key, data);
        return data;
      }
    } catch (err) {
      console.warn(`[Pending Payment] Erro ao carregar contexto ${key} do Firestore:`, err);
    }
  }

  return null;
}

async function findPendingPaymentForMpPayment(mpData: any): Promise<{ key: string; payment: LocalPayment } | null> {
  const mpId = String(mpData?.id || '').trim();
  const extRef = String(mpData?.external_reference || '').trim();

  for (const candidateKey of [mpId, extRef]) {
    if (!candidateKey) continue;
    const direct = await loadPendingPaymentContext(candidateKey);
    if (direct) {
      return { key: candidateKey, payment: direct };
    }
  }

  if (hasFirebaseAdminEnv()) {
    try {
      const db = getAdminFirestore();
      if (mpId) {
        const byMpId = await db.collection('pending_payments').where('mpPaymentId', '==', mpId).limit(1).get();
        if (!byMpId.empty) {
          const doc = byMpId.docs[0];
          const data = doc.data() as LocalPayment;
          return { key: data.id || doc.id, payment: data };
        }
      }
      if (extRef) {
        const byExt = await db.collection('pending_payments').where('externalReference', '==', extRef).limit(1).get();
        if (!byExt.empty) {
          const doc = byExt.docs[0];
          const data = doc.data() as LocalPayment;
          return { key: data.id || doc.id, payment: data };
        }
      }

      const amount = Number(mpData?.transaction_amount || 0);
      const mpCreatedMs = mpData?.date_created ? new Date(mpData.date_created).getTime() : Date.now();
      const mpCpf = String(mpData?.payer?.identification?.number || '').replace(/\D/g, '');
      const recentSnap = await db.collection('pending_payments').orderBy('createdAt', 'desc').limit(50).get();
      for (const doc of recentSnap.docs) {
        const p = doc.data() as LocalPayment;
        if (p.status === 'approved' || p.movedToOrders) continue;
        const pCpf = String(p.payer?.cpf || '').replace(/\D/g, '');
        const amountMatches = amount > 0 && Math.abs(Number(p.amount || 0) - amount) < 0.05;
        const timeDeltaMs = Math.abs(mpCreatedMs - Number(p.createdAt || 0));
        const within24h = timeDeltaMs <= 24 * 60 * 60 * 1000;
        const cpfMatches = Boolean(mpCpf && pCpf && mpCpf === pCpf);
        if (amountMatches && within24h && (cpfMatches || !mpCpf)) {
          return { key: p.id || doc.id, payment: p };
        }
      }
    } catch (err) {
      console.warn('[Pending Payment] Erro ao correlacionar webhook MP:', err);
    }
  }

  return null;
}

async function finalizeApprovedPayment(params: {
  canonicalPaymentId: string | number;
  contextKeys?: Array<string | number>;
  pendingPaymentId?: string;
  userId?: string;
  endToEndId?: string;
  source?: string;
  amount: number;
  paymentMethod: string;
  dateApproved?: string;
  payer?: any;
  items?: any[];
  shippingAddress?: any;
  shippingServiceId?: number;
  shippingCarrier?: string;
  skipBling?: boolean;
}): Promise<{
  orderId?: number;
  orderNumber?: string;
  blingOrderId?: number;
  blingSyncStatus?: string;
  raffleTicketCode?: string;
}> {
  const canonicalId = String(params.canonicalPaymentId);
  const existingPromise = inFlightFinalizations.get(canonicalId);
  if (existingPromise) {
    return existingPromise;
  }

  const run = (async () => {
    let orderId: number | undefined;
    let orderNumber: string | undefined;
    let blingOrderId: number | undefined;
    let blingSyncStatus: string | undefined;
    let raffleTicketCode: string | undefined;

    const payerEmail =
      params.payer?.email && String(params.payer.email).includes('@')
        ? String(params.payer.email)
        : 'streetstore364@gmail.com';
    const payerName =
      params.payer?.name && String(params.payer.name).trim()
        ? String(params.payer.name).trim()
        : [params.payer?.first_name, params.payer?.last_name].filter(Boolean).join(' ').trim() || 'Cliente Street Store';
    const payerCpf = params.payer?.cpf || params.payer?.identification?.number;
    const payerPhone = params.payer?.phone;
    const resolvedUid = params.userId || params.payer?.uid;

    try {
      const orderRes = await createStoreOrder({
        customer: {
          ...(resolvedUid ? { uid: String(resolvedUid) } : {}),
          name: payerName,
          email: payerEmail,
          phone: payerPhone,
          cpf: payerCpf,
        },
        userId: resolvedUid ? String(resolvedUid) : undefined,
        pendingPaymentId: params.pendingPaymentId,
        endToEndId: params.endToEndId,
        source: params.source,
        paidAt: params.dateApproved,
        skipBling: params.skipBling,
        items: params.items || [],
        shippingAddress: params.shippingAddress,
        shippingServiceId: params.shippingServiceId,
        shippingCarrier: params.shippingCarrier,
        paymentMethod: params.paymentMethod,
        paymentId: canonicalId,
        total: Number(params.amount || 0),
      });

      if (orderRes.success) {
        orderId = orderRes.id;
        orderNumber = orderRes.number;
        blingOrderId = orderRes.blingOrderId;
        blingSyncStatus = orderRes.blingSyncStatus;
        if (!orderRes.alreadyExisted) {
          invalidateCatalogCache();
        }
      }
    } catch (orderErr) {
      console.error(`[Payment Finalize] Erro ao criar pedido para pagamento ${canonicalId}:`, orderErr);
    }

    try {
      raffleTicketCode =
        (await processPs5RaffleEntry({
          customerName: payerName,
          customerEmail: payerEmail,
          customerPhone: payerPhone,
          customerCpf: payerCpf ? String(payerCpf) : undefined,
          orderNumber,
          paymentId: canonicalId,
          endToEndId: params.endToEndId,
          orderTotal: Number(params.amount || 0),
          shippingAddress: params.shippingAddress,
        })) || undefined;
    } catch (raffleErr) {
      console.warn(`[Payment Finalize] Erro ao gerar bilhete PS5 para pagamento ${canonicalId}:`, raffleErr);
    }

    const keysToUpdate = Array.from(
      new Set([
        canonicalId,
        ...(params.pendingPaymentId ? [params.pendingPaymentId] : []),
        ...(params.contextKeys || []).map((k) => String(k)),
      ])
    );
    for (const key of keysToUpdate) {
      const prev = await loadPendingPaymentContext(key);
      await savePendingPaymentContext(key, {
        ...(prev || {
          id: key,
          amount: Number(params.amount || 0),
          createdAt: Date.now(),
        }),
        id: key,
        mpPaymentId: canonicalId,
        ...(resolvedUid ? { userId: String(resolvedUid) } : prev?.userId ? { userId: prev.userId } : {}),
        amount: Number(prev?.amount || params.amount || 0),
        status: 'approved',
        statusDetail: 'accredited',
        movedToOrders: Boolean(orderNumber),
        dateApproved: params.dateApproved || prev?.dateApproved || new Date().toISOString(),
        payer: prev?.payer || params.payer,
        items: prev?.items || params.items,
        shippingAddress: prev?.shippingAddress || params.shippingAddress,
        shippingServiceId: prev?.shippingServiceId ?? params.shippingServiceId,
        shippingCarrier: prev?.shippingCarrier || params.shippingCarrier,
        paymentMethod: params.paymentMethod,
        orderId,
        orderNumber,
        blingOrderId,
        blingSyncStatus,
        raffleTicketCode,
      });
    }

    return { orderId, orderNumber, blingOrderId, blingSyncStatus, raffleTicketCode };
  })();

  inFlightFinalizations.set(canonicalId, run);
  try {
    return await run;
  } finally {
    inFlightFinalizations.delete(canonicalId);
  }
}

// EMV BR Code Helpers for BACEN Standard Pix QR Codes
function formatEMV(id: string, value: string): string {
  const len = String(value.length).padStart(2, '0');
  return `${id}${len}${value}`;
}

function calculateCRC16(payload: string): string {
  let crc = 0xFFFF;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
      } else {
        crc = (crc << 1) & 0xFFFF;
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function resolveStorePixKey(): string {
  const raw = (process.env.PIX_KEY || '+5531984806556').trim();
  if (!raw) return '+5531984806556';
  if (raw.includes('@') || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
    return raw;
  }
  if (raw.startsWith('+')) {
    return `+${raw.replace(/\D/g, '')}`;
  }
  const digits = raw.replace(/\D/g, '');
  if (digits === '31984806556' || digits === '5531984806556' || (digits.length >= 12 && digits.startsWith('55'))) {
    return digits.startsWith('55') ? `+${digits}` : `+55${digits}`;
  }
  if (/[()\s-]/.test(raw) && (digits.length === 10 || digits.length === 11)) {
    return `+55${digits}`;
  }
  return raw;
}

function generatePixBRCode(params: {
  pixKey: string;
  merchantName: string;
  merchantCity: string;
  amount: number;
  txId?: string;
}): string {
  const { pixKey, merchantName, merchantCity, amount, txId = 'STREETSTORE' } = params;
  const formattedAmount = amount.toFixed(2);
  const f00 = formatEMV('00', '01');
  const f01 = formatEMV('01', '11');
  const gui = formatEMV('00', 'br.gov.bcb.pix');
  const key = formatEMV('01', pixKey);
  const f26 = formatEMV('26', `${gui}${key}`);
  const f52 = formatEMV('52', '0000');
  const f53 = formatEMV('53', '986');
  const f54 = formatEMV('54', formattedAmount);
  const f58 = formatEMV('58', 'BR');
  const cleanName = merchantName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').slice(0, 25).toUpperCase();
  const f59 = formatEMV('59', cleanName);
  const cleanCity = merchantCity.normalize('NFD').replace(/[\u0300-\u036f]/g, '').slice(0, 15).toUpperCase();
  const f60 = formatEMV('60', cleanCity);
  const f05 = formatEMV('05', txId.slice(0, 25));
  const f62 = formatEMV('62', f05);
  const rawPayload = `${f00}${f01}${f26}${f52}${f53}${f54}${f58}${f59}${f60}${f62}6304`;
  const crc = calculateCRC16(rawPayload);
  return `${rawPayload}${crc}`;
}

// 3. Create Direct Pix Payment via Mercado Pago v1/payments with zero external redirects
app.post('/api/mercadopago/create-pix', async (req: Request, res: Response) => {
  try {
    const { amount, description, payer, items, shippingAddress, shippingServiceId, shippingCarrier, userId } = req.body;

    const numericAmount = parseFloat(Number(amount).toFixed(2));
    if (!numericAmount || numericAmount <= 0) {
      return res.status(400).json({ success: false, error: 'Valor inválido para pagamento Pix' });
    }

    const resolvedUserId = String(userId || payer?.uid || '').trim() || undefined;
    const email = (payer?.email && payer.email.includes('@'))
      ? String(payer.email).trim()
      : 'streetstore364@gmail.com';
    const fullName = (payer?.name && payer.name.trim()) || 'Cliente Street Store';
    const nameParts = fullName.trim().split(' ');
    const firstName = nameParts[0] || 'Cliente';
    const lastName = nameParts.slice(1).join(' ') || 'Street';

    // Mercado Pago blocks self-payments if payer.email equals the collector account email.
    // Keep the customer's real email in pending_payments/orders, and pass a neutral alias to MP API if identical.
    const collectorEmail = await getMpCollectorEmail();
    const mpPayerEmail =
      collectorEmail && email.toLowerCase() === collectorEmail
        ? `cliente+${Date.now()}@streetstore.com.br`
        : email;

    const appUrl = process.env.APP_URL || '';
    const rawOrigin = req.headers.origin || (req.headers.host ? `https://${req.headers.host}` : '');
    const validBaseUrl =
      rawOrigin.startsWith('https://') && !rawOrigin.includes('localhost')
        ? rawOrigin
        : appUrl.startsWith('https://')
          ? appUrl
          : 'https://www.streetstore.com.br';

    const localPaymentId = `pix_st_${Date.now()}`;
    const externalReference = localPaymentId;

    const paymentPayload: Record<string, any> = {
      transaction_amount: numericAmount,
      description: description || 'Street Store - Pedido Streetwear Oficial',
      payment_method_id: 'pix',
      external_reference: externalReference,
      payer: {
        email: mpPayerEmail,
        first_name: firstName,
        last_name: lastName,
        identification: payer?.cpf ? {
          type: 'CPF',
          number: String(payer.cpf).replace(/\D/g, '')
        } : undefined
      }
    };

    if (validBaseUrl.startsWith('https://') && !validBaseUrl.includes('localhost')) {
      paymentPayload.notification_url = `${validBaseUrl}/api/mercadopago/webhook`;
    }

    const idempotencyKey = `pix-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;

    let officialMpSuccess = false;
    let mpFallbackReason: string | undefined;
    let data: any = null;

    try {
      const mpRes = await fetch(`${MERCADO_PAGO_API_BASE}/v1/payments`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${MERCADO_PAGO_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
          'X-Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify(paymentPayload)
      });
      data = await mpRes.json();
      if (mpRes.ok && data?.point_of_interaction?.transaction_data?.qr_code) {
        officialMpSuccess = true;
      } else {
        mpFallbackReason = data?.message || data?.cause?.[0]?.description || `MP status ${mpRes.status}`;
        console.warn('Mercado Pago direct pix response:', data?.status, mpFallbackReason);
      }
    } catch (apiErr: any) {
      mpFallbackReason = apiErr?.message || String(apiErr);
      console.warn('Direct Mercado Pago API fetch failed:', mpFallbackReason);
    }

    if (officialMpSuccess && data) {
      const txData = data.point_of_interaction?.transaction_data;
      const mpPaymentIdStr = String(data.id);

      await savePendingPaymentContext(mpPaymentIdStr, {
        id: mpPaymentIdStr,
        mpPaymentId: mpPaymentIdStr,
        externalReference,
        userId: resolvedUserId,
        amount: Number(data.transaction_amount || numericAmount),
        status: data.status === 'approved' ? 'approved' : 'pending',
        statusDetail: data.status_detail || 'waiting_payment',
        createdAt: Date.now(),
        payer: {
          ...(resolvedUserId ? { uid: resolvedUserId } : {}),
          name: fullName,
          email,
          cpf: payer?.cpf,
          phone: payer?.phone,
        },
        items,
        shippingAddress,
        shippingServiceId,
        shippingCarrier,
        paymentMethod: 'Pix Instantâneo Mercado Pago',
      });

      return res.json({
        success: true,
        paymentId: data.id,
        status: data.status,
        statusDetail: data.status_detail,
        amount: data.transaction_amount,
        qrCode: txData?.qr_code || '',
        qrCodeBase64: txData?.qr_code_base64 || '',
        ticketUrl: txData?.ticket_url || '',
        expiresAt: data.date_of_expiration,
        isOfficialMp: true
      });
    }

    // Generate 100% native in-app BACEN EMV BR Code QR Code for Street Store:
    console.log('Generating 100% in-app transparent Pix QR Code...');
    const pixKey = resolveStorePixKey();
    const txId = `ST${Date.now().toString().slice(-8)}`;
    const emvString = generatePixBRCode({
      pixKey,
      merchantName: 'STREET STORE',
      merchantCity: 'BELO HORIZONTE',
      amount: numericAmount,
      txId
    });

    const qrDataUrl = await QRCode.toDataURL(emvString, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 320,
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    });

    const qrCodeBase64 = qrDataUrl.replace(/^data:image\/png;base64,/, '');

    await savePendingPaymentContext(localPaymentId, {
      id: localPaymentId,
      pixTxId: txId,
      externalReference,
      mpFallbackReason,
      userId: resolvedUserId,
      amount: numericAmount,
      status: 'pending',
      statusDetail: 'waiting_payment',
      createdAt: Date.now(),
      payer: {
        ...(resolvedUserId ? { uid: resolvedUserId } : {}),
        name: fullName,
        email,
        cpf: payer?.cpf,
        phone: payer?.phone,
      },
      items,
      shippingAddress,
      shippingServiceId,
      shippingCarrier,
      paymentMethod: 'Pix Instantâneo Mercado Pago',
    });

    return res.json({
      success: true,
      paymentId: localPaymentId,
      status: 'pending',
      statusDetail: 'waiting_payment',
      amount: numericAmount,
      qrCode: emvString,
      qrCodeBase64,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      pixKey,
      isDirectPix: true
    });
  } catch (error: any) {
    console.error('Error generating Pix via Mercado Pago:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Erro interno ao gerar Pix Mercado Pago'
    });
  }
});

async function searchApprovedMpMatchForPending(p: LocalPayment, pendingId: string): Promise<any | null> {
  try {
    const mpSearchRes = await fetch(`${MERCADO_PAGO_API_BASE}/v1/payments/search?sort=date_created&criteria=desc&limit=30`, {
      headers: {
        'Authorization': `Bearer ${MERCADO_PAGO_ACCESS_TOKEN}`
      }
    });

    if (!mpSearchRes.ok) return null;
    const searchData = await mpSearchRes.json();
    const results = searchData.results || [];
    const pCpf = String(p.payer?.cpf || '').replace(/\D/g, '');

    return results.find((item: any) => {
      if (item.status !== 'approved') return false;
      const extRef = String(item.external_reference || '');
      if (extRef && (extRef === pendingId || extRef === p.externalReference || (p.pixTxId && extRef === p.pixTxId))) {
        return true;
      }
      const amountMatches = Math.abs(Number(item.transaction_amount || 0) - Number(p.amount || 0)) < 0.05;
      const createdTime = new Date(item.date_created).getTime();
      const isRecent = createdTime > (p.createdAt - 180000);
      if (!amountMatches || !isRecent) return false;
      const itemCpf = String(item.payer?.identification?.number || '').replace(/\D/g, '');
      if (itemCpf && pCpf && itemCpf !== pCpf) return false;
      return true;
    }) || null;
  } catch (err) {
    console.warn('Error querying Mercado Pago payment search:', err);
    return null;
  }
}

// 4. Confirm Pix Payment (Strict Real Verification with Mercado Pago - NEVER auto-approves)
app.post('/api/mercadopago/confirm-pix/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    console.log(`[Pix Verification] Checking status for payment ID: ${id}`);

    // If local BACEN Pix QR Code
    if (id.startsWith('pix_st_')) {
      const payment = await loadPendingPaymentContext(id);
      if (!payment) {
        return res.status(404).json({
          success: false,
          approved: false,
          status: 'not_found',
          message: 'Transação não encontrada'
        });
      }

      if (payment.status === 'approved') {
        const finalized = await finalizeApprovedPayment({
          canonicalPaymentId: payment.mpPaymentId || payment.id,
          pendingPaymentId: id,
          userId: payment.userId || payment.payer?.uid,
          contextKeys: [id],
          amount: payment.amount,
          paymentMethod: payment.paymentMethod || 'Pix Instantâneo Mercado Pago',
          dateApproved: payment.dateApproved,
          payer: payment.payer,
          items: payment.items,
          shippingAddress: payment.shippingAddress,
          shippingServiceId: payment.shippingServiceId,
          shippingCarrier: payment.shippingCarrier,
        });

        return res.json({
          success: true,
          approved: true,
          status: 'approved',
          statusDetail: 'accredited',
          orderNumber: finalized.orderNumber || payment.orderNumber,
          orderId: finalized.orderId || payment.orderId,
          raffleTicketCode: finalized.raffleTicketCode || payment.raffleTicketCode,
          message: 'Pagamento Pix aprovado com sucesso!'
        });
      }

      // Query Mercado Pago live payment search to verify if money actually arrived
      const matchedMpPayment = await searchApprovedMpMatchForPending(payment, id);

      if (matchedMpPayment) {
        const finalized = await finalizeApprovedPayment({
          canonicalPaymentId: matchedMpPayment.id,
          pendingPaymentId: id,
          userId: payment.userId || payment.payer?.uid,
          contextKeys: [id],
          amount: payment.amount,
          paymentMethod: 'Pix Instantâneo Mercado Pago',
          dateApproved: matchedMpPayment.date_approved || new Date().toISOString(),
          payer: payment.payer,
          items: payment.items,
          shippingAddress: payment.shippingAddress,
          shippingServiceId: payment.shippingServiceId,
          shippingCarrier: payment.shippingCarrier,
        });

        return res.json({
          success: true,
          approved: true,
          status: 'approved',
          statusDetail: 'accredited',
          orderNumber: finalized.orderNumber,
          orderId: finalized.orderId,
          raffleTicketCode: finalized.raffleTicketCode,
          message: 'Pagamento Pix identificado e aprovado pelo Mercado Pago!'
        });
      }

      // Money has NOT arrived yet - return pending!
      return res.json({
        success: false,
        approved: false,
        status: 'pending',
        statusDetail: 'waiting_payment',
        message: 'Aguardando compensação do banco: O Mercado Pago ainda não identificou o pagamento do Pix. Assim que você transferir no app do seu banco, o status mudará automaticamente.'
      });
    }

    // Official numeric Mercado Pago Payment ID
    const mpRes = await fetch(`${MERCADO_PAGO_API_BASE}/v1/payments/${id}`, {
      headers: {
        'Authorization': `Bearer ${MERCADO_PAGO_ACCESS_TOKEN}`
      }
    });

    if (!mpRes.ok) {
      return res.json({
        success: false,
        approved: false,
        status: 'pending',
        message: 'Aguardando compensação do banco no Mercado Pago.'
      });
    }

    const data = await mpRes.json();
    if (data.status === 'approved') {
      const matchedCtx = await findPendingPaymentForMpPayment(data);
      const pendingCtx = matchedCtx?.payment || (await loadPendingPaymentContext(id));
      const contextKeys = matchedCtx?.key && matchedCtx.key !== id ? [id, matchedCtx.key] : [id];
      const finalized = await finalizeApprovedPayment({
        canonicalPaymentId: data.id,
        pendingPaymentId: matchedCtx?.key || pendingCtx?.id,
        userId: pendingCtx?.userId || pendingCtx?.payer?.uid,
        contextKeys,
        amount: Number(pendingCtx?.amount || data.transaction_amount || 0),
        paymentMethod: pendingCtx?.paymentMethod || 'Pix Instantâneo Mercado Pago',
        dateApproved: data.date_approved,
        payer: pendingCtx?.payer || data.payer,
        items: pendingCtx?.items || [],
        shippingAddress: pendingCtx?.shippingAddress,
        shippingServiceId: pendingCtx?.shippingServiceId,
        shippingCarrier: pendingCtx?.shippingCarrier,
      });

      return res.json({
        success: true,
        approved: true,
        id: data.id,
        status: 'approved',
        statusDetail: data.status_detail,
        dateApproved: data.date_approved,
        orderNumber: finalized.orderNumber,
        orderId: finalized.orderId,
        raffleTicketCode: finalized.raffleTicketCode,
        message: 'Pagamento Pix verificado e aprovado com sucesso!'
      });
    }

    return res.json({
      success: false,
      approved: false,
      id: data.id,
      status: data.status,
      statusDetail: data.status_detail,
      message: 'Pagamento ainda não confirmado pelo banco. Abra o app do seu banco, finalize a transferência Pix e aguarde alguns segundos.'
    });

  } catch (error: any) {
    console.error('Error confirming Pix payment:', error);
    return res.status(500).json({
      success: false,
      approved: false,
      error: error.message || 'Erro ao consultar Mercado Pago'
    });
  }
});

// 5. Check Payment Status (Strict verification)
app.get('/api/mercadopago/payment-status/:id', async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  try {
    const { id } = req.params;

    if (id.startsWith('pix_st_')) {
      const p = await loadPendingPaymentContext(id);
      if (!p) {
        return res.status(404).json({ success: false, approved: false, error: 'Pagamento não encontrado' });
      }

      if (p.status !== 'approved') {
        const match = await searchApprovedMpMatchForPending(p, id);
        if (match) {
          const finalized = await finalizeApprovedPayment({
            canonicalPaymentId: match.id,
            pendingPaymentId: id,
            userId: p.userId || p.payer?.uid,
            contextKeys: [id],
            amount: p.amount,
            paymentMethod: 'Pix Instantâneo Mercado Pago',
            dateApproved: match.date_approved || new Date().toISOString(),
            payer: p.payer,
            items: p.items,
            shippingAddress: p.shippingAddress,
            shippingServiceId: p.shippingServiceId,
            shippingCarrier: p.shippingCarrier,
          });

          return res.json({
            success: true,
            approved: true,
            id: p.id,
            status: 'approved',
            statusDetail: 'accredited',
            dateApproved: match.date_approved || new Date().toISOString(),
            orderNumber: finalized.orderNumber,
            orderId: finalized.orderId,
            raffleTicketCode: finalized.raffleTicketCode,
          });
        }
      }

      if (p.status === 'approved') {
        const finalized = await finalizeApprovedPayment({
          canonicalPaymentId: p.mpPaymentId || p.id,
          pendingPaymentId: id,
          userId: p.userId || p.payer?.uid,
          contextKeys: [id],
          amount: p.amount,
          paymentMethod: p.paymentMethod || 'Pix Instantâneo Mercado Pago',
          dateApproved: p.dateApproved,
          payer: p.payer,
          items: p.items,
          shippingAddress: p.shippingAddress,
          shippingServiceId: p.shippingServiceId,
          shippingCarrier: p.shippingCarrier,
        });

        return res.json({
          success: true,
          approved: true,
          id: p.id,
          status: 'approved',
          statusDetail: 'accredited',
          dateApproved: p.dateApproved,
          orderNumber: finalized.orderNumber || p.orderNumber,
          orderId: finalized.orderId || p.orderId,
          raffleTicketCode: finalized.raffleTicketCode || p.raffleTicketCode,
        });
      }

      return res.json({
        success: true,
        approved: false,
        id: p.id,
        status: p.status,
        statusDetail: p.statusDetail,
        dateApproved: p.dateApproved,
      });
    }

    const mpRes = await fetch(`${MERCADO_PAGO_API_BASE}/v1/payments/${id}`, {
      headers: {
        'Authorization': `Bearer ${MERCADO_PAGO_ACCESS_TOKEN}`,
      }
    });

    if (!mpRes.ok) {
      return res.status(mpRes.status).json({
        success: false,
        approved: false,
        error: 'Pagamento não encontrado no Mercado Pago'
      });
    }

    const data = await mpRes.json();
    let orderNumber: string | undefined;
    let orderId: number | undefined;
    let raffleTicketCode: string | undefined;

    if (data.status === 'approved') {
      const matchedCtx = await findPendingPaymentForMpPayment(data);
      const pendingCtx = matchedCtx?.payment || (await loadPendingPaymentContext(id));
      const contextKeys = matchedCtx?.key && matchedCtx.key !== id ? [id, matchedCtx.key] : [id];
      const finalized = await finalizeApprovedPayment({
        canonicalPaymentId: data.id,
        pendingPaymentId: matchedCtx?.key || pendingCtx?.id,
        userId: pendingCtx?.userId || pendingCtx?.payer?.uid,
        contextKeys,
        amount: Number(pendingCtx?.amount || data.transaction_amount || 0),
        paymentMethod: pendingCtx?.paymentMethod || 'Pix Instantâneo Mercado Pago',
        dateApproved: data.date_approved,
        payer: pendingCtx?.payer || data.payer,
        items: pendingCtx?.items || [],
        shippingAddress: pendingCtx?.shippingAddress,
        shippingServiceId: pendingCtx?.shippingServiceId,
        shippingCarrier: pendingCtx?.shippingCarrier,
      });
      orderNumber = finalized.orderNumber;
      orderId = finalized.orderId;
      raffleTicketCode = finalized.raffleTicketCode;
    }

    return res.json({
      success: true,
      approved: data.status === 'approved',
      id: data.id,
      status: data.status,
      statusDetail: data.status_detail,
      dateApproved: data.date_approved,
      orderNumber,
      orderId,
      raffleTicketCode,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      approved: false,
      error: error.message || 'Erro ao consultar status'
    });
  }
});

// 5. Checkout Transparente com Cartão de Crédito
app.post('/api/mercadopago/process-card', async (req: Request, res: Response) => {
  try {
    const { 
      token: clientToken, 
      cardData,
      transactionAmount, 
      description, 
      installments = 1, 
      paymentMethodId, 
      payer,
      userId,
      items,
      shippingAddress,
      shippingServiceId,
      shippingCarrier
    } = req.body;

    const resolvedUserId = String(userId || payer?.uid || '').trim() || undefined;
    let cardToken = clientToken;

    // Se o frontend enviou dados do cartão, tokenizar no Mercado Pago
    if (!cardToken && cardData) {
      const cleanCardNum = String(cardData.cardNumber).replace(/\D/g, '');
      const expMonth = parseInt(String(cardData.expirationMonth), 10);
      let expYear = String(cardData.expirationYear).trim();
      if (expYear.length === 2) expYear = `20${expYear}`;

      const tokenRes = await fetch(`${MERCADO_PAGO_API_BASE}/v1/card_tokens?public_key=${MERCADO_PAGO_PUBLIC_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          card_number: cleanCardNum,
          expiration_month: expMonth,
          expiration_year: parseInt(expYear, 10),
          security_code: String(cardData.securityCode).trim(),
          cardholder: {
            name: (cardData.cardholderName || payer?.name || 'CLIENTE STREET STORE').toUpperCase().trim(),
            identification: {
              type: 'CPF',
              number: String(cardData.cpf || payer?.cpf || '19119119100').replace(/\D/g, '')
            }
          }
        })
      });

      const tokenJson = await tokenRes.json();
      if (!tokenRes.ok || !tokenJson.id) {
        console.error('Mercado Pago token generation failed:', tokenJson);
        return res.status(400).json({
          success: false,
          error: tokenJson.message || tokenJson.cause?.[0]?.description || 'Dados do cartão inválidos. Verifique número, validade e CVV.'
        });
      }
      cardToken = tokenJson.id;
    }

    if (!cardToken) {
      return res.status(400).json({ success: false, error: 'Token do cartão não gerado' });
    }

    const email = (payer?.email && payer.email.includes('@')) 
      ? payer.email 
      : 'streetstore364@gmail.com';
    const fullName = (payer?.name && payer.name.trim()) || 'Cliente Street Store';
    const nameParts = fullName.trim().split(' ');
    const firstName = nameParts[0] || 'Cliente';
    const lastName = nameParts.slice(1).join(' ') || 'Street';
    const cleanCpf = String(payer?.cpf || cardData?.cpf || '19119119100').replace(/\D/g, '');

    // Identificar bandeira automaticamente se não enviada
    let methodId = paymentMethodId;
    if (!methodId && cardData?.cardNumber) {
      const firstDigit = String(cardData.cardNumber).replace(/\D/g, '').charAt(0);
      const firstTwo = String(cardData.cardNumber).replace(/\D/g, '').substring(0, 2);
      if (firstDigit === '4') methodId = 'visa';
      else if (firstDigit === '5') methodId = 'master';
      else if (['34', '37'].includes(firstTwo)) methodId = 'amex';
      else methodId = 'visa';
    }

    const paymentPayload = {
      token: cardToken,
      transaction_amount: parseFloat(Number(transactionAmount).toFixed(2)),
      description: description || 'Street Store - Pedido Streetwear Oficial',
      installments: Number(installments) || 1,
      payment_method_id: methodId || 'visa',
      payer: {
        email,
        first_name: firstName,
        last_name: lastName,
        identification: {
          type: 'CPF',
          number: cleanCpf
        }
      },
      statement_descriptor: 'STREET STORE'
    };

    const idempotencyKey = `card-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;

    const mpRes = await fetch(`${MERCADO_PAGO_API_BASE}/v1/payments`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MERCADO_PAGO_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': idempotencyKey
      },
      body: JSON.stringify(paymentPayload)
    });

    const paymentResult = await mpRes.json();

    if (!mpRes.ok) {
      console.error('Mercado Pago card payment failed:', paymentResult);
      return res.status(mpRes.status).json({
        success: false,
        status: paymentResult.status || 'rejected',
        statusDetail: paymentResult.status_detail,
        error: paymentResult.message || paymentResult.cause?.[0]?.description || 'Erro ao processar cartão no Mercado Pago',
        details: paymentResult
      });
    }

    // Sync order on card approval & register in Bling ERP + PS5 Raffle if connected
    let orderNumber: string | undefined = undefined;
    let orderId: number | undefined = undefined;
    let raffleTicketCode: string | undefined = undefined;

    if (paymentResult.status === 'approved') {
      const finalized = await finalizeApprovedPayment({
        canonicalPaymentId: paymentResult.id,
        userId: resolvedUserId,
        amount: parseFloat(Number(transactionAmount).toFixed(2)),
        paymentMethod: `Cartão de Crédito ${installments}x (${methodId})`,
        dateApproved: paymentResult.date_approved,
        payer: {
          ...(resolvedUserId ? { uid: resolvedUserId } : {}),
          name: fullName,
          email,
          phone: payer?.phone,
          cpf: cleanCpf,
        },
        items: items || [],
        shippingAddress,
        shippingServiceId,
        shippingCarrier,
      });
      orderNumber = finalized.orderNumber;
      orderId = finalized.orderId;
      raffleTicketCode = finalized.raffleTicketCode;
    }

    return res.json({
      success: true,
      paymentId: paymentResult.id,
      status: paymentResult.status,
      statusDetail: paymentResult.status_detail,
      amount: paymentResult.transaction_amount,
      installments: paymentResult.installments,
      paymentMethodId: paymentResult.payment_method_id,
      dateApproved: paymentResult.date_approved,
      orderNumber,
      orderId,
      raffleTicketCode
    });

  } catch (error: any) {
    console.error('Error processing transparent card payment:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Erro interno ao processar pagamento com cartão'
    });
  }
});

// ==========================================
// PS5 RAFFLE SYSTEM (Street Store)
// ==========================================
async function processPs5RaffleEntry(params: {
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  customerCpf?: string;
  orderNumber?: string;
  paymentId: string | number;
  endToEndId?: string;
  channel?: string;
  cityState?: string;
  createdAt?: number;
  orderTotal: number;
  shippingAddress?: any;
}): Promise<string | null> {
  try {
    if (process.env.PS5_RAFFLE_ACTIVE === 'false') {
      return null;
    }
    const total = Number(params.orderTotal || 0);
    if (total < 150) {
      return null;
    }
    if (!hasFirebaseAdminEnv()) {
      return null;
    }
    const db = getAdminFirestore();
    const entriesRef = db.collection('raffle_ps5_entries');
    const paymentIdStr = String(params.paymentId).trim();
    const deterministicDocId = `mp_${paymentIdStr.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

    // Check existing docs by paymentId or endToEndId to prevent duplicates
    const existingSnap = await entriesRef.where('paymentId', '==', paymentIdStr).limit(1).get();
    if (!existingSnap.empty) {
      const existingData = existingSnap.docs[0].data();
      return existingData.ticketCode || null;
    }

    if (params.endToEndId) {
      const existingE2ESnap = await entriesRef.where('endToEndId', '==', String(params.endToEndId).trim()).limit(1).get();
      if (!existingE2ESnap.empty) {
        const existingData = existingE2ESnap.docs[0].data();
        return existingData.ticketCode || null;
      }
    }

    const docRef = entriesRef.doc(deterministicDocId);
    const counterRef = db.collection('counters').doc('raffle_ps5');
    const countSnap = await entriesRef.count().get();
    const existingCount = countSnap.data().count || 0;

    const cityState =
      params.cityState?.trim() ||
      (params.shippingAddress?.city && params.shippingAddress?.state
        ? `${params.shippingAddress.city} - ${params.shippingAddress.state}`
        : 'Itabira - MG');

    const createdAtMs =
      typeof params.createdAt === 'number' && Number.isFinite(params.createdAt)
        ? params.createdAt
        : Date.now();

    const ticketCode = await db.runTransaction(async (tx) => {
      const docSnap = await tx.get(docRef);
      if (docSnap.exists) {
        return (docSnap.data()?.ticketCode as string) || null;
      }

      const counterSnap = await tx.get(counterRef);
      const currentCounter = counterSnap.exists ? Number(counterSnap.data()?.lastTicketNumber || 0) : 0;
      const ticketNumber = Math.max(existingCount, currentCounter) + 1;

      const randomSuffix = crypto.randomBytes(2).toString('hex').toUpperCase();
      const generatedCode = `PS5-${String(ticketNumber).padStart(4, '0')}-${randomSuffix}`;

      tx.set(counterRef, { lastTicketNumber: ticketNumber, updatedAt: Date.now() }, { merge: true });
      tx.set(docRef, {
        ticketCode: generatedCode,
        ticketNumber,
        customerName: params.customerName || 'Cliente Street Store',
        customerEmail: params.customerEmail || 'streetstore364@gmail.com',
        customerPhone: params.customerPhone || '',
        customerCpf: params.customerCpf || '',
        orderNumber: params.orderNumber || `#${Math.floor(1000 + Math.random() * 9000)}`,
        paymentId: paymentIdStr,
        ...(params.endToEndId ? { endToEndId: String(params.endToEndId).trim() } : {}),
        ...(params.channel ? { channel: params.channel } : {}),
        orderTotal: total,
        cityState,
        createdAt: createdAtMs
      });

      return generatedCode;
    });

    if (ticketCode) {
      console.log(`[PS5 Raffle] New ticket generated successfully: ${ticketCode} for payment ${paymentIdStr} (Total: R$ ${total})`);
    }
    return ticketCode;
  } catch (err) {
    console.error('[PS5 Raffle Error]:', err);
    return null;
  }
}

// Public raffle status route
app.get('/api/raffle/ps5/status', async (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  try {
    const active = process.env.PS5_RAFFLE_ACTIVE !== 'false';
    if (!active) {
      return res.json({ success: true, active: false });
    }

    let total = 0;
    let recentEntries: any[] = [];

    if (hasFirebaseAdminEnv()) {
      try {
        const db = getAdminFirestore();
        const entriesSnap = await db.collection('raffle_ps5_entries').orderBy('createdAt', 'desc').limit(15).get();
        const countSnap = await db.collection('raffle_ps5_entries').count().get();
        total = countSnap.data().count || entriesSnap.size;

        entriesSnap.forEach(doc => {
          const d = doc.data();
          const code = d.ticketCode || 'PS5-0000-0000';
          const parts = code.split('-');
          const maskedCode = parts.length === 3 ? `${parts[0]}-${parts[1]}-****` : 'PS5-****-****';

          const rawName = (d.customerName || 'Cliente Street Store').trim();
          const nameParts = rawName.split(' ');
          const firstName = nameParts[0] || 'Cliente';
          const lastInitial = nameParts.length > 1 ? `${nameParts[nameParts.length - 1].charAt(0)}.` : '';
          const maskedName = `${firstName} ${lastInitial}`.trim();

          recentEntries.push({
            ticketCode: maskedCode,
            customerName: maskedName,
            cityState: d.cityState || 'Itabira - MG',
            createdAt: d.createdAt,
            orderTotal: d.orderTotal,
            status: 'Confirmado'
          });
        });
      } catch (dbErr) {
        console.warn('[PS5 Raffle Status] Error fetching from Firestore:', dbErr);
      }
    }

    const goal = 1000;
    const remaining = Math.max(0, goal - total);
    const percentage = Math.min(100, Math.round((total / goal) * 100));

    return res.json({
      success: true,
      active: true,
      goal,
      total,
      remaining,
      percentage,
      recentEntries
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, active: true, error: err.message || 'Erro ao carregar status do sorteio' });
  }
});

// Admin verification helper
function verifyAdminRaffleAccess(req: Request): boolean {
  const adminKey = req.headers['x-admin-key'] || req.query.key;
  const expectedKey = process.env.ADMIN_SECRET_KEY || 'street_ps5_sorteio_2026_08xK';
  return adminKey === expectedKey;
}

// Protected admin route: get all participants
app.get('/api/raffle/ps5/admin/entries', async (req: Request, res: Response) => {
  try {
    if (!verifyAdminRaffleAccess(req)) {
      return res.status(401).json({ success: false, error: 'Acesso negado. Chave de administrador inválida (x-admin-key ou ?key).' });
    }
    if (!hasFirebaseAdminEnv()) {
      return res.json({ success: true, entries: [], count: 0, message: 'Firebase Admin não configurado.' });
    }
    const db = getAdminFirestore();
    const snap = await db.collection('raffle_ps5_entries').orderBy('ticketNumber', 'asc').get();
    const entries: any[] = [];
    snap.forEach(doc => {
      entries.push({ id: doc.id, ...doc.data() });
    });
    return res.json({ success: true, count: entries.length, entries });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message || 'Erro ao listar participantes' });
  }
});

// Protected admin route: perform random draw
app.post('/api/raffle/ps5/admin/draw', async (req: Request, res: Response) => {
  try {
    if (!verifyAdminRaffleAccess(req)) {
      return res.status(401).json({ success: false, error: 'Acesso negado. Chave de administrador inválida (x-admin-key ou ?key).' });
    }
    if (!hasFirebaseAdminEnv()) {
      return res.status(400).json({ success: false, error: 'Firebase Admin não configurado.' });
    }
    const db = getAdminFirestore();
    const snap = await db.collection('raffle_ps5_entries').get();
    if (snap.empty) {
      return res.status(400).json({ success: false, error: 'Nenhum participante cadastrado no sorteio ainda.' });
    }

    const entries: Array<{ id: string; [key: string]: any }> = [];
    snap.forEach(doc => {
      entries.push({ id: doc.id, ...doc.data() });
    });

    const winningIndex = crypto.randomInt(0, entries.length);
    const winner = entries[winningIndex];

    await db.collection('raffle_ps5_draws').add({
      winnerTicketCode: winner.ticketCode,
      winnerName: winner.customerName,
      winnerEmail: winner.customerEmail,
      winnerOrder: winner.orderNumber,
      drawnAt: Date.now()
    });

    return res.json({
      success: true,
      message: 'Sorteio realizado com sucesso!',
      totalParticipants: entries.length,
      winner
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message || 'Erro ao realizar sorteio' });
  }
});

// Helper to parse ISO or Brazilian date-time (e.g. "25/11/2026 às 19:54:16" -> BRT -03:00)
function parseManualPaymentDate(input?: string | number): { timestampMs: number; iso: string } {
  if (typeof input === 'number' && Number.isFinite(input)) {
    const d = new Date(input);
    return { timestampMs: d.getTime(), iso: d.toISOString() };
  }
  const raw = String(input || '').trim();
  if (!raw) {
    const now = new Date();
    return { timestampMs: now.getTime(), iso: now.toISOString() };
  }
  const brMatch = raw.match(
    /^(\d{2})\/(\d{2})\/(\d{4})(?:[\s,]+(?:às|as)?\s*(\d{2}):(\d{2})(?::(\d{2}))?)?$/i
  );
  if (brMatch) {
    const [, dd, mm, yyyy, hh = '12', min = '00', ss = '00'] = brMatch;
    const isoBrt = `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}-03:00`;
    const parsed = new Date(isoBrt);
    if (!isNaN(parsed.getTime())) {
      return { timestampMs: parsed.getTime(), iso: parsed.toISOString() };
    }
  }
  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) {
    return { timestampMs: parsed.getTime(), iso: parsed.toISOString() };
  }
  const now = new Date();
  return { timestampMs: now.getTime(), iso: now.toISOString() };
}

// Protected admin route: register manual/external Pix payment idempotently (creates order + PS5 raffle ticket)
app.post('/api/raffle/ps5/admin/manual-entry', async (req: Request, res: Response) => {
  try {
    if (!verifyAdminRaffleAccess(req)) {
      return res.status(401).json({
        success: false,
        error: 'Acesso negado. Chave de administrador inválida (header x-admin-key ou query ?key).'
      });
    }
    if (!hasFirebaseAdminEnv()) {
      return res.status(500).json({
        success: false,
        error: 'Firebase Admin não configurado neste servidor.'
      });
    }

    const {
      customerName,
      customerEmail,
      customerPhone,
      customerCpf,
      amount,
      orderTotal,
      paidAt,
      createdAt,
      paymentId,
      paymentReference,
      endToEndId,
      channel,
      cityState,
      shippingAddress,
      items,
      syncBling = false,
      syncMelhorEnvio = false,
    } = req.body || {};

    const cleanName = String(customerName || '').trim();
    if (!cleanName) {
      return res.status(400).json({ success: false, error: 'Informe customerName.' });
    }

    const numericTotal = parseFloat(String(amount ?? orderTotal ?? 0).replace(',', '.'));
    if (!Number.isFinite(numericTotal) || numericTotal <= 0) {
      return res.status(400).json({ success: false, error: 'Valor pago inválido.' });
    }

    const canonicalPaymentId = String(paymentId || paymentReference || endToEndId || '').trim();
    if (!canonicalPaymentId) {
      return res.status(400).json({
        success: false,
        error: 'Informe paymentId (ex: ST47134932) ou endToEndId para garantir idempotência.'
      });
    }

    const { timestampMs, iso } = parseManualPaymentDate(paidAt ?? createdAt);
    const resolvedChannel = String(channel || 'Pix bancário manual / fora do webhook do Mercado Pago').trim();
    const resolvedEmail =
      customerEmail && String(customerEmail).includes('@')
        ? String(customerEmail).trim()
        : 'streetstore364@gmail.com';

    const db = getAdminFirestore();
    const entriesRef = db.collection('raffle_ps5_entries');
    const existingByPid = await entriesRef.where('paymentId', '==', canonicalPaymentId).limit(1).get();
    const existingByE2E =
      endToEndId && existingByPid.empty
        ? await entriesRef.where('endToEndId', '==', String(endToEndId).trim()).limit(1).get()
        : null;
    const existingDoc = !existingByPid.empty
      ? existingByPid.docs[0]
      : existingByE2E && !existingByE2E.empty
        ? existingByE2E.docs[0]
        : null;

    const orderRes = await createStoreOrder({
      customer: {
        name: cleanName,
        email: resolvedEmail,
        phone: customerPhone ? String(customerPhone) : undefined,
        cpf: customerCpf ? String(customerCpf) : undefined,
      },
      items: Array.isArray(items) && items.length > 0
        ? items
        : [
            {
              sku: canonicalPaymentId,
              name: `Pedido Manual Pix (${canonicalPaymentId})`,
              price: numericTotal,
              quantity: 1,
            },
          ],
      shippingAddress,
      paymentMethod: resolvedChannel,
      paymentId: canonicalPaymentId,
      endToEndId: endToEndId ? String(endToEndId).trim() : undefined,
      source: 'manual_pix',
      paidAt: iso,
      skipBling: syncBling !== true,
      skipMelhorEnvio: syncMelhorEnvio !== true,
      total: numericTotal,
    });

    if (existingDoc) {
      const existingData = existingDoc.data();
      return res.json({
        success: true,
        alreadyExisted: true,
        message: 'Pagamento manual já estava registrado anteriormente (idempotência preservada).',
        orderId: orderRes.id,
        orderNumber: existingData.orderNumber || orderRes.number,
        blingOrderId: orderRes.blingOrderId,
        ticketCode: existingData.ticketCode,
        entry: { id: existingDoc.id, ...existingData },
      });
    }

    if (numericTotal < 150) {
      return res.status(400).json({
        success: false,
        orderId: orderRes.id,
        orderNumber: orderRes.number,
        error: 'Pedido registrado, mas valor total é inferior a R$ 150,00 (não elegível ao sorteio do PS5).'
      });
    }

    const ticketCode = await processPs5RaffleEntry({
      customerName: cleanName,
      customerEmail: resolvedEmail,
      customerPhone: customerPhone ? String(customerPhone) : undefined,
      customerCpf: customerCpf ? String(customerCpf) : undefined,
      orderNumber: orderRes.number,
      paymentId: canonicalPaymentId,
      endToEndId: endToEndId ? String(endToEndId).trim() : undefined,
      channel: resolvedChannel,
      cityState: cityState ? String(cityState) : undefined,
      createdAt: timestampMs,
      orderTotal: numericTotal,
      shippingAddress,
    });

    if (!ticketCode) {
      return res.status(500).json({
        success: false,
        orderId: orderRes.id,
        orderNumber: orderRes.number,
        error: 'Pedido salvo, mas não foi possível gerar o bilhete (verifique PS5_RAFFLE_ACTIVE e logs do Firestore).'
      });
    }

    const docId = `mp_${canonicalPaymentId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    const savedSnap = await entriesRef.doc(docId).get();

    return res.json({
      success: true,
      alreadyExisted: false,
      message: 'Pagamento manual registrado no Firestore e bilhete do PS5 gerado com sucesso!',
      orderId: orderRes.id,
      orderNumber: orderRes.number,
      blingOrderId: orderRes.blingOrderId,
      ticketCode,
      entry: savedSnap.exists ? { id: savedSnap.id, ...savedSnap.data() } : null,
    });
  } catch (err: any) {
    console.error('[Manual Raffle Entry Error]:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Erro ao registrar compra manual no Firestore'
    });
  }
});

// Protected admin route: confirm/reprocess a pending Pix payment into orders + Bling ERP
app.post('/api/orders/admin/confirm-pending', async (req: Request, res: Response) => {
  try {
    if (!verifyAdminRaffleAccess(req)) {
      return res.status(401).json({
        success: false,
        error: 'Acesso negado. Chave de administrador inválida (header x-admin-key ou query ?key).'
      });
    }

    const {
      pendingPaymentId,
      mpPaymentId,
      endToEndId,
      paidAt,
      channel,
      syncBling = true,
    } = req.body || {};

    const cleanPendingId = String(pendingPaymentId || '').trim();
    if (!cleanPendingId) {
      return res.status(400).json({ success: false, error: 'Informe pendingPaymentId (ex: pix_st_1795717563519).' });
    }

    const pending = await loadPendingPaymentContext(cleanPendingId);
    if (!pending) {
      return res.status(404).json({ success: false, error: `Pagamento pendente ${cleanPendingId} não encontrado.` });
    }

    const canonicalId = String(mpPaymentId || pending.mpPaymentId || cleanPendingId).trim();
    const paidIso = paidAt ? parseManualPaymentDate(paidAt).iso : (pending.dateApproved || new Date().toISOString());

    const finalized = await finalizeApprovedPayment({
      canonicalPaymentId: canonicalId,
      pendingPaymentId: cleanPendingId,
      userId: pending.userId || pending.payer?.uid,
      contextKeys: [cleanPendingId],
      endToEndId: endToEndId ? String(endToEndId).trim() : undefined,
      source: 'admin_confirm_pending',
      amount: Number(pending.amount || 0),
      paymentMethod: channel ? String(channel) : (pending.paymentMethod || 'Pix Instantâneo Mercado Pago'),
      dateApproved: paidIso,
      payer: pending.payer,
      items: pending.items || [],
      shippingAddress: pending.shippingAddress,
      shippingServiceId: pending.shippingServiceId,
      shippingCarrier: pending.shippingCarrier,
      skipBling: syncBling === false,
    });

    return res.json({
      success: true,
      pendingPaymentId: cleanPendingId,
      canonicalPaymentId: canonicalId,
      ...finalized,
      message: 'Pagamento pendente confirmado, movido para orders e enviado ao fluxo do Bling ERP.',
    });
  } catch (err: any) {
    console.error('[Orders Admin Confirm Pending Error]:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Erro ao confirmar pagamento pendente.' });
  }
});

// Protected admin route: retry sending paid orders without blingOrderId to Bling ERP
app.post('/api/orders/admin/retry-bling', async (req: Request, res: Response) => {
  try {
    if (!verifyAdminRaffleAccess(req)) {
      return res.status(401).json({
        success: false,
        error: 'Acesso negado. Chave de administrador inválida (header x-admin-key ou query ?key).'
      });
    }
    const { paymentId, orderId, limit, forceAll } = req.body || {};
    const result = await retryPendingBlingOrders({ paymentId, orderId, limit, forceAll });
    return res.json({ success: true, ...result });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Erro ao reenviar pedidos para o Bling.' });
  }
});

// 6. Webhook receiver (Processes approved payments even if customer closes browser)
app.post('/api/mercadopago/webhook', async (req: Request, res: Response) => {
  try {
    console.log('[Mercado Pago Webhook Received]:', JSON.stringify(req.body || {}), req.query || {});
    const topic = String(req.body?.type || req.body?.topic || req.query?.topic || req.query?.type || '').toLowerCase();
    const action = String(req.body?.action || '').toLowerCase();
    const paymentId = req.body?.data?.id || req.query?.['data.id'] || req.query?.id;

    if (paymentId && (topic === 'payment' || action.startsWith('payment.') || !topic)) {
      const mpRes = await fetch(`${MERCADO_PAGO_API_BASE}/v1/payments/${paymentId}`, {
        headers: {
          'Authorization': `Bearer ${MERCADO_PAGO_ACCESS_TOKEN}`
        }
      });

      if (mpRes.ok) {
        const mpData = await mpRes.json();
        if (mpData?.status === 'approved') {
          const matchedCtx = await findPendingPaymentForMpPayment(mpData);
          const pendingCtx = matchedCtx?.payment || (await loadPendingPaymentContext(paymentId));
          const contextKeys = matchedCtx?.key && matchedCtx.key !== String(paymentId)
            ? [String(paymentId), matchedCtx.key]
            : [String(paymentId)];
          const methodLabel =
            pendingCtx?.paymentMethod ||
            (mpData.payment_method_id === 'pix'
              ? 'Pix Instantâneo Mercado Pago'
              : `Mercado Pago (${mpData.payment_method_id || 'Online'})`);

          await finalizeApprovedPayment({
            canonicalPaymentId: mpData.id,
            pendingPaymentId: matchedCtx?.key || pendingCtx?.id,
            userId: pendingCtx?.userId || pendingCtx?.payer?.uid,
            contextKeys,
            amount: Number(pendingCtx?.amount || mpData.transaction_amount || 0),
            paymentMethod: methodLabel,
            dateApproved: mpData.date_approved,
            payer: pendingCtx?.payer || mpData.payer,
            items: pendingCtx?.items || [],
            shippingAddress: pendingCtx?.shippingAddress,
            shippingServiceId: pendingCtx?.shippingServiceId,
            shippingCarrier: pendingCtx?.shippingCarrier,
          });
        }
      }
    }
  } catch (err) {
    console.error('[Mercado Pago Webhook Error]:', err);
  }
  res.status(200).send('OK');
});

// Handle checkout telemetry calls gracefully
app.all(['/checkout/api_integration', '/checkout/api_integration/*'], (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', received: true });
});

// 7. Bling ERP Integration Routes (OAuth & Data sync) + explicit /api/bling router mount
registerBlingRoutes(app, {
  onTokensUpdated: () => {
    invalidateCatalogCache();
    buildAndCacheCatalog({ forceImageSync: false })
      .catch(() => {})
      .finally(() => {
        syncImagesFromBling({ onBatchSaved: () => reapplyImagesToCachedCatalog() })
          .then(async () => {
            reapplyImagesToCachedCatalog();
            if (hasFirebaseAdminEnv()) {
              await syncImageStoreToFirestore().catch(() => {});
            }
          })
          .catch(() => {});
      });
  }
});
app.use('/api/bling', blingRouter);

// 8. Melhor Envio Logistics Routes (OAuth, Shipping Quotes, Labels & Tracking)
registerMelhorEnvioRoutes(app);

// Vite & Static file handler
async function setupViteOrStatic() {
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        host: '0.0.0.0',
        port: PORT,
        hmr: false,
      },
      appType: 'spa',
    });

    app.use(vite.middlewares);
    console.log(`[Dev] Vite middleware attached (HMR disabled).`);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
    console.log(`[Prod] Serving static files from ${distPath}`);
  }

  if (!process.env.VERCEL) {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Street Store Full-Stack Server running on port ${PORT}`);

      // 1. Automatically keep Melhor Envio connected, tokens refreshed, & shipments synced on startup + periodically
      startMelhorEnvioAutoSync();

      // 2. Automatically validate/refresh Bling token & sync ALL products (1411+) + high-res images + Firestore sequentially
      ensureBlingAuthorized({ verifyLive: true })
        .then(async (authorized) => {
          if (!authorized) {
            console.log('[Startup Bling Auth] Sessão Bling ausente ou pendente de autorização OAuth.');
            return;
          }
          try {
            const catResult = await buildAndCacheCatalog({ forceImageSync: false });
            console.log(`[Startup Bling Catalog] ${catResult.count} produtos em estoque pré-carregados (Bling bruto: ${catResult.blingRawCount}).`);
          } catch (err: any) {
            console.warn('[Startup Bling Catalog] Notice:', err?.message || err);
          }

          if (await ensureBlingAuthorized()) {
            if (!isImageSyncRunning()) {
              try {
                const syncRes = await syncImagesFromBling({ onBatchSaved: () => reapplyImagesToCachedCatalog() });
                reapplyImagesToCachedCatalog();
                console.log(`[Startup Bling Sync] ${syncRes.message}`);
                if (hasFirebaseAdminEnv()) {
                  await syncImageStoreToFirestore().catch(() => {});
                }
              } catch (err: any) {
                console.warn('[Startup Bling Sync] Notice:', err?.message || err);
              }
            }
          }

          if (hasFirebaseAdminEnv()) {
            try {
              const syncFs = await syncAllBlingProdutosToFirestore({ enrichHighResImages: true });
              console.log(`[Startup Bling Firestore] ${syncFs.totalImportado} itens sincronizados em ${syncFs.documentosGravados} docs.`);
            } catch (err: any) {
              console.warn('[Startup Bling Firestore] Notice:', err?.message || err);
            }
          }
        })
        .catch(() => {});

      // 3. Proactive Bling OAuth keepalive every 3 hours (renews automatically via Firestore & SQLite)
      const tokenKeepaliveTimer = setInterval(async () => {
        try {
          if (hasFirebaseAdminEnv() && (await hasFirestoreBlingToken())) {
            await getFirestoreValidToken();
          } else {
            const t = loadBlingTokens();
            if (t?.refresh_token) {
              await refreshBlingToken();
            }
          }
        } catch {
          // retry on next cycle
        }
      }, 3 * 60 * 60 * 1000);
      if (typeof tokenKeepaliveTimer.unref === 'function') tokenKeepaliveTimer.unref();

      // 4. Periodic background auto-sync: refresh Bling catalog every 5 min, retry pending Bling orders, and Firestore/images every 15 min
      const catalogSyncTimer = setInterval(async () => {
        try {
          if (isImageSyncRunning() || activeCatalogBuildPromise) return;
          if (await ensureBlingAuthorized()) {
            await buildAndCacheCatalog({ forceImageSync: false });
            await retryPendingBlingOrders({ limit: 5 }).catch(() => {});
          }
        } catch {
          // ignore
        }
      }, 5 * 60 * 1000);
      if (typeof catalogSyncTimer.unref === 'function') catalogSyncTimer.unref();

      const imageSyncTimer = setInterval(async () => {
        try {
          if (activeCatalogBuildPromise || isImageSyncRunning()) return;
          if (await ensureBlingAuthorized()) {
            await syncImagesFromBling({ onBatchSaved: () => reapplyImagesToCachedCatalog() })
              .then(() => reapplyImagesToCachedCatalog())
              .catch(() => {});
            if (hasFirebaseAdminEnv()) {
              await syncImageStoreToFirestore().catch(() => {});
              await syncAllBlingProdutosToFirestore({ enrichHighResImages: true }).catch(() => {});
            }
          }
        } catch {
          // ignore
        }
      }, 15 * 60 * 1000);
      if (typeof imageSyncTimer.unref === 'function') imageSyncTimer.unref();
    });
  }
}

if (!process.env.VERCEL) {
  setupViteOrStatic().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}

export default app;
export { app };
