import { collection, getDocs, query, where } from 'firebase/firestore';
import { Product } from '../types';
import { cleanDescription } from '../lib/cleanHtml';
import { filterVisibleProducts } from '../lib/hiddenProducts';
import {
  detectColorFromText,
  inferStoreCategory,
  normalizeColorName,
  normalizeColorOptions,
  parseBlingVariantMeta,
  sortSizes,
} from '../lib/catalogVariants';
import { auth, db } from '../lib/firebase';

export interface TrackedOrderProduct {
  name: string;
  price: number;
  quantity: number;
  variant?: string;
  color?: string;
  sku?: string;
  image?: string;
}

export interface TrackedOrder {
  orderNumber: string;
  orderId: number;
  status: 'open' | 'closed' | 'cancelled';
  paymentStatus: 'paid' | 'pending' | 'voided' | 'refunded';
  paymentMethod?: string;
  paymentId?: string | number;
  blingOrderId?: number;
  blingSyncStatus?: string;
  pendingPaymentId?: string;
  shippingStatus: 'unshipped' | 'shipped' | 'delivered' | 'unpacked';
  shippingCarrier: string;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  customer?: {
    name: string;
    email: string;
    phone?: string;
  };
  shippingAddress?: {
    name?: string;
    address: string;
    number: string;
    locality: string;
    city: string;
    province: string;
    zipcode: string;
    country?: string;
  };
  products: TrackedOrderProduct[];
  total: number;
  createdAt: string;
  paidAt?: string | null;
  shippedAt?: string | null;
  expiresAt?: string;
  expiresAtMs?: number;
  qrCode?: string;
  pixCopyPaste?: string;
  qrCodeBase64?: string;
  pixKey?: string;
}

export interface ReturnRequestResult {
  success: boolean;
  protocol?: string;
  message?: string;
  error?: string;
}

function mapFirestoreDocToProduct(docId: string, data: Record<string, any>): Product | null {
  const variacoesRaw =
    data.variacoes && typeof data.variacoes === 'object' ? Object.values(data.variacoes) as any[] : [];
  const variacoesStock = variacoesRaw.reduce((sum, v) => sum + Math.max(0, Number(v?.estoque || 0)), 0);
  const directStock = Math.max(0, Number(data.estoque || 0));
  const stockCount = variacoesRaw.length > 0 ? variacoesStock : directStock;
  if (stockCount <= 0) return null;

  const nome = String(data.nome || '').trim();
  if (!nome) return null;

  const preco = Number(data.preco || 0) > 0 ? Number(data.preco) : 119.9;
  const rawImages = Array.isArray(data.imagens) ? data.imagens.filter((u: unknown) => typeof u === 'string' && u.length > 0) : [];
  if (rawImages.length === 0 && typeof data.imagemURL === 'string' && data.imagemURL.trim()) {
    rawImages.push(data.imagemURL.trim());
  }

  const variantsList = variacoesRaw.map((v: any) => {
    const parsedMeta = v?.nome
      ? parseBlingVariantMeta({ nome: String(v.nome), isParentContainer: false })
      : null;
    const rawSize = parsedMeta?.hasExplicitSize ? parsedMeta.size : String(v.tamanho || parsedMeta?.size || 'Tamanho Único');
    const rawColor = parsedMeta?.color?.name || normalizeColorName(String(v.cor || ''));
    return {
      id: Number(v.blingId || v.id || 0),
      sku: String(v.codigo || ''),
      price: Number(v.preco || preco),
      stock: Math.max(0, Number(v.estoque || 0)),
      size: sortSizes([rawSize])[0] || 'Tamanho Único',
      ...(rawColor ? { color: rawColor } : {}),
    };
  });

  const inStockVariants = variantsList.filter((v) => v.stock > 0);
  if (variantsList.length > 0 && inStockVariants.length === 0) {
    return null;
  }

  const activeVariantSizes = sortSizes(
    inStockVariants.map((v) => v.size).filter(Boolean) as string[]
  );
  const docSizes = Array.isArray(data.tamanhos) ? data.tamanhos.filter((s: unknown) => typeof s === 'string' && s.trim()) : [];
  const sizes =
    variantsList.length > 0
      ? (activeVariantSizes.length > 0 ? activeVariantSizes : ['Tamanho Único'])
      : (docSizes.length > 0 ? sortSizes(docSizes) : ['Tamanho Único']);

  const inStockVarColors = inStockVariants.map((v) => v.color).filter(Boolean) as string[];
  const docColors = Array.isArray(data.cores)
    ? data.cores.filter((c: unknown): c is string => typeof c === 'string' && c.trim().length > 0)
    : [];
  const fallbackTitleColor =
    inStockVarColors.length === 0 && docColors.length === 0
      ? detectColorFromText(nome)
      : null;
  const resolvedColors = normalizeColorOptions(
    inStockVarColors.length > 0
      ? inStockVarColors
      : (docColors.length > 0 ? docColors : (fallbackTitleColor ? [fallbackTitleColor] : []))
  );

  const { category, subcategory } = inferStoreCategory(
    nome,
    String(data.categoriaStore ?? data.categoria ?? ''),
    String(data.subcategoriaStore ?? '')
  );

  return {
    id: `bling-${data.blingId || docId}`,
    name: nome,
    category,
    subcategory,
    price: preco,
    originalPrice: Math.round(preco * 1.3),
    tag: stockCount <= 3 ? 'POUCAS UNIDADES' : null,
    rating: 4.9,
    reviewsCount: 24,
    images: rawImages.length > 0 ? rawImages : ['/assets/streetstore-fallback.svg'],
    sizes,
    colors: resolvedColors,
    description: cleanDescription(String(data.descricao || `${nome} - Street Store Itabira`)),
    stockCount,
    details: {
      composition: category === 'calcados' ? 'Solado em borracha vulcanizada de alta durabilidade' : '100% Algodão Premium Heavyweight',
      weight: category === 'calcados' ? '900g o par' : '380g/m² Heavyweight',
      modelInfo: 'Modelagem autêntica da marca',
      origin: 'Itabira - MG // Fabricado no Brasil',
    },
    integration: {
      sku: String(data.codigo || `BLING-${data.blingId || docId}`),
      barcode: String(data.codigo || `789${docId}`),
      blingId: String(data.blingId || docId),
      weightGrams: 450,
      dimensionsCm: { width: 28, height: 12, depth: 32 },
    },
    canonicalUrl: 'https://www.streetstore.com.br',
    variantsList,
  };
}

