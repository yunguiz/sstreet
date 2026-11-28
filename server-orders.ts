import fs from 'fs';
import path from 'path';
import { fetchFromBling, ensureBlingAuthorized } from './server-bling.js';
import { addOrderToMelhorEnvioCart } from './server-melhor-envio.js';
import {
  hasFirebaseAdminEnv,
  isBlingConflictError,
  isBlingRateLimitError,
} from './lib/blingToken.js';
import { getAdminFirestore } from './lib/firebaseAdmin.js';

const ORDERS_STORE_PATH = path.resolve(
  process.env.VERCEL ? '/tmp' : process.cwd(),
  '.street_orders.json'
);

export interface StoredOrderItem {
  id?: string;
  sku?: string;
  variantId?: number;
  name: string;
  price: number;
  quantity: number;
  selectedSize?: string;
  selectedColor?: string;
  image?: string;
}

export interface StoredOrder {
  orderId: number;
  orderNumber: string;
  status: 'open' | 'closed' | 'cancelled';
  paymentStatus: 'paid' | 'pending' | 'voided' | 'refunded';
  shippingStatus: 'unshipped' | 'shipped' | 'delivered' | 'unpacked';
  shippingCarrier: string;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  paymentMethod: string;
  paymentId: string | number;
  pendingPaymentId?: string;
  endToEndId?: string;
  source?: string;
  userId?: string;
  blingOrderId?: number;
  blingOrderNumber?: number;
  blingSyncStatus?: 'synced' | 'pending' | 'failed' | 'skipped';
  blingSyncError?: string | null;
  blingSyncAttempts?: number;
  lastBlingSyncAt?: string | null;
  melhorEnvioCartId?: string;
  customer: {
    uid?: string;
    name: string;
    email: string;
    phone?: string;
    cpf?: string;
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
  products: Array<{
    name: string;
    price: number;
    quantity: number;
    variant?: string;
    color?: string;
    sku?: string;
    variantId?: number;
    image?: string;
  }>;
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
  returnRequests?: Array<{
    protocol: string;
    reason: string;
    actionRequested: string;
    selectedItems: string[];
    details: string;
    createdAt: string;
  }>;
}

interface OrdersDatabase {
  lastOrderSequence: number;
  orders: StoredOrder[];
}

function loadOrdersDb(): OrdersDatabase {
  try {
    if (fs.existsSync(ORDERS_STORE_PATH)) {
      const raw = fs.readFileSync(ORDERS_STORE_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.orders)) {
        return {
          lastOrderSequence: Number(parsed.lastOrderSequence) || 1000,
          orders: parsed.orders,
        };
      }
    }
  } catch (err) {
    console.warn('[Orders Store] Erro ao carregar pedidos locais:', err);
  }
  return { lastOrderSequence: 1000, orders: [] };
}

function saveOrdersDb(db: OrdersDatabase): void {
  try {
    fs.writeFileSync(ORDERS_STORE_PATH, JSON.stringify(db, null, 2), 'utf8');
  } catch (err) {
    console.warn('[Orders Store] Erro ao salvar pedidos locais:', err);
  }
}

function upsertOrderInLocalDb(order: StoredOrder): void {
  const db = loadOrdersDb();
  db.lastOrderSequence = Math.max(db.lastOrderSequence, Number(order.orderId || 0));
  const idx = db.orders.findIndex(
    (o) =>
      String(o.paymentId) === String(order.paymentId) ||
      (order.orderId && Number(o.orderId) === Number(order.orderId))
  );
  if (idx >= 0) {
    db.orders[idx] = order;
  } else {
    db.orders.unshift(order);
  }
  saveOrdersDb(db);
}

