import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import {
  Gamepad2,
  Trophy,
  CheckCircle2,
  Ticket,
  ArrowLeft,
  ShoppingBag,
  ShieldCheck,
  CalendarClock,
} from 'lucide-react';
import miamiSunsetSkylineImg from '../assets/images/miami_sunset_skyline_1795780973240.jpg';
import ps5MiamiConsoleImg from '../assets/images/ps5_miami_console_clean_1795780988504.jpg';
import gta6MiamiPosterImg from '../assets/images/gta6_miami_poster_1795780974397.jpg';

interface RaffleStatus {
  active: boolean;
  goal: number;
  total: number;
  remaining: number;
  percentage: number;
  recentEntries: Array<{
    ticketCode: string;
    customerName: string;
    cityState: string;
    createdAt: number;
    orderTotal: number;
    status: string;
  }>;
}

interface Ps5RaffleSectionProps {
  id?: string;
  isDedicatedPage?: boolean;
  onBackToStore?: () => void;
  onExploreCatalog?: () => void;
}

export function Ps5RaffleSection({
  id = 'sorteio-ps5',
  isDedicatedPage = false,
  onBackToStore,
  onExploreCatalog,
}: Ps5RaffleSectionProps) {
  const shouldReduceMotion = useReducedMotion();
  const [status, setStatus] = useState<RaffleStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const loadRaffleStatus = () => {
      fetch(`/api/raffle/ps5/status?t=${Date.now()}`, { cache: 'no-store' })
        .then((res) => res.json())
        .then((data) => {
          if (active && data.success) {
            setStatus(data);
          }
        })
        .catch(() => {})
        .finally(() => {
          if (active) setLoading(false);
        });
    };

    loadRaffleStatus();

    const handleRaffleUpdated = () => loadRaffleStatus();
    const handleFocus = () => loadRaffleStatus();
    window.addEventListener('streetstore:raffle-updated', handleRaffleUpdated);
    window.addEventListener('focus', handleFocus);
    const timer = window.setInterval(loadRaffleStatus, 30000);

    return () => {
      active = false;
      window.removeEventListener('streetstore:raffle-updated', handleRaffleUpdated);
      window.removeEventListener('focus', handleFocus);
      window.clearInterval(timer);
    };
  }, []);

  if (loading) {
    if (!isDedicatedPage) return null;
    return (
      <section className="min-h-[60vh] bg-[#09090b] flex items-center justify-center px-4 py-20">
        <div className="text-center space-y-3">
          <Gamepad2 className="w-10 h-10 text-[#FF8E53] mx-auto animate-bounce" />
          <p className="text-sm text-zinc-400">Carregando placar oficial do sorteio PS5 + GTA VI...</p>
        </div>
      </section>
    );
  }

  if (!status || !status.active) return null;

  return (
    <section
      id={id}
      className={`relative px-4 sm:px-6 lg:px-8 bg-[#09090b] border-y border-zinc-800/80 overflow-hidden ${
        isDedicatedPage ? 'py-10 sm:py-14 min-h-[80vh]' : 'py-14 sm:py-20'
      }`}
    >
      {/* Miami Twilight Scenic Backdrop with Measured Contrast Scrim */}
      <div className="absolute inset-0 pointer-events-none select-none">
        <img
          src={miamiSunsetSkylineImg}
          alt="Horizonte Miami ao entardecer"
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover object-top opacity-20"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#09090b] via-[#09090b]/85 to-[#09090b]" />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-[#FF6B4A]/70 via-[#EC4899]/60 to-[#22D3EE]/70" />
      </div>

      <div className="max-w-6xl mx-auto relative z-10 space-y-10">
        {/* Top Navigation Row on Dedicated /sorteio Page */}
        {isDedicatedPage && (
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-zinc-800/80">
            <button
              type="button"
              onClick={onBackToStore}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#121216] hover:bg-zinc-800 border border-zinc-800 text-zinc-200 hover:text-white text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer whitespace-nowrap"
            >
              <ArrowLeft className="w-4 h-4 text-[#FF8E53]" />
              <span>Voltar para a Loja</span>
            </button>

            <div className="text-xs text-zinc-400 flex items-center gap-2">
              <span>Street Store Oficial</span>
              <span aria-hidden="true">·</span>
              <span className="text-[#22D3EE] font-semibold">Campanha Miami PS5 + GTA VI</span>
            </div>
          </div>
        )}

        {/* Header Editorial Copy */}
        <div className="text-center space-y-4 max-w-3xl mx-auto">
          <div className="flex flex-wrap items-center justify-center gap-2.5 text-xs font-semibold tracking-wider uppercase text-zinc-300">
            <span className="text-[#FF8E53] font-bold">Sorteio Oficial Street Store</span>
            <span aria-hidden="true" className="text-zinc-600">·</span>
            <span className="text-[#22D3EE]">Edição Miami Sunset</span>
            <span aria-hidden="true" className="text-zinc-600">·</span>
            <span>Compras a partir de R$ 150,00</span>
          </div>

          <h2 className="text-4xl sm:text-5xl lg:text-6xl font-bebas tracking-wide text-white uppercase leading-[0.96] text-balance">
            Concorra ao{' '}
            <span className="bg-gradient-to-r from-[#FF8E53] via-[#FB7185] to-[#22D3EE] bg-clip-text text-transparent">
              PlayStation 5 + GTA VI
            </span>
          </h2>

          <p className="text-sm sm:text-base text-zinc-300 max-w-2xl mx-auto leading-relaxed">
            Vista a autoridade do streetwear e entre direto na corrida pelo console de nova geração junto com a energia de Miami. Cada compra confirmada a partir de{' '}
            <strong className="text-white font-semibold">R$ 150,00</strong> garante seu bilhete oficial automaticamente.
          </p>
        </div>

        {/* Dual Animated Showcase: PlayStation 5 & GTA VI Vice Style */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
          {/* Card 1: PlayStation 5 Animated Spotlight */}
          <motion.div
            initial={shouldReduceMotion ? undefined : { opacity: 0, y: 18 }}
            whileInView={shouldReduceMotion ? undefined : { opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 0.5 }}
            className="group relative rounded-2xl overflow-hidden bg-[#121216] border border-zinc-800 hover:border-[#FF8E53]/50 transition-colors duration-200 flex flex-col shadow-2xl"
          >
            <div className="relative aspect-[4/3] w-full overflow-hidden bg-[#0a0c10]">
              <motion.img
                animate={
                  shouldReduceMotion
                    ? undefined
                    : {
                        y: [0, -6, 0],
                        scale: [1.02, 1.05, 1.02],
                      }
                }
                transition={{ duration: 4.8, repeat: Infinity, ease: 'easeInOut' }}
                src={ps5MiamiConsoleImg}
                alt="Console PlayStation 5 e controle DualSense sob iluminação Miami"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#121216] via-transparent to-black/25 pointer-events-none" />
              {!shouldReduceMotion && (
                <motion.div
                  aria-hidden="true"
                  animate={{ x: ['-120%', '180%'] }}
                  transition={{ duration: 5.5, repeat: Infinity, repeatDelay: 3, ease: 'easeInOut' }}
                  className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/10 to-transparent skew-x-[-20deg] pointer-events-none"
                />
              )}
            </div>

            <div className="p-5 sm:p-6 flex-1 flex flex-col justify-between space-y-3">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-xs text-zinc-400">
                  <span className="text-[#FF8E53] font-semibold">Prêmio Principal</span>
                  <span aria-hidden="true">·</span>
                  <span>Hardware Nova Geração</span>
                </div>
                <h3 className="text-2xl font-oswald font-bold text-white uppercase tracking-wide">
                  PlayStation 5 + Controle DualSense
                </h3>
                <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
                  Console oficial de 5ª geração com SSD ultrarrápido, áudio 3D Tempest e controle sem fio com gatilhos adaptáveis.
                </p>
              </div>
              <div className="pt-2 border-t border-zinc-800/80 flex items-center justify-between text-xs text-zinc-300">
                <span>Entrega garantida em todo Brasil</span>
                <span className="text-[#22D3EE] font-semibold">Lacrado de Fábrica</span>
              </div>
            </div>
          </motion.div>

          {/* Card 2: GTA VI Vice / Miami Edition Spotlight */}
          <motion.div
            initial={shouldReduceMotion ? undefined : { opacity: 0, y: 18 }}
            whileInView={shouldReduceMotion ? undefined : { opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="group relative rounded-2xl overflow-hidden bg-[#121216] border border-zinc-800 hover:border-[#22D3EE]/50 transition-colors duration-200 flex flex-col shadow-2xl"
          >
            <div className="relative aspect-[4/3] w-full overflow-hidden bg-[#120d1b]">
              <motion.img
                animate={
                  shouldReduceMotion
                    ? undefined
                    : {
                        y: [0, 5, 0],
                        scale: [1.03, 1.06, 1.03],
                      }
                }
                transition={{ duration: 5.4, repeat: Infinity, ease: 'easeInOut' }}
                src={gta6MiamiPosterImg}
                alt="Cenário estilo Miami sunset inspirado em GTA VI"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#121216] via-transparent to-black/25 pointer-events-none" />
              {!shouldReduceMotion && (
                <motion.div
                  aria-hidden="true"
                  animate={{ x: ['-120%', '180%'] }}
                  transition={{ duration: 6, repeat: Infinity, repeatDelay: 3.5, ease: 'easeInOut' }}
                  className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-[#22D3EE]/15 to-transparent skew-x-[-20deg] pointer-events-none"
                />
              )}
            </div>

            <div className="p-5 sm:p-6 flex-1 flex flex-col justify-between space-y-3">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-xs text-zinc-400">
                  <span className="text-[#22D3EE] font-semibold">Tema Oficial</span>
                  <span aria-hidden="true">·</span>
                  <span>Vice / Leonida Vibes</span>
                </div>
                <h3 className="text-2xl font-oswald font-bold text-white uppercase tracking-wide">
                  Combo PS5 Pronto pro GTA VI
                </h3>
                <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
                  Inspirado no pôr do sol de Miami: o setup definitivo da Street Store para você já entrar na nova geração preparado para GTA VI.
                </p>
              </div>
              <div className="pt-2 border-t border-zinc-800/80 flex items-center justify-between text-xs text-zinc-300">
                <span>Bilhete único por compra &ge; R$ 150</span>
                <span className="text-[#FF8E53] font-semibold">Edição Especial</span>
              </div>
            </div>
          </motion.div>
        </div>

        {/* 3-Step Rules Breakdown Strip */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-5 rounded-xl bg-[#121216] border border-zinc-800/90 space-y-1.5">
            <span className="text-xs font-bold text-[#FF8E53] uppercase tracking-wider block">
              01. Escolha suas peças
            </span>
            <h4 className="text-sm font-bold text-white">Monte seu kit acima de R$ 150,00</h4>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Válido para qualquer camiseta, moletom, cargo, sneaker ou acessório do catálogo oficial.
            </p>
          </div>

          <div className="p-5 rounded-xl bg-[#121216] border border-zinc-800/90 space-y-1.5">
            <span className="text-xs font-bold text-[#FB7185] uppercase tracking-wider block">
              02. Geração instantânea
            </span>
            <h4 className="text-sm font-bold text-white">Bilhete automático após o pagamento</h4>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Assim que seu Pix ou Cartão é aprovado, o código único <span className="font-mono text-zinc-200">PS5-XXXX</span> entra na lista ao vivo.
            </p>
          </div>

          <div className="p-5 rounded-xl bg-[#121216] border border-zinc-800/90 space-y-1.5">
            <span className="text-xs font-bold text-[#22D3EE] uppercase tracking-wider block">
              03. Apuração auditável
            </span>
            <h4 className="text-sm font-bold text-white">Sorteio ao completar 1.000 bilhetes</h4>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Todos os participantes confirmados ficam registrados com transparência e verificação oficial na loja.
            </p>
          </div>
        </div>

        {/* Progress Card */}
        <div className="max-w-4xl mx-auto p-6 sm:p-8 rounded-2xl bg-[#121216] border border-zinc-800 shadow-2xl space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#FF6B4A]/20 to-[#22D3EE]/20 border border-[#FF8E53]/40 flex items-center justify-center text-[#FF8E53] shrink-0">
                <Trophy className="w-6 h-6" />
              </div>
              <div>
                <span className="text-xs uppercase tracking-wider text-zinc-400 font-semibold block">
                  Meta de Participações
                </span>
                <span className="text-2xl sm:text-3xl font-black text-white font-oswald tabular-nums">
                  {status.total}{' '}
                  <span className="text-zinc-500 text-lg">/ {status.goal} Bilhetes</span>
                </span>
              </div>
            </div>

            <div className="sm:text-right">
              <span className="text-xs text-zinc-400 block uppercase tracking-wider">Faltam apenas</span>
              <span className="text-xl sm:text-2xl font-black text-[#22D3EE] font-oswald tabular-nums">
                {status.remaining} {status.remaining === 1 ? 'bilhete' : 'bilhetes'}
              </span>
            </div>
          </div>

          {/* Visual Miami Sunset Progress Bar */}
          <div className="space-y-2">
            <div className="flex justify-between text-xs font-bold text-zinc-400 uppercase tabular-nums">
              <span>Progresso da Campanha</span>
              <span className="text-white">{status.percentage}% Concluído</span>
            </div>
            <div className="w-full h-4 bg-zinc-950 rounded-full overflow-hidden p-0.5 border border-zinc-800">
              <div
                className="h-full bg-gradient-to-r from-[#FF6B4A] via-[#EC4899] to-[#22D3EE] rounded-full transition-all duration-700"
                style={{ width: `${Math.max(3, status.percentage)}%` }}
              />
            </div>
          </div>

          <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-t border-zinc-800/80">
            <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-400">
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-[#22D3EE]" />
                Registro automático por CPF / Pedido
              </span>
              <span className="inline-flex items-center gap-1.5">
                <CalendarClock className="w-4 h-4 text-[#FF8E53]" />
                Atualização em tempo real
              </span>
            </div>

            {onExploreCatalog && (
              <button
                type="button"
                onClick={onExploreCatalog}
                className="px-6 py-3 rounded-xl bg-gradient-to-r from-[#FF6B4A] via-[#E11D48] to-[#DB2777] hover:brightness-110 text-white font-bold text-xs uppercase tracking-wider transition-all cursor-pointer inline-flex items-center justify-center gap-2 whitespace-nowrap shadow-lg shadow-rose-950/50 active:scale-95"
              >
                <ShoppingBag className="w-4 h-4 shrink-0" />
                <span>Comprar e Garantir Meu Bilhete</span>
              </button>
            )}
          </div>
        </div>

        {/* Recent Tickets Table */}
        <div className="max-w-4xl mx-auto space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-lg font-black text-white uppercase tracking-wide font-oswald flex items-center gap-2">
              <Ticket className="w-5 h-5 text-[#FF8E53]" />
              <span>Últimos Bilhetes Gerados na Loja</span>
            </h3>
            <span className="text-xs text-zinc-400">
              Placar oficial sincronizado com os pedidos pagos
            </span>
          </div>

          <div className="bg-[#121216] border border-zinc-800 rounded-2xl overflow-hidden shadow-xl">
            {status.recentEntries.length === 0 ? (
              <div className="p-8 text-center text-zinc-400 text-sm">
                Nenhum bilhete gerado ainda. Seja o primeiro a comprar e garantir o seu!
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-zinc-800 bg-zinc-900/70 text-zinc-400 text-xs uppercase tracking-wider font-oswald">
                      <th className="py-3 px-4">Código do Bilhete</th>
                      <th className="py-3 px-4">Participante</th>
                      <th className="py-3 px-4">Localidade</th>
                      <th className="py-3 px-4 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60 text-sm">
                    {status.recentEntries.map((entry, idx) => (
                      <tr key={idx} className="hover:bg-zinc-900/40 transition-colors">
                        <td className="py-3 px-4 font-mono font-bold text-[#FF8E53] tracking-wider tabular-nums">
                          {entry.ticketCode}
                        </td>
                        <td className="py-3 px-4 text-white font-medium">
                          {entry.customerName}
                        </td>
                        <td className="py-3 px-4 text-zinc-400 text-xs">
                          {entry.cityState}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <span className="inline-flex items-center justify-end gap-1.5 text-emerald-400 text-xs font-semibold">
                            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                            <span>{entry.status}</span>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