async function fetchProductsFromClientFirestore(): Promise<Product[]> {
  try {
    const q = query(collection(db, 'products'), where('ativo', '==', true));
    const snap = await getDocs(q);
    if (snap.empty) return [];

    const parsed: Product[] = [];
    snap.forEach((docSnap) => {
      const mapped = mapFirestoreDocToProduct(docSnap.id, docSnap.data() as Record<string, any>);
      if (mapped) parsed.push(mapped);
    });

    parsed.sort((a, b) => Number(b.integration?.blingId || 0) - Number(a.integration?.blingId || 0));
    return filterVisibleProducts<Product>(parsed);
  } catch (err) {
    console.warn('[Catalog] Aviso ao consultar Firestore direto:', err);
    return [];
  }
}

/**
 * Fetch live products from Bling ERP / Firestore via backend proxy (with direct Firestore fallback)
 */
export async function getLiveCatalog(forceRefresh: boolean = false): Promise<{
  products: Product[];
  isLive: boolean;
  statusText: string;
  blingConnected?: boolean;
  blingCount?: number;
  blingError?: string | null;
}> {
  try {
    const url = forceRefresh
      ? `/api/catalog/products?refresh=true&_t=${Date.now()}`
      : `/api/catalog/products?_t=${Date.now()}`;

    const res = await fetch(url, {
      cache: 'no-store',
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!res.ok) {
      throw new Error(`Servidor respondeu com status ${res.status}`);
    }

    const data = await res.json();
    if (data.success && Array.isArray(data.products) && data.products.length > 0 && data.blingConnected !== false) {
      const rawList: Product[] = data.products.map((p: Product) => ({
        ...p,
        description: cleanDescription(p.description),
      }));
      const sanitizedProducts = filterVisibleProducts<Product>(rawList).sort(
        (a, b) => Number(b.integration?.blingId || 0) - Number(a.integration?.blingId || 0)
      );
      return {
        products: sanitizedProducts,
        isLive: true,
        blingConnected: Boolean(data.blingConnected),
        blingCount: Number(data.blingCount || sanitizedProducts.length),
        blingError: data.blingError || null,
        statusText: `Catálogo Oficial Ativo (${sanitizedProducts.length} peças em estoque)`,
      };
    }

    // Se API respondeu sem blingConnected=true, tenta ler diretamente da coleção products do Firestore
    const firestoreLive = await fetchProductsFromClientFirestore();
    if (firestoreLive.length > 0) {
      return {
        products: firestoreLive,
        isLive: true,
        blingConnected: true,
        blingCount: firestoreLive.length,
        blingError: data.blingError || null,
        statusText: `Catálogo Oficial Firestore (${firestoreLive.length} peças em estoque)`,
      };
    }

    if (data.success && Array.isArray(data.products) && data.products.length > 0) {
      const rawList: Product[] = data.products.map((p: Product) => ({
        ...p,
        description: cleanDescription(p.description),
      }));
      const sanitizedProducts = filterVisibleProducts<Product>(rawList).sort(
        (a, b) => Number(b.integration?.blingId || 0) - Number(a.integration?.blingId || 0)
      );
      return {
        products: sanitizedProducts,
        isLive: true,
        blingConnected: Boolean(data.blingConnected),
        blingCount: Number(data.blingCount || 0),
        blingError: data.blingError || null,
        statusText: `Catálogo Oficial Ativo (${sanitizedProducts.length} peças em estoque)`,
      };
    }

    return {
      products: [],
      isLive: false,
      blingConnected: false,
      blingCount: 0,
      blingError: data.blingError || null,
      statusText: 'Aguardando sincronização com Bling ERP',
    };
  } catch (error) {
    console.warn('Tentando leitura direta no Firestore:', error);
    const firestoreLive = await fetchProductsFromClientFirestore();
    if (firestoreLive.length > 0) {
      return {
        products: firestoreLive,
        isLive: true,
        blingConnected: true,
        blingCount: firestoreLive.length,
        blingError: null,
        statusText: `Catálogo Oficial Firestore (${firestoreLive.length} peças em estoque)`,
      };
    }

    return {
      products: [],
      isLive: false,
      blingConnected: false,
      blingCount: 0,
      blingError: null,
      statusText: 'Aguardando sincronização com Bling ERP',
    };
  }
}

/**
 * Track an order via Store Order Engine / Bling ERP & Melhor Envio
 */
export async function trackOrder(query: string): Promise<{
  success: boolean;
  orders: TrackedOrder[];
  message?: string;
  error?: string;
}> {
  try {
    const cleanQuery = encodeURIComponent(query.trim().replace(/^#/, ''));
    const res = await fetch(`/api/orders/track?q=${cleanQuery}`);
    return await res.json();
  } catch (error: any) {
    return {
      success: false,
      orders: [],
      error: error.message || 'Falha ao buscar pedido no sistema de rastreamento'
    };
  }
}

/**
 * Fetch orders belonging to the currently logged-in Firebase customer
 */
export async function getMyOrders(): Promise<{
  success: boolean;
  orders: TrackedOrder[];
  error?: string;
}> {
  try {
    const user = auth.currentUser;
    if (!user) {
      return { success: false, orders: [], error: 'Faça login para visualizar seus pedidos.' };
    }
    const token = await user.getIdToken();
    const res = await fetch(`/api/orders/my-orders?_t=${Date.now()}`, {
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    return await res.json();
  } catch (error: any) {
    return {
      success: false,
      orders: [],
      error: error.message || 'Falha ao carregar os pedidos da sua conta.',
    };
  }
}

/**
 * Request exchange or return for an order (Melhor Envio Logística Reversa)
 */
export async function requestOrderReturn(params: {
  orderId: number;
  orderNumber: string;
  customerEmail: string;
  customerName?: string;
  customerPhone?: string;
  reason: string;
  actionRequested: string;
  selectedItems: string[];
  details: string;
}): Promise<ReturnRequestResult> {
  try {
    const res = await fetch(`/api/orders/${params.orderId}/return`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(params)
    });
    return await res.json();
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Erro ao registrar solicitação de devolução'
    };
  }
}