function sanitizeOrderDocId(paymentId: string | number): string {
  return `mp_${String(paymentId).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

async function getNextOrderSequence(): Promise<number> {
  const localDb = loadOrdersDb();
  if (hasFirebaseAdminEnv()) {
    try {
      const fsDb = getAdminFirestore();
      const counterRef = fsDb.collection('counters').doc('orders');
      const nextSeq = await fsDb.runTransaction(async (tx) => {
        const snap = await tx.get(counterRef);
        const current = snap.exists ? Number(snap.data()?.lastOrderSequence || 1000) : 1000;
        const next = Math.max(current, localDb.lastOrderSequence) + 1;
        tx.set(counterRef, { lastOrderSequence: next, updatedAt: Date.now() }, { merge: true });
        return next;
      });
      localDb.lastOrderSequence = nextSeq;
      saveOrdersDb(localDb);
      return nextSeq;
    } catch (err) {
      console.warn('[Orders Store] Fallback contador local (Firestore counter indisponível):', err);
    }
  }
  localDb.lastOrderSequence += 1;
  saveOrdersDb(localDb);
  return localDb.lastOrderSequence;
}

export async function findExistingOrderByPaymentId(
  paymentId: string | number,
  extraRefs?: { pendingPaymentId?: string; endToEndId?: string }
): Promise<StoredOrder | null> {
  const pidStr = String(paymentId);
  const localDb = loadOrdersDb();
  const localMatch = localDb.orders.find(
    (o) =>
      String(o.paymentId) === pidStr ||
      (extraRefs?.pendingPaymentId && o.pendingPaymentId === extraRefs.pendingPaymentId) ||
      (extraRefs?.endToEndId && o.endToEndId === extraRefs.endToEndId)
  );
  if (localMatch) {
    return localMatch;
  }

  if (hasFirebaseAdminEnv()) {
    try {
      const fsDb = getAdminFirestore();
      const directDoc = await fsDb.collection('orders').doc(sanitizeOrderDocId(pidStr)).get();
      if (directDoc.exists) {
        return directDoc.data() as StoredOrder;
      }
      const querySnap = await fsDb
        .collection('orders')
        .where('paymentId', '==', pidStr)
        .limit(1)
        .get();
      if (!querySnap.empty) {
        return querySnap.docs[0].data() as StoredOrder;
      }
      if (extraRefs?.pendingPaymentId) {
        const pendingSnap = await fsDb
          .collection('orders')
          .where('pendingPaymentId', '==', extraRefs.pendingPaymentId)
          .limit(1)
          .get();
        if (!pendingSnap.empty) {
          return pendingSnap.docs[0].data() as StoredOrder;
        }
      }
      if (extraRefs?.endToEndId) {
        const e2eSnap = await fsDb
          .collection('orders')
          .where('endToEndId', '==', extraRefs.endToEndId)
          .limit(1)
          .get();
        if (!e2eSnap.empty) {
          return e2eSnap.docs[0].data() as StoredOrder;
        }
      }
    } catch (err) {
      console.warn('[Orders Store] Erro ao buscar pedido existente no Firestore:', err);
    }
  }

  return null;
}

export async function saveOrderToFirestore(order: StoredOrder): Promise<void> {
  if (!hasFirebaseAdminEnv()) return;
  try {
    const fsDb = getAdminFirestore();
    const docId = sanitizeOrderDocId(order.paymentId || order.orderId);
    const cleanData = JSON.parse(JSON.stringify(order));
    await fsDb.collection('orders').doc(docId).set(cleanData, { merge: true });
  } catch (err) {
    console.warn('[Orders Store] Erro ao salvar pedido no Firestore:', err);
  }
}

let cachedBlingPaymentMethods: { items: any[]; fetchedAt: number } | null = null;
let inFlightPaymentMethodsFetch: Promise<any[]> | null = null;

async function getBlingPaymentMethodId(paymentMethodLabel: string): Promise<number | null> {
  try {
    const now = Date.now();
    if (!cachedBlingPaymentMethods || now - cachedBlingPaymentMethods.fetchedAt > 60 * 60 * 1000) {
      if (!inFlightPaymentMethodsFetch) {
        inFlightPaymentMethodsFetch = fetchFromBling('/formas-pagamentos?limite=50')
          .then((res) => {
            const items = Array.isArray(res?.data) ? res.data : [];
            cachedBlingPaymentMethods = { items, fetchedAt: Date.now() };
            return items;
          })
          .finally(() => {
            inFlightPaymentMethodsFetch = null;
          });
      }
      await inFlightPaymentMethodsFetch;
    }

    const methods = cachedBlingPaymentMethods?.items || [];
    if (!methods.length) return null;

    const lower = (paymentMethodLabel || '').toLowerCase();
    if (lower.includes('pix')) {
      const pixMethod = methods.find(
        (m: any) => m.tipoPagamento === 17 || String(m.descricao || '').toLowerCase().includes('pix')
      );
      if (pixMethod?.id) return Number(pixMethod.id);
    }

    if (lower.includes('cart') || lower.includes('crédito') || lower.includes('credito')) {
      const instMatch = lower.match(/(\d+)x/);
      const installments = instMatch ? `${instMatch[1]}x` : '1x';
      const exactCard = methods.find(
        (m: any) =>
          m.tipoPagamento === 3 &&
          String(m.descricao || '').toLowerCase().includes(installments)
      );
      if (exactCard?.id) return Number(exactCard.id);

      const anyCard = methods.find((m: any) => m.tipoPagamento === 3);
      if (anyCard?.id) return Number(anyCard.id);
    }
  } catch (err) {
    console.warn('[Bling Order] Não foi possível consultar formas de pagamento:', err);
  }
  return null;
}

async function resolveOrCreateBlingContact(params: {
  customer: {
    name?: string;
    email: string;
    phone?: string;
    cpf?: string;
  };
  shippingAddress?: {
    street?: string;
    number?: string;
    complement?: string;
    neighborhood?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
}): Promise<number | null> {
  const cleanCpf = String(params.customer.cpf || '').replace(/\D/g, '');
  const cleanPhone = String(params.customer.phone || '').replace(/\D/g, '');
  const email = (params.customer.email || '').trim().toLowerCase();
  const name = (params.customer.name || '').trim() || 'Cliente Street Store';

  // 1. Search by CPF if valid 11 digits
  if (cleanCpf.length === 11) {
    try {
      const resCpf = await fetchFromBling(`/contatos?numeroDocumento=${cleanCpf}&limite=5`);
      const found = Array.isArray(resCpf?.data) ? resCpf.data[0] : null;
      if (found?.id) return Number(found.id);
    } catch {
      // continue to search by email/name
    }
  }

  // 2. Search by email or name
  const searchKey = email && email !== 'streetstore364@gmail.com' ? email : name;
  if (searchKey && searchKey !== 'Cliente Street Store') {
    try {
      const resQuery = await fetchFromBling(`/contatos?pesquisa=${encodeURIComponent(searchKey)}&limite=10`);
      const list = Array.isArray(resQuery?.data) ? resQuery.data : [];
      const exact = list.find(
        (c: any) =>
          (email && String(c.email || '').toLowerCase() === email) ||
          (cleanCpf && String(c.numeroDocumento || '').replace(/\D/g, '') === cleanCpf) ||
          String(c.nome || '').trim().toLowerCase() === name.toLowerCase()
      );
      if (exact?.id) return Number(exact.id);
    } catch {
      // continue to create contact
    }
  }

  // 3. Create customer contact in Bling
  try {
    const contactPayload: Record<string, any> = {
      nome: name,
      tipo: 'F',
      situacao: 'A',
    };
    if (cleanCpf.length === 11) {
      contactPayload.numeroDocumento = cleanCpf;
    }
    if (email && email.includes('@')) {
      contactPayload.email = email;
    }
    if (cleanPhone.length >= 10) {
      contactPayload.celular = cleanPhone;
    }
    if (params.shippingAddress?.street && params.shippingAddress?.city) {
      contactPayload.endereco = {
        geral: {
          endereco: params.shippingAddress.street,
          numero: params.shippingAddress.number || 'S/N',
          complemento: params.shippingAddress.complement || '',
          bairro: params.shippingAddress.neighborhood || 'Centro',
          cep: (params.shippingAddress.zip || '').replace(/\D/g, ''),
          municipio: params.shippingAddress.city,
          uf: (params.shippingAddress.state || 'MG').toUpperCase().slice(0, 2),
        },
      };
    }

    const created = await fetchFromBling('/contatos', {
      method: 'POST',
      body: JSON.stringify(contactPayload),
    });
    if (created?.data?.id) {
      console.log(`[Bling Contact] Contato criado no Bling: ${name} (ID: ${created.data.id})`);
      return Number(created.data.id);
    }
  } catch (createErr: any) {
    if (isBlingConflictError(createErr)) {
      console.warn('[Bling Contact] Conflito (409) ao criar contato; consultando cadastro existente de forma idempotente.');
      if (cleanCpf.length === 11) {
        try {
          const resCpf = await fetchFromBling(`/contatos?numeroDocumento=${cleanCpf}&limite=5`);
          const found = Array.isArray(resCpf?.data) ? resCpf.data[0] : null;
          if (found?.id) return Number(found.id);
        } catch {
          // continue
        }
      }
      if (searchKey && searchKey !== 'Cliente Street Store') {
        try {
          const resQuery = await fetchFromBling(`/contatos?pesquisa=${encodeURIComponent(searchKey)}&limite=10`);
          const list = Array.isArray(resQuery?.data) ? resQuery.data : [];
          const exact = list.find(
            (c: any) =>
              (email && String(c.email || '').toLowerCase() === email) ||
              (cleanCpf && String(c.numeroDocumento || '').replace(/\D/g, '') === cleanCpf)
          ) || list[0];
          if (exact?.id) return Number(exact.id);
        } catch {
          // continue
        }
      }
    } else {
      console.warn('[Bling Contact] Falha ao criar contato específico no Bling, tentando Consumidor Final:', createErr?.message || createErr);
    }
  }

  // 4. Fallback to "Consumidor Final" contact in Bling
  try {
    const fallbackRes = await fetchFromBling('/contatos?pesquisa=Consumidor%20Final&limite=5');
    const fallbackContact = Array.isArray(fallbackRes?.data) ? fallbackRes.data[0] : null;
    if (fallbackContact?.id) return Number(fallbackContact.id);
  } catch {
    // ignore
  }

  return null;
}

const SKU_BLING_ID_TTL_MS = 30 * 60 * 1000;
const skuBlingIdCache = new Map<string, { id: number | null; expiresAt: number }>();
const inFlightSkuLookups = new Map<string, Promise<number | null>>();

async function resolveBlingProductIdBySku(sku?: string): Promise<number | null> {
  const cleanSku = String(sku || '').trim();
  if (!cleanSku || cleanSku.startsWith('ST-')) return null;

  const cached = skuBlingIdCache.get(cleanSku);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.id;
  }

  const existing = inFlightSkuLookups.get(cleanSku);
  if (existing) {
    return existing;
  }

  const promise = (async () => {
    try {
      const res = await fetchFromBling(`/produtos?codigos[]=${encodeURIComponent(cleanSku)}&limite=5`);
      const found = Array.isArray(res?.data)
        ? res.data.find((p: any) => String(p.codigo || '').trim() === cleanSku) || res.data[0]
        : null;
      const resolvedId = found?.id ? Number(found.id) : null;
      skuBlingIdCache.set(cleanSku, { id: resolvedId, expiresAt: Date.now() + SKU_BLING_ID_TTL_MS });
      return resolvedId;
    } catch {
      return null;
    } finally {
      inFlightSkuLookups.delete(cleanSku);
    }
  })();

  inFlightSkuLookups.set(cleanSku, promise);
  return promise;
}

const inFlightBlingOrderSyncs = new Map<string, Promise<{ blingOrderId?: number; blingOrderNumber?: number; error?: string }>>();

async function lookupExistingBlingOrderByStoreNumber(orderNumber: string): Promise<{ blingOrderId?: number; blingOrderNumber?: number } | null> {
  try {
    const res = await fetchFromBling(`/pedidos/vendas?numeroLoja=${encodeURIComponent(orderNumber)}&limite=5`);
    const list = Array.isArray(res?.data) ? res.data : [];
    const match = list.find((o: any) => String(o.numeroLoja || '').trim() === orderNumber.trim()) || list[0];
    if (match?.id) {
      return {
        blingOrderId: Number(match.id),
        blingOrderNumber: match.numero ? Number(match.numero) : undefined,
      };
    }
  } catch {
    // ignore
  }
  return null;
}

async function syncOrderToBling(params: {
  orderNumber: string;
  paymentMethod: string;
  paymentId: string | number;
  customer: {
    name?: string;
    email: string;
    phone?: string;
    cpf?: string;
  };
  items: StoredOrderItem[];
  shippingAddress?: {
    street?: string;
    number?: string;
    complement?: string;
    neighborhood?: string;
    city?: string;
    state?: string;
    zip?: string;
    name?: string;
  };
  total: number;
  nowIso: string;
}): Promise<{ blingOrderId?: number; blingOrderNumber?: number; error?: string }> {
  const syncKey = `${params.orderNumber}:${params.paymentId}`;
  const inFlight = inFlightBlingOrderSyncs.get(syncKey);
  if (inFlight) {
    return inFlight;
  }

  const runSync = (async () => {
    if (!(await ensureBlingAuthorized())) {
      const msg = 'Bling OAuth não autorizado no momento; sincronização do pedido adiada.';
      console.warn('[Bling Order]', msg);
      return { error: msg };
    }

  const todayDate = params.nowIso.slice(0, 10);
  const contactId = await resolveOrCreateBlingContact({
    customer: params.customer,
    shippingAddress: params.shippingAddress,
  });

  if (!contactId) {
    const msg = 'Não foi possível resolver contato.id no Bling.';
    console.error('[Bling Order]', msg);
    return { error: msg };
  }

  const blingItems: any[] = [];
  for (let idx = 0; idx < (params.items || []).length; idx++) {
    const it = params.items[idx];
    const itemSku = (it.sku || '').trim() || `ST-${idx + 1}`;
    let prodId = it.variantId && Number(it.variantId) > 0 ? Number(it.variantId) : null;
    if (!prodId && it.sku) {
      prodId = await resolveBlingProductIdBySku(it.sku);
    }

    const itemObj: Record<string, any> = {
      codigo: itemSku,
      unidade: 'UN',
      descricao: it.name,
      quantidade: Number(it.quantity || 1),
      valor: Number(it.price || 0),
    };
    if (prodId && prodId > 0) {
      itemObj.produto = { id: prodId };
    }
    blingItems.push(itemObj);
  }

  if (blingItems.length === 0) {
    blingItems.push({
      codigo: 'ST-ONLINE',
      unidade: 'UN',
      descricao: `Pedido Online ${params.orderNumber}`,
      quantidade: 1,
      valor: Number(params.total || 0),
    });
  }

  const itemsSubtotal = blingItems.reduce((sum, it) => sum + Number(it.valor) * Number(it.quantidade), 0);
  const shippingDiff = Math.max(0, Number((Number(params.total || 0) - itemsSubtotal).toFixed(2)));
  const paymentMethodBlingId = await getBlingPaymentMethodId(params.paymentMethod);

 const blingPayload: Record<string, any> = {
    numeroLoja: params.orderNumber,
    loja: {
      id: Number(process.env.BLING_STORE_ID || 206350173),
    },
    data: todayDate,
    dataSaida: todayDate,
    contato: { id: contactId },
    observacoes: `[STREET STORE SITE] Pedido ${params.orderNumber} | Pago via ${params.paymentMethod} (MP ID: ${params.paymentId}) | Cliente: ${params.customer.name || 'Cliente'} (${params.customer.email})${params.customer.phone ? ` | WhatsApp: ${params.customer.phone}` : ''}`,
    itens: blingItems,
  };

  if (params.shippingAddress?.street || shippingDiff > 0) {
    blingPayload.transporte = {
      fretePorConta: shippingDiff > 0 ? 0 : 9,
      frete: shippingDiff,
      ...(params.shippingAddress?.street
        ? {
            etiqueta: {
              nome: params.shippingAddress.name || params.customer.name || 'Cliente Street Store',
              endereco: params.shippingAddress.street,
              numero: params.shippingAddress.number || 'S/N',
              complemento: params.shippingAddress.complement || '',
              municipio: params.shippingAddress.city || '',
              uf: (params.shippingAddress.state || '').toUpperCase().slice(0, 2),
              cep: (params.shippingAddress.zip || '').replace(/\D/g, ''),
              bairro: params.shippingAddress.neighborhood || 'Centro',
              nomePais: 'BRASIL',
            },
          }
        : {}),
    };
  }

  if (paymentMethodBlingId) {
    blingPayload.parcelas = [
      {
        dataVencimento: todayDate,
        valor: Number(params.total || itemsSubtotal),
        observacoes: `Pagamento aprovado MP ${params.paymentId}`,
        formaPagamento: { id: paymentMethodBlingId },
      },
    ];
  }

  let primaryErrorMsg = '';
  try {
    const blingRes = await fetchFromBling('/pedidos/vendas', {
      method: 'POST',
      body: JSON.stringify(blingPayload),
    });
    if (blingRes?.data?.id) {
      console.log(`[Orders Store] Pedido ${params.orderNumber} sincronizado no Bling ERP (ID: ${blingRes.data.id}).`);
      return {
        blingOrderId: Number(blingRes.data.id),
        blingOrderNumber: blingRes.data.numero ? Number(blingRes.data.numero) : undefined,
      };
    }
  } catch (blingErr: any) {
    primaryErrorMsg = blingErr?.message || String(blingErr);

    // 409 Conflict = order likely already exists in Bling under this numeroLoja; resolve idempotently
    if (isBlingConflictError(blingErr)) {
      const existingBling = await lookupExistingBlingOrderByStoreNumber(params.orderNumber);
      if (existingBling?.blingOrderId) {
        console.log(`[Orders Store] Pedido ${params.orderNumber} já existia no Bling (409 idempotente -> ID: ${existingBling.blingOrderId}).`);
        return existingBling;
      }
      return { error: primaryErrorMsg };
    }

    // Do NOT trigger a second POST attempt on 429 Rate Limit or 401 Auth failure — fail fast & let retry queue handle it
    if (isBlingRateLimitError(blingErr) || primaryErrorMsg.includes('[401]')) {
      console.warn('[Orders Store] Envio ao Bling adiado por cota/autenticação (sem duplicar POST):', primaryErrorMsg);
      return { error: primaryErrorMsg };
    }

    console.error('[Orders Store] Falha no envio completo ao Bling ERP:', primaryErrorMsg);

    // Clean fallback retry without optional produto.id / parcelas / transporte in case Bling rejected SKU/payment relation
    try {
      const fallbackPayload = {
        numeroLoja: params.orderNumber,
        data: todayDate,
        dataSaida: todayDate,
        contato: { id: contactId },
        observacoes: blingPayload.observacoes,
        itens: blingItems.map((it) => ({
          codigo: it.codigo,
          unidade: 'UN',
          descricao: it.descricao,
          quantidade: it.quantidade,
          valor: it.valor,
        })),
      };
      const retryRes = await fetchFromBling('/pedidos/vendas', {
        method: 'POST',
        body: JSON.stringify(fallbackPayload),
      });
      if (retryRes?.data?.id) {
        console.log(`[Orders Store] Pedido ${params.orderNumber} sincronizado no Bling ERP (fallback ID: ${retryRes.data.id}).`);
        return {
          blingOrderId: Number(retryRes.data.id),
          blingOrderNumber: retryRes.data.numero ? Number(retryRes.data.numero) : undefined,
        };
      }
    } catch (retryErr: any) {
      if (isBlingConflictError(retryErr)) {
        const existingBling = await lookupExistingBlingOrderByStoreNumber(params.orderNumber);
        if (existingBling?.blingOrderId) {
          return existingBling;
        }
      }
      const retryMsg = retryErr?.message || String(retryErr);
      console.error('[Orders Store] Fallback no Bling ERP também falhou:', retryMsg);
      return { error: retryMsg };
    }
  }

  return { error: primaryErrorMsg || 'Resposta sem ID ao criar pedido no Bling ERP.' };
  })().finally(() => {
    inFlightBlingOrderSyncs.delete(syncKey);
  });

  inFlightBlingOrderSyncs.set(syncKey, runSync);
  return runSync;
}

const inFlightOrderCreations = new Map<
  string,
  Promise<{
    success: boolean;
    id: number;
    number: string;
    blingOrderId?: number;
    blingOrderNumber?: number;
    blingSyncStatus?: 'synced' | 'pending' | 'failed' | 'skipped';
    blingSyncError?: string;
    melhorEnvioCartId?: string;
    alreadyExisted?: boolean;
  }>
>();

export async function createStoreOrder(params: {
  customer: {
    uid?: string;
    name?: string;
    email: string;
    phone?: string;
    cpf?: string;
  };
  items: StoredOrderItem[];
  shippingAddress?: {
    street?: string;
    number?: string;
    complement?: string;
    neighborhood?: string;
    city?: string;
    state?: string;
    zip?: string;
    name?: string;
    phone?: string;
  };
  shippingServiceId?: number;
  shippingCarrier?: string;
  paymentMethod: string;
  paymentId: string | number;
  pendingPaymentId?: string;
  endToEndId?: string;
  source?: string;
  userId?: string;
  paidAt?: string;
  skipBling?: boolean;
  skipMelhorEnvio?: boolean;
  total: number;
}): Promise<{
  success: boolean;
  id: number;
  number: string;
  blingOrderId?: number;
  blingOrderNumber?: number;
  blingSyncStatus?: 'synced' | 'pending' | 'failed' | 'skipped';
  blingSyncError?: string;
  melhorEnvioCartId?: string;
  alreadyExisted?: boolean;
}> {
  const creationKey = String(params.paymentId || params.pendingPaymentId || '');
  if (creationKey) {
    const activeCreation = inFlightOrderCreations.get(creationKey);
    if (activeCreation) {
      return activeCreation;
    }
  }

  const executeCreation = (async () => {
  const existing = await findExistingOrderByPaymentId(params.paymentId, {
    pendingPaymentId: params.pendingPaymentId,
    endToEndId: params.endToEndId,
  });

  if (existing) {
    let updated = false;
    const resolvedUid = params.userId || params.customer?.uid;
    if (resolvedUid && !existing.userId) {
      existing.userId = resolvedUid;
      existing.customer = { ...existing.customer, uid: resolvedUid };
      updated = true;
    }
    if (params.pendingPaymentId && !existing.pendingPaymentId) {
      existing.pendingPaymentId = params.pendingPaymentId;
      updated = true;
    }

    // If previous save missed Bling sync and skipBling is false, retry Bling sync idempotently
    if (!existing.blingOrderId && !params.skipBling) {
      const blingSync = await syncOrderToBling({
        orderNumber: existing.orderNumber,
        paymentMethod: existing.paymentMethod,
        paymentId: existing.paymentId,
        customer: existing.customer,
        items: (params.items && params.items.length > 0) ? params.items : existing.products.map((p) => ({
          name: p.name,
          price: p.price,
          quantity: p.quantity,
          sku: p.sku,
          variantId: p.variantId,
          image: p.image,
        })),
        shippingAddress: params.shippingAddress,
        total: existing.total,
        nowIso: existing.createdAt,
      });
      existing.blingSyncAttempts = (existing.blingSyncAttempts || 0) + 1;
      existing.lastBlingSyncAt = new Date().toISOString();
      if (blingSync.blingOrderId) {
        existing.blingOrderId = blingSync.blingOrderId;
        existing.blingOrderNumber = blingSync.blingOrderNumber;
        existing.blingSyncStatus = 'synced';
        existing.blingSyncError = null;
      } else {
        existing.blingSyncStatus = 'failed';
        existing.blingSyncError = blingSync.error || 'Falha temporária ao enviar pedido ao Bling ERP';
      }
      updated = true;
    }

    if (updated) {
      upsertOrderInLocalDb(existing);
      await saveOrderToFirestore(existing);
    }

    return {
      success: true,
      id: existing.orderId,
      number: existing.orderNumber,
      blingOrderId: existing.blingOrderId,
      blingOrderNumber: existing.blingOrderNumber,
      blingSyncStatus: existing.blingSyncStatus,
      blingSyncError: existing.blingSyncError || undefined,
      melhorEnvioCartId: existing.melhorEnvioCartId,
      alreadyExisted: true,
    };
  }

  const orderId = await getNextOrderSequence();
  const orderNumber = `#${orderId}`;
  const nowIso = params.paidAt || new Date().toISOString();
  const resolvedUid = params.userId || params.customer?.uid;

  const newOrder: StoredOrder = {
    orderId,
    orderNumber,
    status: 'open',
    paymentStatus: 'paid',
    shippingStatus: 'unshipped',
    shippingCarrier: params.shippingCarrier || 'Correios / Transportadora',
    trackingNumber: null,
    trackingUrl: null,
    paymentMethod: params.paymentMethod,
    paymentId: String(params.paymentId),
    ...(params.pendingPaymentId ? { pendingPaymentId: params.pendingPaymentId } : {}),
    ...(params.endToEndId ? { endToEndId: params.endToEndId } : {}),
    ...(params.source ? { source: params.source } : {}),
    ...(resolvedUid ? { userId: resolvedUid } : {}),
    blingSyncStatus: params.skipBling ? 'skipped' : 'pending',
    blingSyncAttempts: 0,
    customer: {
      ...(resolvedUid ? { uid: resolvedUid } : {}),
      name: params.customer.name?.trim() || 'Cliente Street Store',
      email: params.customer.email,
      phone: params.customer.phone || '',
      cpf: params.customer.cpf,
    },
    shippingAddress: params.shippingAddress
      ? {
          name: params.shippingAddress.name || params.customer.name || 'Cliente Street Store',
          address: params.shippingAddress.street || 'Rua Principal',
          number: params.shippingAddress.number || 'S/N',
          locality: params.shippingAddress.neighborhood || 'Centro',
          city: params.shippingAddress.city || 'Itabira',
          province: params.shippingAddress.state || 'MG',
          zipcode: (params.shippingAddress.zip || '').replace(/\D/g, ''),
          country: 'BR',
        }
      : undefined,
    products: (params.items || []).map((it) => ({
      name: it.name,
      price: Number(it.price || 0),
      quantity: Number(it.quantity || 1),
      variant: it.selectedSize || 'Tamanho Único',
      ...(it.selectedColor ? { color: it.selectedColor } : {}),
      sku: it.sku,
      variantId: it.variantId,
      image: it.image || '',
    })),
    total: Number(params.total || 0),
    createdAt: nowIso,
    paidAt: nowIso,
    shippedAt: null,
  };

  // CRITICAL: Save paid order to local DB & Firestore IMMEDIATELY BEFORE Bling / Melhor Envio calls.
  // Temporary Bling 429 or network timeouts MUST NEVER block saving the paid order or leave it stuck in pending_payments.
  upsertOrderInLocalDb(newOrder);
  await saveOrderToFirestore(newOrder);
  console.log(`[Orders Store] Pedido pago ${orderNumber} persistido em orders (ID pagamento: ${newOrder.paymentId}).`);

  let postSaveDirty = false;

  // Sync order to Bling ERP unless skipped (e.g. manual historical reconciliation)
  if (!params.skipBling) {
    try {
      newOrder.blingSyncAttempts = 1;
      newOrder.lastBlingSyncAt = new Date().toISOString();
      const blingSync = await syncOrderToBling({
        orderNumber,
        paymentMethod: params.paymentMethod,
        paymentId: params.paymentId,
        customer: newOrder.customer,
        items: params.items || [],
        shippingAddress: params.shippingAddress,
        total: newOrder.total,
        nowIso,
      });
      if (blingSync.blingOrderId) {
        newOrder.blingOrderId = blingSync.blingOrderId;
        newOrder.blingOrderNumber = blingSync.blingOrderNumber;
        newOrder.blingSyncStatus = 'synced';
        newOrder.blingSyncError = null;
      } else {
        newOrder.blingSyncStatus = 'failed';
        newOrder.blingSyncError = blingSync.error || 'Erro temporário ao enviar pedido ao Bling ERP';
      }
      postSaveDirty = true;
    } catch (blingErr: any) {
      newOrder.blingSyncStatus = 'failed';
      newOrder.blingSyncError = blingErr?.message || String(blingErr);
      postSaveDirty = true;
      console.error('[Orders Store] Erro ao sincronizar pedido no Bling ERP (pedido já salvo no site):', newOrder.blingSyncError);
    }
  }

  // Register shipment in Melhor Envio Cart if connected & address provided
  let melhorEnvioCartId: string | undefined;
  if (!params.skipMelhorEnvio && params.shippingAddress?.zip && params.shippingAddress?.street) {
    try {
      const meCart = await addOrderToMelhorEnvioCart({
        serviceId: params.shippingServiceId || 1,
        orderNumber,
        customer: newOrder.customer,
        shippingAddress: {
          street: params.shippingAddress.street,
          number: params.shippingAddress.number || 'S/N',
          complement: params.shippingAddress.complement,
          neighborhood: params.shippingAddress.neighborhood || 'Centro',
          city: params.shippingAddress.city || 'Itabira',
          state: params.shippingAddress.state || 'MG',
          zip: params.shippingAddress.zip,
        },
        items: newOrder.products.map((p) => ({
          name: p.name,
          quantity: p.quantity,
          price: p.price,
        })),
        total: newOrder.total,
      });
      if (meCart.success && meCart.cartId) {
        melhorEnvioCartId = meCart.cartId;
        newOrder.melhorEnvioCartId = meCart.cartId;
        postSaveDirty = true;
        console.log(`[Orders Store] Etiqueta adicionada ao carrinho Melhor Envio: ${meCart.cartId}`);
      }
    } catch (meErr: any) {
      console.warn('[Orders Store] Registro opcional no Melhor Envio ignorado:', meErr?.message || meErr);
    }
  }

  if (postSaveDirty) {
    upsertOrderInLocalDb(newOrder);
    await saveOrderToFirestore(newOrder);
  }

  return {
    success: true,
    id: orderId,
    number: orderNumber,
    blingOrderId: newOrder.blingOrderId,
    blingOrderNumber: newOrder.blingOrderNumber,
    blingSyncStatus: newOrder.blingSyncStatus,
    blingSyncError: newOrder.blingSyncError || undefined,
    melhorEnvioCartId,
  };
  })().finally(() => {
    if (creationKey) {
      inFlightOrderCreations.delete(creationKey);
    }
  });

  if (creationKey) {
    inFlightOrderCreations.set(creationKey, executeCreation);
  }

  return executeCreation;
}

