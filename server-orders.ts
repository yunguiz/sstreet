import fs from 'fs';
import path from 'path';
import { fetchFromBling, ensureBlingAuthorized } from './server-bling.js';
import { addOrderToMelhorEnvioCart } from './server-melhor-envio.js';
import { hasFirebaseAdminEnv } from './lib/blingToken.js';
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
  blingOrderId?: number;
  blingOrderNumber?: number;
  melhorEnvioCartId?: string;
  customer: {
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
    sku?: string;
    variantId?: number;
    image?: string;
  }>;
  total: number;
  createdAt: string;
  paidAt?: string | null;
  shippedAt?: string | null;
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

async function findExistingOrderByPaymentId(paymentId: string | number): Promise<StoredOrder | null> {
  const pidStr = String(paymentId);
  const localDb = loadOrdersDb();
  const localMatch = localDb.orders.find((o) => String(o.paymentId) === pidStr);
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
    } catch (err) {
      console.warn('[Orders Store] Erro ao buscar pedido existente no Firestore:', err);
    }
  }

  return null;
}

async function saveOrderToFirestore(order: StoredOrder): Promise<void> {
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

async function getBlingPaymentMethodId(paymentMethodLabel: string): Promise<number | null> {
  try {
    const now = Date.now();
    if (!cachedBlingPaymentMethods || now - cachedBlingPaymentMethods.fetchedAt > 10 * 60 * 1000) {
      const res = await fetchFromBling('/formas-pagamentos?limite=50');
      cachedBlingPaymentMethods = {
        items: Array.isArray(res?.data) ? res.data : [],
        fetchedAt: now,
      };
    }

    const methods = cachedBlingPaymentMethods.items;
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
    console.warn('[Bling Contact] Falha ao criar contato específico no Bling, tentando Consumidor Final:', createErr?.message || createErr);
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

async function resolveBlingProductIdBySku(sku?: string): Promise<number | null> {
  if (!sku || sku.startsWith('ST-')) return null;
  try {
    const res = await fetchFromBling(`/produtos?codigos[]=${encodeURIComponent(sku)}&limite=5`);
    const found = Array.isArray(res?.data) ? res.data.find((p: any) => String(p.codigo || '').trim() === sku.trim()) || res.data[0] : null;
    if (found?.id) return Number(found.id);
  } catch {
    // optional lookup
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
}): Promise<{ blingOrderId?: number; blingOrderNumber?: number }> {
  if (!(await ensureBlingAuthorized({ verifyLive: true }))) {
    console.warn('[Bling Order] Bling OAuth não autorizado no momento; pedido não pôde ser enviado ao Bling.');
    return {};
  }

  const todayDate = params.nowIso.slice(0, 10);
  const contactId = await resolveOrCreateBlingContact({
    customer: params.customer,
    shippingAddress: params.shippingAddress,
  });

  if (!contactId) {
    console.error('[Bling Order] Não foi possível resolver contato.id no Bling. Pedido abortado no Bling.');
    return {};
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
    console.error('[Orders Store] Falha no envio completo ao Bling ERP:', blingErr?.message || blingErr);

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
      console.error('[Orders Store] Fallback no Bling ERP também falhou:', retryErr?.message || retryErr);
    }
  }

  return {};
}

export async function createStoreOrder(params: {
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
    phone?: string;
  };
  shippingServiceId?: number;
  shippingCarrier?: string;
  paymentMethod: string;
  paymentId: string | number;
  total: number;
}): Promise<{
  success: boolean;
  id: number;
  number: string;
  blingOrderId?: number;
  blingOrderNumber?: number;
  melhorEnvioCartId?: string;
  alreadyExisted?: boolean;
}> {
  const existing = await findExistingOrderByPaymentId(params.paymentId);
  if (existing) {
    // If previous save missed Bling sync, retry Bling sync idempotently
    if (!existing.blingOrderId) {
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
      if (blingSync.blingOrderId) {
        existing.blingOrderId = blingSync.blingOrderId;
        existing.blingOrderNumber = blingSync.blingOrderNumber;
        const db = loadOrdersDb();
        const idx = db.orders.findIndex((o) => String(o.paymentId) === String(existing.paymentId));
        if (idx >= 0) db.orders[idx] = existing;
        else db.orders.unshift(existing);
        saveOrdersDb(db);
        await saveOrderToFirestore(existing);
      }
    }

    return {
      success: true,
      id: existing.orderId,
      number: existing.orderNumber,
      blingOrderId: existing.blingOrderId,
      blingOrderNumber: existing.blingOrderNumber,
      melhorEnvioCartId: existing.melhorEnvioCartId,
      alreadyExisted: true,
    };
  }

  const orderId = await getNextOrderSequence();
  const orderNumber = `#${orderId}`;
  const nowIso = new Date().toISOString();

  const newOrder: StoredOrder = {
    orderId,
    orderNumber,
    status: 'open',
    paymentStatus: 'paid',
    shippingStatus: 'unshipped',
    shippingCarrier: params.shippingCarrier || 'Melhor Envio (Correios / Jadlog)',
    trackingNumber: null,
    trackingUrl: null,
    paymentMethod: params.paymentMethod,
    paymentId: String(params.paymentId),
    customer: {
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
      sku: it.sku,
      variantId: it.variantId,
      image: it.image || '',
    })),
    total: Number(params.total || 0),
    createdAt: nowIso,
    paidAt: nowIso,
    shippedAt: null,
  };

  // Sync order to Bling ERP
  try {
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
    }
  } catch (blingErr: any) {
    console.error('[Orders Store] Erro ao sincronizar pedido no Bling ERP:', blingErr?.message || blingErr);
  }

  // Register shipment in Melhor Envio Cart if connected & address provided
  let melhorEnvioCartId: string | undefined;
  if (params.shippingAddress?.zip && params.shippingAddress?.street) {
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
        console.log(`[Orders Store] Etiqueta adicionada ao carrinho Melhor Envio: ${meCart.cartId}`);
      }
    } catch (meErr: any) {
      console.warn('[Orders Store] Registro opcional no Melhor Envio ignorado:', meErr?.message || meErr);
    }
  }

  const db = loadOrdersDb();
  db.lastOrderSequence = Math.max(db.lastOrderSequence, orderId);
  db.orders.unshift(newOrder);
  saveOrdersDb(db);
  await saveOrderToFirestore(newOrder);

  console.log(`[Orders Store] Pedido oficial ${orderNumber} registrado com sucesso.`);

  return {
    success: true,
    id: orderId,
    number: orderNumber,
    blingOrderId: newOrder.blingOrderId,
    blingOrderNumber: newOrder.blingOrderNumber,
    melhorEnvioCartId,
  };
}

