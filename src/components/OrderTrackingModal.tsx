import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  Search,
  Truck,
  CheckCircle2,
  Package,
  Clock,
  ExternalLink,
  Copy,
  Check,
  RotateCcw,
  AlertCircle,
  HelpCircle,
  MessageSquare,
  ShieldCheck,
  ChevronRight,
  Loader2,
  QrCode
} from 'lucide-react';
import { TrackedOrder, trackOrder, getMyOrders, requestOrderReturn } from '../services/catalog';
import { CustomerProfile } from '../services/auth';
import { confirmPixPayment, getPaymentStatus } from '../services/mercadopago';

interface OrderTrackingModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialQuery?: string;
  currentUser?: CustomerProfile | null;
}

const PIX_WINDOW_MS = 15 * 60 * 1000;

function getOrderPixExpiresAtMs(order: TrackedOrder): number {
  if (typeof order.expiresAtMs === 'number' && Number.isFinite(order.expiresAtMs) && order.expiresAtMs > 0) {
    return order.expiresAtMs;
  }
  if (order.expiresAt) {
    const parsed = Date.parse(order.expiresAt);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  const createdMs = Date.parse(order.createdAt);
  return Number.isFinite(createdMs) ? createdMs + PIX_WINDOW_MS : 0;
}

function isOrderUnpaidPix(order: TrackedOrder): boolean {
  return (
    order.paymentStatus === 'pending' &&
    (Boolean(order.pendingPaymentId) || String(order.paymentMethod || '').toLowerCase().includes('pix'))
  );
}

function isOrderActiveForDisplay(order: TrackedOrder, nowMs: number): boolean {
  if (order.paymentStatus !== 'pending' || !isOrderUnpaidPix(order)) {
    return true;
  }
  return getOrderPixExpiresAtMs(order) > nowMs;
}

function formatRemainingMmSs(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatCustomerCarrier(carrier?: string): string {
  const raw = String(carrier || '').trim();
  if (!raw) return 'Correios / Transportadora';
  const cleaned = raw
    .replace(/melhor envio\s*\(([^)]+)\)/gi, '$1')
    .replace(/melhor envio/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return cleaned || 'Correios / Transportadora';
}

export function OrderTrackingModal({
  isOpen,
  onClose,
  initialQuery = '',
  currentUser = null
}: OrderTrackingModalProps) {
  const [query, setQuery] = useState(initialQuery);
  const [isLoading, setIsLoading] = useState(false);
  const [orders, setOrders] = useState<TrackedOrder[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [showingAccountOrders, setShowingAccountOrders] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copiedTracking, setCopiedTracking] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [copiedPixCodeFor, setCopiedPixCodeFor] = useState<string | null>(null);
  const [copiedPixKeyFor, setCopiedPixKeyFor] = useState<string | null>(null);
  const [verifyingPixId, setVerifyingPixId] = useState<string | null>(null);
  const [pixFeedbackMap, setPixFeedbackMap] = useState<Record<string, { type: 'info' | 'success' | 'error'; text: string }>>({});
  const expiredSyncedIdsRef = React.useRef<Set<string>>(new Set());

  // Return / Exchange modal state
  const [selectedOrderForReturn, setSelectedOrderForReturn] = useState<TrackedOrder | null>(null);
  const [returnReason, setReturnReason] = useState('tamanho_incorreto');
  const [returnAction, setReturnAction] = useState('troca_tamanho');
  const [returnSelectedItems, setReturnSelectedItems] = useState<string[]>([]);
  const [returnDetails, setReturnDetails] = useState('');
  const [isSubmittingReturn, setIsSubmittingReturn] = useState(false);
  const [returnProtocol, setReturnProtocol] = useState<string | null>(null);
  const [returnError, setReturnError] = useState<string | null>(null);

  const loadMyOrders = async () => {
    if (!currentUser) return;
    setIsLoading(true);
    setErrorMessage(null);
    setHasSearched(true);
    setShowingAccountOrders(true);
    setSelectedOrderForReturn(null);
    setReturnProtocol(null);

    try {
      const res = await getMyOrders();
      if (res.success && Array.isArray(res.orders)) {
        const now = Date.now();
        setNowMs(now);
        setOrders(res.orders.filter((o) => isOrderActiveForDisplay(o, now)));
      } else {
        setOrders([]);
        if (res.error) setErrorMessage(res.error);
      }
    } catch {
      setOrders([]);
      setErrorMessage('Erro ao carregar os pedidos da sua conta. Tente novamente em instantes.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    if (initialQuery) {
      setQuery(initialQuery);
      handleSearch(initialQuery);
    } else if (currentUser) {
      setQuery('');
      void loadMyOrders();
    } else {
      setShowingAccountOrders(false);
    }
  }, [initialQuery, isOpen, currentUser?.uid]);

  useEffect(() => {
    if (!isOpen || !currentUser) return;
    const handleOrdersUpdated = () => {
      void loadMyOrders();
    };
    window.addEventListener('streetstore:orders-updated', handleOrdersUpdated);
    return () => window.removeEventListener('streetstore:orders-updated', handleOrdersUpdated);
  }, [isOpen, currentUser?.uid]);

  useEffect(() => {
    if (!isOpen) return;
    setNowMs(Date.now());
    if (!orders.some(isOrderUnpaidPix)) return;
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [isOpen, orders]);

  useEffect(() => {
    if (!isOpen) return;
    const newlyExpired = orders.filter(
      (o) => isOrderUnpaidPix(o) && getOrderPixExpiresAtMs(o) <= nowMs
    );
    if (newlyExpired.length === 0) return;

    let removedAny = false;
    for (const ord of newlyExpired) {
      const payKey = String(ord.pendingPaymentId || ord.paymentId || ord.orderId);
      if (!expiredSyncedIdsRef.current.has(payKey)) {
        expiredSyncedIdsRef.current.add(payKey);
        removedAny = true;
        const targetId = ord.pendingPaymentId || ord.paymentId;
        if (targetId) {
          void getPaymentStatus(targetId).catch(() => {});
        }
      }
    }
    if (removedAny) {
      setOrders((prev) => prev.filter((o) => isOrderActiveForDisplay(o, nowMs)));
    }
  }, [isOpen, nowMs, orders]);

  const handleSearch = async (searchQuery?: string) => {
    const q = (searchQuery ?? query).trim();
    if (!q) {
      if (currentUser) {
        await loadMyOrders();
        return;
      }
      setErrorMessage('Digite o número do pedido, e-mail ou CPF cadastrado na compra.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setHasSearched(true);
    setShowingAccountOrders(false);
    setSelectedOrderForReturn(null);
    setReturnProtocol(null);

    try {
      const res = await trackOrder(q);
      const now = Date.now();
      setNowMs(now);
      const activeOrders =
        res.success && Array.isArray(res.orders)
          ? res.orders.filter((o) => isOrderActiveForDisplay(o, now))
          : [];
      if (activeOrders.length > 0) {
        setOrders(activeOrders);
      } else {
        setOrders([]);
        setErrorMessage(
          'Nenhum pedido encontrado com esses dados. Verifique o número do pedido (ex: #1001), e-mail ou CPF usado na compra.'
        );
      }
    } catch {
      setOrders([]);
      setErrorMessage('Erro de conexão com o sistema de rastreamento. Tente novamente em instantes.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyOrderPixCode = (orderKey: string, code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedPixCodeFor(orderKey);
    setTimeout(() => setCopiedPixCodeFor(null), 2500);
  };

  const handleCopyOrderPixKey = (orderKey: string, keyText: string) => {
    navigator.clipboard.writeText(keyText);
    setCopiedPixKeyFor(orderKey);
    setTimeout(() => setCopiedPixKeyFor(null), 2500);
  };

  const handleCheckOrderPixPayment = async (order: TrackedOrder) => {
    const payId = order.pendingPaymentId || order.paymentId;
    if (!payId) return;
    const key = String(payId);
    setVerifyingPixId(key);
    setPixFeedbackMap((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });

    try {
      const res = await confirmPixPayment(payId);
      if (res.approved === true && res.status === 'approved') {
        setPixFeedbackMap((prev) => ({
          ...prev,
          [key]: {
            type: 'success',
            text: res.orderNumber
              ? `Pagamento Pix aprovado! Pedido ${res.orderNumber} confirmado.`
              : 'Pagamento Pix identificado e aprovado com sucesso!'
          }
        }));
        window.dispatchEvent(new CustomEvent('streetstore:raffle-updated'));
        window.dispatchEvent(new CustomEvent('streetstore:orders-updated'));
        if (showingAccountOrders && currentUser) {
          await loadMyOrders();
        } else if (query.trim()) {
          await handleSearch(query);
        }
      } else if (res.expired || res.status === 'expired') {
        setOrders((prev) =>
          prev.filter((o) => String(o.pendingPaymentId || o.paymentId || o.orderId) !== key)
        );
      } else {
        setPixFeedbackMap((prev) => ({
          ...prev,
          [key]: {
            type: 'info',
            text:
              res.message ||
              'Pagamento ainda não compensado pelo banco. Finalize a transferência Pix no app do seu banco e clique novamente.'
          }
        }));
      }
    } catch {
      setPixFeedbackMap((prev) => ({
        ...prev,
        [key]: {
          type: 'error',
          text: 'Erro ao consultar a compensação do Pix. Tente novamente em instantes.'
        }
      }));
    } finally {
      setVerifyingPixId(null);
    }
  };

  const visibleOrders = orders.filter((order) => isOrderActiveForDisplay(order, nowMs));

  const handleCopyTracking = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedTracking(code);
    setTimeout(() => setCopiedTracking(null), 2500);
  };

  const handleOpenReturnModal = (order: TrackedOrder) => {
    setSelectedOrderForReturn(order);
    setReturnSelectedItems(order.products.map((p) => p.name));
    setReturnProtocol(null);
    setReturnError(null);
  };

  const handleSubmitReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrderForReturn) return;

    if (returnSelectedItems.length === 0) {
      setReturnError('Selecione pelo menos uma peça para devolução ou troca.');
      return;
    }

    setIsSubmittingReturn(true);
    setReturnError(null);

    const reasonLabels: Record<string, string> = {
      tamanho_incorreto: 'Tamanho não serviu (Ficou pequeno / grande)',
      arrependimento: 'Direito de Arrependimento (CDC Art. 49 - até 7 dias)',
      defeito: 'Peça com defeito de fabricação ou costura',
      produto_divergente: 'Recebi um produto diferente do pedido',
      outro: 'Outro motivo'
    };

    const actionLabels: Record<string, string> = {
      troca_tamanho: 'Troca por outro tamanho da mesma peça',
      vale_compras: 'Crédito / Vale-compras para outro drop',
      estorno: 'Reembolso / Estorno integral no mesmo método de pagamento'
    };

    try {
      const res = await requestOrderReturn({
        orderId: selectedOrderForReturn.orderId,
        orderNumber: selectedOrderForReturn.orderNumber,
        customerEmail: selectedOrderForReturn.customer?.email || '',
        customerName: selectedOrderForReturn.customer?.name,
        customerPhone: selectedOrderForReturn.customer?.phone,
        reason: reasonLabels[returnReason] || returnReason,
        actionRequested: actionLabels[returnAction] || returnAction,
        selectedItems: returnSelectedItems,
        details: returnDetails
      });

      if (res.success && res.protocol) {
        setReturnProtocol(res.protocol);
      } else {
        setReturnError(res.error || 'Erro ao registrar solicitação de devolução.');
      }
    } catch (err: any) {
      setReturnError(err.message || 'Erro ao comunicar com o servidor.');
    } finally {
      setIsSubmittingReturn(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/90 backdrop-blur-md flex items-center justify-center p-3 sm:p-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ duration: 0.2 }}
        className="relative w-full max-w-2xl bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden"
      >
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-zinc-800/90 flex items-center justify-between bg-zinc-900/60 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-red-600/10 border border-red-500/20 text-[#E50914]">
              <Truck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-black text-white uppercase tracking-wider font-oswald">
                {currentUser ? 'Meus Pedidos & Rastreio' : 'Acompanhar Pedido'}
              </h2>
              <p className="text-[11px] text-zinc-400">
                {currentUser
                  ? `Conta conectada: ${currentUser.email}`
                  : 'Consulte o status em tempo real, código de rastreio e logística reversa'}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label="Fechar rastreamento"
            className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-5 flex-1">
          {/* Search Box */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSearch();
            }}
            className="flex flex-col sm:flex-row gap-2"
          >
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Número do Pedido (ex: #1001), E-mail ou CPF..."
                className="w-full pl-10 pr-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-[#E50914] focus:ring-1 focus:ring-[#E50914] transition-all"
              />
            </div>
            <button
              type="submit"
              disabled={isLoading}
              className="px-5 py-3 bg-[#E50914] hover:bg-[#c90812] disabled:opacity-50 text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all cursor-pointer shadow-md shadow-red-950/40 flex items-center justify-center gap-2 shrink-0 active:scale-95"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Buscando...</span>
                </>
              ) : (
                <>
                  <Search className="w-4 h-4" />
                  <span>Rastrear</span>
                </>
              )}
            </button>
            {currentUser && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  void loadMyOrders();
                }}
                disabled={isLoading}
                className="px-4 py-3 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-200 font-bold text-xs uppercase tracking-wider rounded-xl transition-colors cursor-pointer shrink-0"
              >
                Meus Pedidos
              </button>
            )}
          </form>

          {/* Feedback messages */}
          {errorMessage && (
            <div className="p-3 bg-red-950/40 border border-red-500/30 rounded-xl flex items-start gap-2.5 text-xs text-red-200">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Friendly Empty State for Logged-in Customer */}
          {hasSearched && showingAccountOrders && !isLoading && visibleOrders.length === 0 && !errorMessage && (
            <div className="p-6 bg-zinc-900/40 border border-zinc-800/80 rounded-2xl text-center space-y-2.5">
              <Package className="w-10 h-10 text-zinc-600 mx-auto" />
              <p className="text-sm font-bold text-white">Nenhum pedido encontrado nesta conta ainda</p>
              <p className="text-xs text-zinc-400 max-w-md mx-auto leading-relaxed">
                Se você finalizou um pedido usando outro e-mail ou CPF, digite o número do pedido (ex: <strong>#1001</strong>) ou o CPF no campo acima para consultar.
              </p>
            </div>
          )}

          {/* If No search conducted yet */}
          {!hasSearched && visibleOrders.length === 0 && (
            <div className="p-6 bg-zinc-900/40 border border-zinc-800/80 rounded-2xl text-center space-y-3">
              <Package className="w-10 h-10 text-zinc-600 mx-auto" />
              <div>
                <p className="text-sm font-bold text-white">Como rastrear seu pedido?</p>
                <p className="text-xs text-zinc-400 mt-1 max-w-md mx-auto leading-relaxed">
                  Digite o número do pedido recebido por e-mail (ex: <strong>#1001</strong>), o seu e-mail ou o CPF usado na compra para ver o andamento e a etiqueta da transportadora.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-3 text-left">
                <div className="p-2.5 bg-zinc-950 border border-zinc-800 rounded-lg">
                  <span className="text-[10px] text-zinc-500 font-bold uppercase block">1. E-mail</span>
                  <p className="text-xs text-zinc-300 mt-0.5">Notificação enviada a cada movimentação</p>
                </div>
                <div className="p-2.5 bg-zinc-950 border border-zinc-800 rounded-lg">
                  <span className="text-[10px] text-zinc-500 font-bold uppercase block">2. Envio Nacional</span>
                  <p className="text-xs text-zinc-300 mt-0.5">Correios, Jadlog ou Loggi</p>
                </div>
                <div className="p-2.5 bg-zinc-950 border border-zinc-800 rounded-lg">
                  <span className="text-[10px] text-zinc-500 font-bold uppercase block">3. Devoluções</span>
                  <p className="text-xs text-zinc-300 mt-0.5">Logística reversa grátis em até 7 dias</p>
                </div>
              </div>
            </div>
          )}

          {/* RETURN FORM MODAL OVERLAY (Within this modal) */}
          <AnimatePresence>
            {selectedOrderForReturn && (
              <motion.div
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 15 }}
                className="p-5 bg-zinc-900 border border-zinc-700/80 rounded-2xl space-y-4 relative"
              >
                <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
                  <div className="flex items-center gap-2">
                    <RotateCcw className="w-4 h-4 text-[#E50914]" />
                    <h3 className="text-sm font-black text-white uppercase tracking-wider font-oswald">
                      Solicitar Troca ou Devolução // Pedido {selectedOrderForReturn.orderNumber}
                    </h3>
                  </div>
                  <button
                    onClick={() => setSelectedOrderForReturn(null)}
                    className="text-xs text-zinc-400 hover:text-white"
                  >
                    Fechar
                  </button>
                </div>

                {returnProtocol ? (
                  <div className="py-4 text-center space-y-3">
                    <div className="w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center justify-center mx-auto">
                      <Check className="w-6 h-6" />
                    </div>
                    <div>
                      <h4 className="text-base font-bold text-white uppercase font-oswald">
                        Solicitação Registrada com Sucesso!
                      </h4>
                      <p className="text-xs text-zinc-400 mt-1">
                        Sua solicitação foi vinculada ao seu pedido oficial e despachada para a equipe de Logística Reversa da Street Store.
                      </p>
                    </div>

                    <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-xl inline-block text-center">
                      <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider block">
                        Número de Protocolo:
                      </span>
                      <span className="text-base font-black text-white font-mono text-emerald-400">
                        {returnProtocol}
                      </span>
                    </div>

                    <p className="text-[11px] text-zinc-400">
                      Você receberá em até 24 horas úteis no e-mail <strong>{selectedOrderForReturn.customer?.email}</strong> a etiqueta pré-paga dos Correios / Jadlog para postagem reversa sem qualquer custo.
                    </p>

                    <div className="pt-2 flex flex-col sm:flex-row gap-2 justify-center">
                      <a
                        href={`https://wa.me/5531984806556?text=${encodeURIComponent(
                          `Olá Street Store! Gostaria de falar sobre minha solicitação de devolução do Pedido ${selectedOrderForReturn.orderNumber} (Protocolo: ${returnProtocol}).`
                        )}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs uppercase tracking-wider rounded-xl inline-flex items-center justify-center gap-1.5 transition-all shadow-md shadow-emerald-950/40"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        <span>Avisar no WhatsApp</span>
                      </a>
                      <button
                        onClick={() => setSelectedOrderForReturn(null)}
                        className="px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-colors"
                      >
                        Concluir
                      </button>
                    </div>
                  </div>
                ) : (
                  <form onSubmit={handleSubmitReturn} className="space-y-3.5 text-xs">
                    {returnError && (
                      <div className="p-2.5 bg-red-950/50 border border-red-500/40 text-red-200 rounded-lg">
                        {returnError}
                      </div>
                    )}

                    {/* What do you want to do */}
                    <div>
                      <label className="block text-zinc-300 font-bold mb-1.5">
                        O que você deseja fazer?
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        {[
                          { id: 'troca_tamanho', label: 'Trocar Tamanho' },
                          { id: 'vale_compras', label: 'Vale-Compras' },
                          { id: 'estorno', label: 'Estorno / Devolução' }
                        ].map((opt) => (
                          <button
                            type="button"
                            key={opt.id}
                            onClick={() => setReturnAction(opt.id)}
                            className={`p-2.5 rounded-lg border text-left font-bold transition-all ${
                              returnAction === opt.id
                                ? 'bg-red-600/15 border-red-500 text-white'
                                : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-white'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Motivo */}
                    <div>
                      <label className="block text-zinc-300 font-bold mb-1.5">
                        Motivo da solicitação:
                      </label>
                      <select
                        value={returnReason}
                        onChange={(e) => setReturnReason(e.target.value)}
                        className="w-full px-3 py-2.5 bg-zinc-950 border border-zinc-800 rounded-lg text-white focus:outline-none focus:border-[#E50914]"
                      >
                        <option value="tamanho_incorreto">Tamanho não serviu (Ficou pequeno ou grande)</option>
                        <option value="arrependimento">Arrependimento / Desistência (Art. 49 CDC - até 7 dias)</option>
                        <option value="defeito">Peça com defeito de fábrica / costura / estampa</option>
                        <option value="produto_divergente">Recebi item diferente do solicitado</option>
                        <option value="outro">Outro motivo</option>
                      </select>
                    </div>

                    {/* Peças a devolver */}
                    <div>
                      <label className="block text-zinc-300 font-bold mb-1.5">
                        Selecione as peças deste pedido a serem trocadas/devolvidas:
                      </label>
                      <div className="space-y-1.5">
                        {selectedOrderForReturn.products.map((p, idx) => {
                          const isChecked = returnSelectedItems.includes(p.name);
                          return (
                            <label
                              key={idx}
                              className="flex items-center gap-2 p-2 bg-zinc-950 border border-zinc-800 rounded-lg cursor-pointer hover:border-zinc-700"
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setReturnSelectedItems([...returnSelectedItems, p.name]);
                                  } else {
                                    setReturnSelectedItems(returnSelectedItems.filter((i) => i !== p.name));
                                  }
                                }}
                                className="accent-[#E50914] w-3.5 h-3.5"
                              />
                              <span className="text-zinc-200">
                                {p.quantity}x {p.name} {p.variant ? `(${p.variant})` : ''} - R$ {p.price.toFixed(2).replace('.', ',')}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    {/* Observações */}
                    <div>
                      <label className="block text-zinc-300 font-bold mb-1.5">
                        Detalhes adicionais (ex: tamanho desejado para troca):
                      </label>
                      <textarea
                        rows={2}
                        value={returnDetails}
                        onChange={(e) => setReturnDetails(e.target.value)}
                        placeholder="Ex: Gostaria de trocar a camiseta preta tamanho M pelo tamanho G..."
                        className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-[#E50914]"
                      />
                    </div>

                    <div className="pt-2 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedOrderForReturn(null)}
                        className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg font-bold"
                      >
                        Cancelar
                      </button>
                      <button
                        type="submit"
                        disabled={isSubmittingReturn}
                        className="px-5 py-2 bg-[#E50914] hover:bg-[#c90812] text-white font-bold rounded-lg uppercase tracking-wider flex items-center gap-1.5"
                      >
                        {isSubmittingReturn ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>Enviando...</span>
                          </>
                        ) : (
                          <span>Confirmar Solicitação</span>
                        )}
                      </button>
                    </div>
                  </form>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* LIST OF ORDERS */}
          {visibleOrders.map((order) => {
            const isDelivered = order.shippingStatus === 'delivered';
            const isShipped = order.shippingStatus === 'shipped' || Boolean(order.trackingNumber);
            const isPaid = order.paymentStatus === 'paid';
            const isPendingPix = !isPaid && isOrderUnpaidPix(order);
            const remainingMs = isPendingPix ? Math.max(0, getOrderPixExpiresAtMs(order) - nowMs) : 0;
            const isLowTime = remainingMs <= 3 * 60 * 1000;
            const payKey = String(order.pendingPaymentId || order.paymentId || order.orderId);
            const pixFeedback = pixFeedbackMap[payKey];

            return (
              <div
                key={`${order.orderId}-${order.orderNumber}-${payKey}`}
                className="p-4 sm:p-5 bg-zinc-900/80 border border-zinc-800 rounded-2xl space-y-4 shadow-lg"
              >
                {/* Order Top Bar */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-zinc-800">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-black text-white font-oswald uppercase">
                        Pedido {order.orderNumber}
                      </span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          isPaid
                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                            : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                        }`}
                      >
                        {isPaid ? 'Pagamento Aprovado' : 'Aguardando Pagamento'}
                      </span>
                      {isPendingPix && (
                        <span
                          className={`text-[10px] font-black font-mono px-2 py-0.5 rounded-full border flex items-center gap-1 tabular-nums ${
                            isLowTime
                              ? 'bg-red-500/15 text-red-400 border-red-500/40 animate-pulse'
                              : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                          }`}
                        >
                          <Clock className="w-3 h-3" />
                          <span>Expira em {formatRemainingMmSs(remainingMs)}</span>
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] text-zinc-400">
                      Realizado em {new Date(order.createdAt).toLocaleDateString('pt-BR', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric'
                      })}
                      {order.paymentMethod ? ` • ${order.paymentMethod}` : ''}
                    </span>
                  </div>

                  <div className="text-right">
                    <span className="text-[10px] text-zinc-500 uppercase block font-bold">Total do Pedido</span>
                    <span className="text-sm font-black text-white font-oswald">
                      R$ {order.total.toFixed(2).replace('.', ',')}
                    </span>
                  </div>
                </div>

                {/* Tracking Stepper */}
                <div className="py-2">
                  <div className="relative flex items-center justify-between max-w-md mx-auto">
                    {/* Background line */}
                    <div className="absolute left-3 right-3 top-1/2 -translate-y-1/2 h-0.5 bg-zinc-800 -z-0" />
                    
                    {/* Progress filled line */}
                    <div
                      className="absolute left-3 top-1/2 -translate-y-1/2 h-0.5 bg-gradient-to-r from-red-600 via-amber-500 to-emerald-500 -z-0 transition-all duration-500"
                      style={{
                        width: isDelivered ? '94%' : isShipped ? '65%' : isPaid ? '35%' : '5%'
                      }}
                    />

                    {/* Step 1: Realizado */}
                    <div className="relative z-10 flex flex-col items-center">
                      <div className="w-7 h-7 rounded-full bg-red-600 text-white flex items-center justify-center shadow-md shadow-red-950/60">
                        <Check className="w-3.5 h-3.5" />
                      </div>
                      <span className="text-[10px] font-bold text-zinc-300 mt-1 whitespace-nowrap">Recebido</span>
                    </div>

                    {/* Step 2: Pago */}
                    <div className="relative z-10 flex flex-col items-center">
                      <div
                        className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${
                          isPaid
                            ? 'bg-red-600 text-white shadow-md shadow-red-950/60'
                            : 'bg-zinc-800 text-zinc-500'
                        }`}
                      >
                        {isPaid ? <Check className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
                      </div>
                      <span className="text-[10px] font-bold text-zinc-300 mt-1 whitespace-nowrap">Pago</span>
                    </div>

                    {/* Step 3: Enviado */}
                    <div className="relative z-10 flex flex-col items-center">
                      <div
                        className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${
                          isShipped
                            ? 'bg-amber-500 text-black shadow-md shadow-amber-950/60'
                            : 'bg-zinc-800 text-zinc-500'
                        }`}
                      >
                        <Truck className="w-3.5 h-3.5" />
                      </div>
                      <span className="text-[10px] font-bold text-zinc-300 mt-1 whitespace-nowrap">
                        {isShipped ? 'Em Transporte' : 'Separação'}
                      </span>
                    </div>

                    {/* Step 4: Entregue */}
                    <div className="relative z-10 flex flex-col items-center">
                      <div
                        className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${
                          isDelivered
                            ? 'bg-emerald-500 text-black shadow-md shadow-emerald-950/60'
                            : 'bg-zinc-800 text-zinc-500'
                        }`}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      </div>
                      <span className="text-[10px] font-bold text-zinc-300 mt-1 whitespace-nowrap">Entregue</span>
                    </div>
                  </div>
                </div>

                {/* Inline Resume Pix Panel while within 15-minute window */}
                {isPendingPix && (() => {
                  const pixCopyCode = order.pixCopyPaste || order.qrCode || '';
                  const pixKeyValue = order.pixKey || 'streetstore364@gmail.com';
                  const copyTargetCode = pixCopyCode || pixKeyValue;

                  return (
                    <div className="p-4 bg-zinc-950 border border-amber-500/30 rounded-xl space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/90 pb-2.5">
                        <div className="flex items-center gap-2">
                          <QrCode className="w-4 h-4 text-[#009EE3]" />
                          <span className="text-xs font-black text-white uppercase tracking-wider">
                            Retomar Pagamento Pix
                          </span>
                        </div>
                        <span
                          className={`text-[11px] font-black font-mono tabular-nums ${
                            isLowTime ? 'text-red-400' : 'text-amber-300'
                          }`}
                        >
                          Tempo restante: {formatRemainingMmSs(remainingMs)}
                        </span>
                      </div>

                      <div className="flex flex-col sm:flex-row gap-4 items-center sm:items-start">
                        {order.qrCodeBase64 && (
                          <div className="w-36 h-36 sm:w-40 sm:h-40 bg-white rounded-xl p-2 shrink-0 flex items-center justify-center border border-zinc-700 shadow-lg">
                            <img
                              src={`data:image/png;base64,${order.qrCodeBase64}`}
                              alt={`QR Code Pix do Pedido ${order.orderNumber}`}
                              loading="lazy"
                              decoding="async"
                              className="w-full h-full object-contain"
                            />
                          </div>
                        )}

                        <div className="flex-1 w-full space-y-2.5">
                          <p className="text-[11px] text-zinc-300 leading-relaxed">
                            Escaneie o QR Code ou copie o código abaixo no app do seu banco dentro do prazo de <strong>15 minutos</strong> para confirmar o pedido automaticamente.
                          </p>

                          <div className="p-2 bg-zinc-900 border border-zinc-800 rounded-lg flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <span className="text-[10px] text-zinc-400 uppercase font-bold block">Chave Pix (E-mail):</span>
                              <span className="font-mono text-[11px] text-emerald-400 font-bold select-all truncate block">
                                {pixKeyValue}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleCopyOrderPixKey(payKey, pixKeyValue)}
                              className="px-2.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-md text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 shrink-0 transition-colors cursor-pointer"
                            >
                              {copiedPixKeyFor === payKey ? (
                                <>
                                  <Check className="w-3 h-3 text-emerald-400" />
                                  <span className="text-emerald-400">Copiado!</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3" />
                                  <span>Copiar</span>
                                </>
                              )}
                            </button>
                          </div>

                          {pixCopyCode && (
                            <div className="p-2 bg-zinc-900 border border-zinc-800 rounded-lg">
                              <span className="text-[10px] text-zinc-500 uppercase font-bold block mb-0.5">
                                Código Pix Copia e Cola:
                              </span>
                              <p className="font-mono text-[10px] text-zinc-300 break-all select-all line-clamp-2">
                                {pixCopyCode}
                              </p>
                            </div>
                          )}

                          <button
                            type="button"
                            onClick={() => handleCopyOrderPixCode(payKey, copyTargetCode)}
                            className="w-full py-2.5 bg-[#009EE3] hover:bg-[#0089c7] text-white font-black text-xs uppercase tracking-wider rounded-lg flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                          >
                            {copiedPixCodeFor === payKey ? (
                              <>
                                <Check className="w-3.5 h-3.5" />
                                <span>Copiado!</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3.5 h-3.5" />
                                <span>COPIAR CÓDIGO PIX</span>
                              </>
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={() => handleCheckOrderPixPayment(order)}
                            disabled={verifyingPixId === payKey}
                            className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white font-black text-xs uppercase tracking-wider rounded-lg flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                          >
                            {verifyingPixId === payKey ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                <span>Verificando pagamento no banco...</span>
                              </>
                            ) : (
                              <>
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>Já realizei o pagamento Pix</span>
                              </>
                            )}
                          </button>

                          {pixFeedback && (
                            <div
                              className={`p-2.5 rounded-lg text-[11px] flex items-start gap-2 ${
                                pixFeedback.type === 'success'
                                  ? 'bg-emerald-950/60 border border-emerald-500/40 text-emerald-200'
                                  : pixFeedback.type === 'error'
                                  ? 'bg-red-950/60 border border-red-500/40 text-red-200'
                                  : 'bg-amber-950/60 border border-amber-500/40 text-amber-200'
                              }`}
                            >
                              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                              <span>{pixFeedback.text}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Shipping & Tracking Card (Shown after payment confirmation) */}
                {isPaid && (
                  <div className="p-3.5 bg-zinc-950 border border-zinc-800 rounded-xl space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white flex items-center gap-1.5">
                        <Truck className="w-4 h-4 text-[#009EE3]" />
                        Entrega: <strong className="text-emerald-400">{formatCustomerCarrier(order.shippingCarrier)}</strong>
                      </span>

                      {order.trackingNumber ? (
                        <span className="text-[10px] font-bold px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded">
                          Postado
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold px-2 py-0.5 bg-amber-500/10 text-amber-400 border border-amber-500/30 rounded">
                          Em Preparação
                        </span>
                      )}
                    </div>

                    {order.trackingNumber ? (
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1 border-t border-zinc-800/80">
                        <div>
                          <span className="text-[10px] text-zinc-500 uppercase font-bold block">Código de Rastreio:</span>
                          <span className="font-mono text-sm font-black text-white tracking-wider">
                            {order.trackingNumber}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleCopyTracking(order.trackingNumber!)}
                            className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-xs font-bold flex items-center gap-1 transition-colors cursor-pointer"
                          >
                            {copiedTracking === order.trackingNumber ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                                <span>Copiado</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3.5 h-3.5" />
                                <span>Copiar</span>
                              </>
                            )}
                          </button>

                          {order.trackingUrl && (
                            <a
                              href={order.trackingUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-3 py-1.5 bg-[#009EE3] hover:bg-[#0089c7] text-white rounded-lg text-xs font-bold flex items-center gap-1 transition-colors shadow-sm cursor-pointer"
                            >
                              <span>Abrir Rastreio</span>
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          )}
                        </div>
                      </div>
                    ) : (
                      <p className="text-[11px] text-zinc-400 leading-relaxed">
                        Seu pedido está sendo separado pela equipe da Street Store. Assim que for postado ou liberado para retirada na loja, o status e o código de rastreio aparecerão aqui e serão enviados para o seu e-mail.
                      </p>
                    )}
                  </div>
                )}

                {/* Products List */}
                <div className="space-y-2">
                  <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold block">
                    Peças no Pedido ({order.products.length})
                  </span>
                  <div className="space-y-1.5">
                    {order.products.map((p, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between text-xs p-2 bg-zinc-950/70 border border-zinc-850 rounded-lg"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-[#E50914]">{p.quantity}x</span>
                          <span className="text-zinc-200 font-medium">{p.name}</span>
                          {p.variant && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">
                              {p.variant}
                            </span>
                          )}
                          {p.color && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">
                              {p.color}
                            </span>
                          )}
                        </div>
                        <span className="font-bold text-white font-oswald">
                          R$ {p.price.toFixed(2).replace('.', ',')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Customer Address Details */}
                {order.shippingAddress && (
                  <div className="text-[11px] text-zinc-400 bg-zinc-950/40 p-2.5 rounded-lg border border-zinc-850">
                    <span className="text-zinc-300 font-bold block mb-0.5">Endereço de Entrega:</span>
                    {order.shippingAddress.address}, {order.shippingAddress.number} - {order.shippingAddress.locality}, {order.shippingAddress.city}/{order.shippingAddress.province} - CEP: {order.shippingAddress.zipcode}
                  </div>
                )}

                {/* Return Request Button */}
                <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-zinc-800/80">
                  <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                    <span>
                      {isPaid
                        ? 'Garantia Street Store de 7 dias para troca ou devolução'
                        : 'Aguardando confirmação do pagamento para liberar o pedido'}
                    </span>
                  </div>

                  {isPaid && (
                    <button
                      onClick={() => handleOpenReturnModal(order)}
                      className="px-3.5 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 hover:text-white rounded-lg text-xs font-bold uppercase tracking-wider transition-colors flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
                    >
                      <RotateCcw className="w-3.5 h-3.5 text-[#E50914]" />
                      <span>Solicitar Troca ou Devolução</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Modal Footer */}
        <div className="p-3.5 bg-zinc-900/60 border-t border-zinc-800 text-center shrink-0">
          <p className="text-[11px] text-zinc-500">
            Dúvidas sobre o frete? Fale com a Street Store pelo WhatsApp oficial:{' '}
            <a
              href="https://wa.me/5531984806556"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#E50914] font-bold hover:underline"
            >
              (31) 98480-6556
            </a>
          </p>
        </div>
      </motion.div>
    </div>
  );
}