let activeRetryBlingOrdersPromise: Promise<{
  checked: number;
  synced: number;
  failed: number;
  details: Array<{ orderNumber: string; paymentId: string | number; blingOrderId?: number; error?: string }>;
}> | null = null;

export async function retryPendingBlingOrders(options?: {
  paymentId?: string | number;
  orderId?: number;
  limit?: number;
  forceAll?: boolean;
}): Promise<{
  checked: number;
  synced: number;
  failed: number;
  details: Array<{ orderNumber: string; paymentId: string | number; blingOrderId?: number; error?: string }>;
}> {
  if (activeRetryBlingOrdersPromise && !options?.paymentId && !options?.orderId) {
    return activeRetryBlingOrdersPromise;
  }

  const run = (async () => {
    const candidatesMap = new Map<string, StoredOrder>();
    const localDb = loadOrdersDb();
    for (const o of localDb.orders) {
      candidatesMap.set(String(o.paymentId || o.orderId), o);
    }

    if (hasFirebaseAdminEnv()) {
      try {
        const fsDb = getAdminFirestore();
        const snap = await fsDb.collection('orders').orderBy('createdAt', 'desc').limit(100).get();
        snap.forEach((doc) => {
          const o = doc.data() as StoredOrder;
          const key = String(o.paymentId || o.orderId);
          const prev = candidatesMap.get(key);
          candidatesMap.set(key, prev ? { ...prev, ...o } : o);
        });
      } catch (err) {
        console.warn('[Orders Retry Bling] Aviso ao listar pedidos no Firestore:', err);
      }
    }

    const targetPaymentId = options?.paymentId !== undefined ? String(options.paymentId) : null;
    const targetOrderId = options?.orderId !== undefined ? Number(options.orderId) : null;

    const toSync = Array.from(candidatesMap.values())
      .filter((o) => {
        if (o.paymentStatus !== 'paid') return false;
        if (targetPaymentId) return String(o.paymentId) === targetPaymentId || o.pendingPaymentId === targetPaymentId;
        if (targetOrderId) return Number(o.orderId) === targetOrderId;
        if (o.blingOrderId) return false;
        if (!options?.forceAll && o.blingSyncStatus === 'skipped') return false;
        return true;
      })
      .slice(0, options?.limit ?? 10);

    const details: Array<{ orderNumber: string; paymentId: string | number; blingOrderId?: number; error?: string }> = [];
    let synced = 0;
    let failed = 0;

    if (toSync.length === 0 || !(await ensureBlingAuthorized())) {
      return { checked: toSync.length, synced: 0, failed: 0, details };
    }

    for (const order of toSync) {
      const blingRes = await syncOrderToBling({
        orderNumber: order.orderNumber,
        paymentMethod: order.paymentMethod,
        paymentId: order.paymentId,
        customer: order.customer,
        items: (order.products || []).map((p) => ({
          name: p.name,
          price: p.price,
          quantity: p.quantity,
          sku: p.sku,
          variantId: p.variantId,
          selectedSize: p.variant,
          image: p.image,
        })),
        shippingAddress: order.shippingAddress
          ? {
              street: order.shippingAddress.address,
              number: order.shippingAddress.number,
              neighborhood: order.shippingAddress.locality,
              city: order.shippingAddress.city,
              state: order.shippingAddress.province,
              zip: order.shippingAddress.zipcode,
              name: order.shippingAddress.name,
            }
          : undefined,
        total: order.total,
        nowIso: order.paidAt || order.createdAt || new Date().toISOString(),
      });

      order.blingSyncAttempts = (order.blingSyncAttempts || 0) + 1;
      order.lastBlingSyncAt = new Date().toISOString();

      if (blingRes.blingOrderId) {
        order.blingOrderId = blingRes.blingOrderId;
        order.blingOrderNumber = blingRes.blingOrderNumber;
        order.blingSyncStatus = 'synced';
        order.blingSyncError = null;
        synced++;
        details.push({
          orderNumber: order.orderNumber,
          paymentId: order.paymentId,
          blingOrderId: blingRes.blingOrderId,
        });
      } else {
        order.blingSyncStatus = 'failed';
        order.blingSyncError = blingRes.error || 'Erro ao enviar pedido para Bling ERP';
        failed++;
        details.push({
          orderNumber: order.orderNumber,
          paymentId: order.paymentId,
          error: order.blingSyncError,
        });
      }

      upsertOrderInLocalDb(order);
      await saveOrderToFirestore(order);
    }

    return { checked: toSync.length, synced, failed, details };
  })().finally(() => {
    if (!options?.paymentId && !options?.orderId) {
      activeRetryBlingOrdersPromise = null;
    }
  });

  if (!options?.paymentId && !options?.orderId) {
    activeRetryBlingOrdersPromise = run;
  }

  return run;
}