export async function trackStoreOrders(query: string): Promise<StoredOrder[]> {
  const cleanQ = query.trim().replace(/^#/, '').toLowerCase();
  const db = loadOrdersDb();

  const matchesOrder = (o: StoredOrder) => {
    const numMatch = o.orderNumber.replace('#', '').toLowerCase() === cleanQ || String(o.orderId) === cleanQ;
    const emailMatch =
      (o.customer?.email || '').toLowerCase() === cleanQ ||
      (cleanQ.length >= 4 && (o.customer?.email || '').toLowerCase().includes(cleanQ));
    const paymentMatch = String(o.paymentId).toLowerCase() === cleanQ;
    return numMatch || emailMatch || paymentMatch;
  };

  const localMatches = db.orders.filter(matchesOrder);

  // Also check Firestore orders collection (serverless persistence)
  const firestoreMatches: StoredOrder[] = [];
  if (hasFirebaseAdminEnv()) {
    try {
      const fsDb = getAdminFirestore();
      const snap = await fsDb.collection('orders').orderBy('createdAt', 'desc').limit(100).get();
      snap.forEach((doc) => {
        const o = doc.data() as StoredOrder;
        if (
          matchesOrder(o) &&
          !localMatches.some((lm) => String(lm.paymentId) === String(o.paymentId) || lm.orderId === o.orderId)
        ) {
          firestoreMatches.push(o);
        }
      });
    } catch (err) {
      console.warn('[Orders Track] Firestore lookup notice:', err);
    }
  }

  const combinedLocal = [...localMatches, ...firestoreMatches];

  // Also check Bling ERP sales orders if connected
  const blingMatches: StoredOrder[] = [];
  try {
    if (await ensureBlingAuthorized()) {
      const blingData = await fetchFromBling('/pedidos/vendas?pagina=1&limite=50');
      const rawOrders = blingData?.data || [];
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

        if (isMatch && !combinedLocal.some((lm) => lm.blingOrderId === bo.id || String(lm.orderId) === numLojaStr)) {
          blingMatches.push({
            orderId: bo.id,
            orderNumber: `#${bo.numero || bo.id}`,
            status: 'open',
            paymentStatus: 'paid',
            shippingStatus: bo.transporte?.etiqueta ? 'shipped' : 'unshipped',
            shippingCarrier: bo.transporte?.transportador?.nome || 'Melhor Envio',
            trackingNumber: bo.transporte?.etiqueta?.codigoRastreamento || null,
            trackingUrl: bo.transporte?.etiqueta?.codigoRastreamento
              ? `https://melhorenvio.com.br/rastreio/${bo.transporte.etiqueta.codigoRastreamento}`
              : null,
            paymentMethod: 'Mercado Pago / Bling ERP',
            paymentId: String(bo.id),
            blingOrderId: bo.id,
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
          });
        }
      }
    }
  } catch (err: any) {
    console.warn('[Orders Track] Bling lookup notice:', err?.message || err);
  }

  return [...combinedLocal, ...blingMatches];
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
    message: 'Solicitação de devolução registrada com sucesso e vinculada à logística reversa Melhor Envio.',
  };
}