const BLING_SALES_CACHE_TTL_MS = 45 * 1000;
let cachedBlingSalesOrders: { items: any[]; fetchedAt: number } | null = null;
let inFlightBlingSalesFetch: Promise<any[]> | null = null;

async function getCachedBlingSalesOrders(): Promise<any[]> {
  const now = Date.now();
  if (cachedBlingSalesOrders && now - cachedBlingSalesOrders.fetchedAt < BLING_SALES_CACHE_TTL_MS) {
    return cachedBlingSalesOrders.items;
  }

  if (inFlightBlingSalesFetch) {
    return inFlightBlingSalesFetch;
  }

  inFlightBlingSalesFetch = (async () => {
    try {
      if (!(await ensureBlingAuthorized())) {
        return cachedBlingSalesOrders?.items || [];
      }
      const blingData = await fetchFromBling('/pedidos/vendas?pagina=1&limite=50');
      const rawOrders = Array.isArray(blingData?.data) ? blingData.data : [];
      cachedBlingSalesOrders = {
        items: rawOrders,
        fetchedAt: Date.now(),
      };
      return rawOrders;
    } catch (err: any) {
      console.warn('[Orders Track] Bling lookup notice:', err?.message || err);
      return cachedBlingSalesOrders?.items || [];
    } finally {
      inFlightBlingSalesFetch = null;
    }
  })();

  return inFlightBlingSalesFetch;
}

function mapBlingOrderToStoredOrder(bo: any): StoredOrder {
  return {
    orderId: bo.id,
    orderNumber: `#${bo.numero || bo.id}`,
    status: 'open',
    paymentStatus: 'paid',
    shippingStatus: bo.transporte?.etiqueta ? 'shipped' : 'unshipped',
    shippingCarrier: bo.transporte?.transportador?.nome || 'Correios / Transportadora',
    trackingNumber: bo.transporte?.etiqueta?.codigoRastreamento || null,
    trackingUrl: bo.transporte?.etiqueta?.codigoRastreamento
      ? `https://melhorenvio.com.br/rastreio/${bo.transporte.etiqueta.codigoRastreamento}`
      : null,
    paymentMethod: 'Mercado Pago',
    paymentId: String(bo.id),
    blingOrderId: bo.id,
    blingOrderNumber: bo.numero ? Number(bo.numero) : undefined,
    blingSyncStatus: 'synced',
    customer: {
      name: bo.contato?.nome || 'Cliente Street Store',
      email: bo.contato?.email || '',
      phone: bo.contato?.celular || bo.contato?.telefone || '',
    },
    products: (bo.itens || []).map((it: any) => ({
      name: it.descricao || 'Peça Street Store',
      price: Number(it.valor || 0),
      quantity: Number(it.quantidade || 1),
      variant: it.codigo || '',
      image: '',
    })),
    total: Number(bo.total || 0),
    createdAt: bo.data || new Date().toISOString(),
    paidAt: bo.data || null,
    shippedAt: null,
  };
}

const PIX_EXPIRATION_MS = 15 * 60 * 1000;

function resolvePendingCreatedAtMs(p: Record<string, any>): number {
  if (typeof p.createdAt === 'number' && Number.isFinite(p.createdAt)) return p.createdAt;
  if (typeof p.createdAt === 'string') {
    const parsed = Date.parse(p.createdAt);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function resolvePendingExpiresAtMs(p: Record<string, any>): number {
  if (typeof p.expiresAtMs === 'number' && Number.isFinite(p.expiresAtMs) && p.expiresAtMs > 0) {
    return p.expiresAtMs;
  }
  if (p.expiresAt) {
    const parsed = Date.parse(String(p.expiresAt));
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  const createdMs = resolvePendingCreatedAtMs(p);
  return createdMs > 0 ? createdMs + PIX_EXPIRATION_MS : 0;
}

function isPendingPixExpired(p: Record<string, any>, nowMs: number = Date.now()): boolean {
  const status = String(p.status || '').toLowerCase();
  if (status === 'expired' || status === 'cancelled' || status === 'rejected' || status === 'voided') {
    return true;
  }
  const expiresAtMs = resolvePendingExpiresAtMs(p);
  return !expiresAtMs || expiresAtMs <= nowMs;
}

function isStoredOrderExpiredPendingPix(o: StoredOrder, nowMs: number = Date.now()): boolean {
  if (o.paymentStatus !== 'pending') return false;
  const isPix = Boolean(o.pendingPaymentId) || String(o.paymentMethod || '').toLowerCase().includes('pix');
  if (!isPix) return false;
  const expMs =
    typeof o.expiresAtMs === 'number' && o.expiresAtMs > 0
      ? o.expiresAtMs
      : o.expiresAt
        ? Date.parse(o.expiresAt)
        : Date.parse(o.createdAt) + PIX_EXPIRATION_MS;
  return !Number.isFinite(expMs) || expMs <= nowMs;
}

function mapPendingPaymentToStoredOrder(p: Record<string, any>, docId: string): StoredOrder {
  const idStr = String(p.id || docId);
  const createdMs = resolvePendingCreatedAtMs(p) || Date.now();
  const createdIso = Number.isFinite(createdMs) ? new Date(createdMs).toISOString() : new Date().toISOString();
  const expiresAtMs = resolvePendingExpiresAtMs(p) || createdMs + PIX_EXPIRATION_MS;
  const expiresAtIso = new Date(expiresAtMs).toISOString();
  const shortNumeric = idStr.replace(/\D/g, '').slice(-5) || '0';
  const resolvedPixCode = String(p.pixCopyPaste || p.qrCode || p.qr_code || '').trim();
  const resolvedQrBase64 = String(p.qrCodeBase64 || p.qr_code_base64 || '').trim();
  return {
    orderId: Number(shortNumeric) || 0,
    orderNumber: p.orderNumber || `PIX-${idStr.slice(-6).toUpperCase()}`,
    status: 'open',
    paymentStatus: p.status === 'approved' ? 'paid' : 'pending',
    shippingStatus: 'unshipped',
    shippingCarrier: p.shippingCarrier || 'Correios / Transportadora',
    trackingNumber: null,
    trackingUrl: null,
    paymentMethod: p.paymentMethod || 'Pix Instantâneo Mercado Pago',
    paymentId: idStr,
    pendingPaymentId: idStr,
    expiresAt: expiresAtIso,
    expiresAtMs,
    ...(resolvedPixCode ? { qrCode: resolvedPixCode, pixCopyPaste: resolvedPixCode } : {}),
    ...(resolvedQrBase64 ? { qrCodeBase64: resolvedQrBase64 } : {}),
    ...(p.pixKey ? { pixKey: String(p.pixKey) } : {}),
    ...(p.userId || p.payer?.uid ? { userId: String(p.userId || p.payer?.uid) } : {}),
    customer: {
      ...(p.userId || p.payer?.uid ? { uid: String(p.userId || p.payer?.uid) } : {}),
      name: String(p.payer?.name || 'Cliente Street Store'),
      email: String(p.payer?.email || ''),
      phone: String(p.payer?.phone || ''),
      ...(p.payer?.cpf ? { cpf: String(p.payer.cpf) } : {}),
    },
    shippingAddress: p.shippingAddress
      ? {
          name: p.shippingAddress.name || p.payer?.name || 'Cliente Street Store',
          address: p.shippingAddress.street || '',
          number: p.shippingAddress.number || 'S/N',
          locality: p.shippingAddress.neighborhood || 'Centro',
          city: p.shippingAddress.city || '',
          province: p.shippingAddress.state || '',
          zipcode: String(p.shippingAddress.zip || '').replace(/\D/g, ''),
          country: 'BR',
        }
      : undefined,
    products: Array.isArray(p.items)
      ? p.items.map((it: any) => ({
          name: String(it.name || 'Peça Street Store'),
          price: Number(it.price || 0),
          quantity: Number(it.quantity || 1),
          variant: it.selectedSize || 'Tamanho Único',
          ...(it.selectedColor ? { color: it.selectedColor } : {}),
          sku: it.sku,
          variantId: it.variantId,
          image: it.image || '',
        }))
      : [],
    total: Number(p.amount || 0),
    createdAt: createdIso,
    paidAt: p.dateApproved || null,
    shippedAt: null,
  };
}

function mergeOrderUnique(target: StoredOrder[], candidate: StoredOrder): void {
  const exists = target.some(
    (o) =>
      String(o.paymentId) === String(candidate.paymentId) ||
      (candidate.orderId > 0 && o.orderId === candidate.orderId && candidate.orderNumber === o.orderNumber) ||
      (candidate.pendingPaymentId &&
        (o.pendingPaymentId === candidate.pendingPaymentId || String(o.paymentId) === candidate.pendingPaymentId))
  );
  if (!exists) {
    target.push(candidate);
  }
}

export async function getCustomerOrders(identity: {
  uid?: string;
  email?: string;
  phone?: string;
  cpf?: string;
}): Promise<StoredOrder[]> {
  const nowMs = Date.now();
  const uid = (identity.uid || '').trim();
  const email = (identity.email || '').trim().toLowerCase();
  const phoneDigits = String(identity.phone || '').replace(/\D/g, '');
  const phoneTail = phoneDigits.length >= 8 ? phoneDigits.slice(-8) : '';
  const cpfDigits = String(identity.cpf || '').replace(/\D/g, '');

  const matchesCustomer = (o: {
    userId?: string;
    customer?: { uid?: string; email?: string; phone?: string; cpf?: string };
  }) => {
    if (uid && (o.userId === uid || o.customer?.uid === uid)) return true;
    if (email && email !== 'streetstore364@gmail.com' && (o.customer?.email || '').trim().toLowerCase() === email) {
      return true;
    }
    const oCpf = String(o.customer?.cpf || '').replace(/\D/g, '');
    if (cpfDigits.length === 11 && oCpf === cpfDigits) return true;
    const oPhone = String(o.customer?.phone || '').replace(/\D/g, '');
    if (phoneTail && oPhone.length >= 8 && oPhone.endsWith(phoneTail)) return true;
    return false;
  };

  const results: StoredOrder[] = [];
  const db = loadOrdersDb();
  for (const o of db.orders) {
    if (!isStoredOrderExpiredPendingPix(o, nowMs) && matchesCustomer(o)) {
      mergeOrderUnique(results, o);
    }
  }

  if (hasFirebaseAdminEnv()) {
    try {
      const fsDb = getAdminFirestore();
      const ordersSnap = await fsDb.collection('orders').orderBy('createdAt', 'desc').limit(150).get();
      ordersSnap.forEach((doc) => {
        const o = doc.data() as StoredOrder;
        if (!isStoredOrderExpiredPendingPix(o, nowMs) && matchesCustomer(o)) {
          mergeOrderUnique(results, o);
        }
      });

      const pendingSnap = await fsDb.collection('pending_payments').orderBy('createdAt', 'desc').limit(80).get();
      const expireWrites: Array<Promise<any>> = [];
      pendingSnap.forEach((doc) => {
        const p = doc.data() as Record<string, any>;
        if (p.status === 'approved' || p.movedToOrders === true) return;
        if (isPendingPixExpired(p, nowMs)) {
          if (String(p.status || '').toLowerCase() !== 'expired') {
            const expMs = resolvePendingExpiresAtMs(p);
            expireWrites.push(
              fsDb
                .collection('pending_payments')
                .doc(doc.id)
                .set(
                  {
                    status: 'expired',
                    statusDetail: 'expired_15m',
                    expiredAt: new Date(nowMs).toISOString(),
                    ...(expMs > 0 ? { expiresAtMs: expMs, expiresAt: new Date(expMs).toISOString() } : {}),
                  },
                  { merge: true }
                )
                .catch(() => {})
            );
          }
          return;
        }
        const fakeOrder = mapPendingPaymentToStoredOrder(p, doc.id);
        if (matchesCustomer(fakeOrder)) {
          mergeOrderUnique(results, fakeOrder);
        }
      });
      if (expireWrites.length > 0) {
        await Promise.allSettled(expireWrites);
      }
    } catch (err) {
      console.warn('[Customer Orders] Firestore lookup notice:', err);
    }
  }

  // Enrich tracking info from cached Bling orders without letting 429 fail the response
  const rawBlingOrders = await getCachedBlingSalesOrders();
  for (const bo of rawBlingOrders) {
    const numLojaStr = String(bo.numeroLoja || '').replace('#', '');
    const boEmail = String(bo.contato?.email || '').trim().toLowerCase();
    const matchedLocal = results.find(
      (r) => (r.blingOrderId && r.blingOrderId === bo.id) || (r.orderId > 0 && String(r.orderId) === numLojaStr)
    );
    if (matchedLocal) {
      const trackingCode = bo.transporte?.etiqueta?.codigoRastreamento;
      if (trackingCode && !matchedLocal.trackingNumber) {
        matchedLocal.trackingNumber = trackingCode;
        matchedLocal.trackingUrl = `https://melhorenvio.com.br/rastreio/${trackingCode}`;
        matchedLocal.shippingStatus = 'shipped';
      }
    } else if (email && email !== 'streetstore364@gmail.com' && boEmail === email) {
      mergeOrderUnique(results, mapBlingOrderToStoredOrder(bo));
    }
  }

  results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return results;
}

export async function trackStoreOrders(query: string): Promise<StoredOrder[]> {
  const nowMs = Date.now();
  const cleanQ = query.trim().replace(/^#/, '').toLowerCase();
  const cleanDigits = cleanQ.replace(/\D/g, '');
  const db = loadOrdersDb();

  const matchesOrder = (o: StoredOrder) => {
    const numMatch =
      o.orderNumber.replace('#', '').toLowerCase() === cleanQ ||
      (o.orderId > 0 && String(o.orderId) === cleanQ);
    const emailMatch =
      (o.customer?.email || '').toLowerCase() === cleanQ ||
      (cleanQ.length >= 4 && (o.customer?.email || '').toLowerCase().includes(cleanQ));
    const paymentMatch =
      String(o.paymentId).toLowerCase() === cleanQ ||
      (o.pendingPaymentId && o.pendingPaymentId.toLowerCase() === cleanQ) ||
      (o.endToEndId && o.endToEndId.toLowerCase() === cleanQ);
    const uidMatch = Boolean(o.userId && o.userId.toLowerCase() === cleanQ);
    const oCpf = String(o.customer?.cpf || '').replace(/\D/g, '');
    const cpfMatch = cleanDigits.length === 11 && oCpf === cleanDigits;
    const oPhone = String(o.customer?.phone || '').replace(/\D/g, '');
    const phoneMatch = cleanDigits.length >= 8 && oPhone.endsWith(cleanDigits.slice(-8));
    return numMatch || emailMatch || paymentMatch || uidMatch || cpfMatch || phoneMatch;
  };

  const results: StoredOrder[] = [];
  for (const o of db.orders) {
    if (!isStoredOrderExpiredPendingPix(o, nowMs) && matchesOrder(o)) {
      mergeOrderUnique(results, o);
    }
  }

  // Also check Firestore orders + pending_payments (serverless persistence)
  if (hasFirebaseAdminEnv()) {
    try {
      const fsDb = getAdminFirestore();
      const snap = await fsDb.collection('orders').orderBy('createdAt', 'desc').limit(150).get();
      snap.forEach((doc) => {
        const o = doc.data() as StoredOrder;
        if (!isStoredOrderExpiredPendingPix(o, nowMs) && matchesOrder(o)) {
          mergeOrderUnique(results, o);
        }
      });

      const pendingSnap = await fsDb.collection('pending_payments').orderBy('createdAt', 'desc').limit(80).get();
      const expireWrites: Array<Promise<any>> = [];
      pendingSnap.forEach((doc) => {
        const p = doc.data() as Record<string, any>;
        if (p.status === 'approved' || p.movedToOrders === true) return;
        if (isPendingPixExpired(p, nowMs)) {
          if (String(p.status || '').toLowerCase() !== 'expired') {
            const expMs = resolvePendingExpiresAtMs(p);
            expireWrites.push(
              fsDb
                .collection('pending_payments')
                .doc(doc.id)
                .set(
                  {
                    status: 'expired',
                    statusDetail: 'expired_15m',
                    expiredAt: new Date(nowMs).toISOString(),
                    ...(expMs > 0 ? { expiresAtMs: expMs, expiresAt: new Date(expMs).toISOString() } : {}),
                  },
                  { merge: true }
                )
                .catch(() => {})
            );
          }
          return;
        }
        const mapped = mapPendingPaymentToStoredOrder(p, doc.id);
        if (matchesOrder(mapped)) {
          mergeOrderUnique(results, mapped);
        }
      });
      if (expireWrites.length > 0) {
        await Promise.allSettled(expireWrites);
      }
    } catch (err) {
      console.warn('[Orders Track] Firestore lookup notice:', err);
    }
  }

  // Also check cached Bling ERP sales orders if connected (cached 45s to avoid Bling 429)
  const rawOrders = await getCachedBlingSalesOrders();
  for (const bo of rawOrders) {
    const numStr = String(bo.numero || '');
    const numLojaStr = String(bo.numeroLoja || '').replace('#', '');
    const idStr = String(bo.id || '');
    const contactName = (bo.contato?.nome || '').toLowerCase();
    const contactEmail = (bo.contato?.email || '').toLowerCase();

    const isMatch =
      numStr === cleanQ ||
      numLojaStr === cleanQ ||
      idStr === cleanQ ||
      (cleanQ.length >= 4 && (contactName.includes(cleanQ) || contactEmail.includes(cleanQ)));

    if (
      isMatch &&
      !results.some((lm) => lm.blingOrderId === bo.id || (lm.orderId > 0 && String(lm.orderId) === numLojaStr))
    ) {
      mergeOrderUnique(results, mapBlingOrderToStoredOrder(bo));
    }
  }

  results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return results;
}

export function requestStoreOrderReturn(params: {
  orderId: number | string;
  orderNumber: string;
  customerEmail: string;
  customerName?: string;
  customerPhone?: string;
  reason: string;
  actionRequested: string;
  selectedItems: string[];
  details: string;
}): { success: boolean; protocol: string; message: string } {
  const protocol = `DEV-${String(params.orderNumber || params.orderId).replace(/\D/g, '').slice(-4) || 'ST'}-${Math.floor(1000 + Math.random() * 9000)}`;

  const db = loadOrdersDb();
  const order = db.orders.find(
    (o) => String(o.orderId) === String(params.orderId) || o.orderNumber === params.orderNumber
  );

  const reqEntry = {
    protocol,
    reason: params.reason,
    actionRequested: params.actionRequested,
    selectedItems: params.selectedItems,
    details: params.details,
    createdAt: new Date().toISOString(),
  };

  if (order) {
    if (!Array.isArray(order.returnRequests)) order.returnRequests = [];
    order.returnRequests.push(reqEntry);
    saveOrdersDb(db);
    saveOrderToFirestore(order).catch(() => {});
  }

  return {
    success: true,
    protocol,
    message: 'Solicitação de devolução registrada com sucesso pela equipe Street Store.',
  };
}
