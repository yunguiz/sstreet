import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight, Gamepad2, Trophy, Ticket } from 'lucide-react';
import miamiSunsetSkylineImg from '../assets/images/miami_sunset_skyline_1795780973240.jpg';
import gta6MiamiPosterImg from '../assets/images/gta6_miami_poster_1795780974397.jpg';
import ps5MiamiConsoleImg from '../assets/images/ps5_miami_console_clean_1795780988504.jpg';

interface MiamiRaffleHeroBannerProps {
  onOpenRafflePage: () => void;
}

export function MiamiRaffleHeroBanner({ onOpenRafflePage }: MiamiRaffleHeroBannerProps) {
  const shouldReduceMotion = useReducedMotion();
  const [raffleCounts, setRaffleCounts] = useState<{ total: number; goal: number; active: boolean }>({
    total: 0,
    goal: 1000,
    active: true,
  });

  useEffect(() => {
    let active = true;
    const loadCounts = () => {
      fetch(`/api/raffle/ps5/status?t=${Date.now()}`, { cache: 'no-store' })
        .then((res) => res.json())
        .then((data) => {
          if (active && data?.success) {
            setRaffleCounts({
              total: Number(data.total || 0),
              goal: Number(data.goal || 1000),
              active: data.active !== false,
            });
          }
        })
        .catch(() => {});
    };

    loadCounts();
    window.addEventListener('streetstore:raffle-updated', loadCounts);
    return () => {
      active = false;
      window.removeEventListener('streetstore:raffle-updated', loadCounts);
    };
  }, []);

  if (!raffleCounts.active) return null;

  return (
    <section className="relative bg-[#09090b] border-b border-zinc-800/80 overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-7">
        <a
          href="/sorteio"
          onClick={(e) => {
            e.preventDefault();
            onOpenRafflePage();
          }}
          aria-label="Abrir página oficial do Sorteio PlayStation 5 e GTA VI Edição Miami"
          className="group relative block rounded-2xl overflow-hidden border border-zinc-800/90 hover:border-[#FF6B4A]/60 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6B4A] shadow-2xl"
        >
          {/* Miami Skyline Backdrop + Measured Dusk Contrast Scrim */}
          <div className="absolute inset-0 pointer-events-none select-none bg-gradient-to-br from-[#190d1f] via-[#09090b] to-[#082026]">
            <img
              src={miamiSunsetSkylineImg}
              alt="Horizonte Miami ao entardecer"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover object-center opacity-45 group-hover:scale-[1.02] transition-transform duration-700"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-[#09090b]/95 via-[#09090b]/82 to-[#09090b]/50" />
            <div className="absolute inset-0 bg-gradient-to-t from-[#09090b]/90 via-transparent to-[#09090b]/45" />
            {/* Warm Miami coral + ocean cyan horizon hairline glow */}
            <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-[#FF6B4A]/80 via-[#EC4899]/70 to-[#22D3EE]/80" />
          </div>

          <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-center p-5 sm:p-8 lg:p-9">
            {/* Left Content: Editorial Miami Campaign Copy */}
            <div className="lg:col-span-7 space-y-4 text-left">
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold tracking-wide text-zinc-300">
                <span className="text-[#FF8E53] font-bold uppercase tracking-wider">Sorteio Oficial</span>
                <span aria-hidden="true" className="text-zinc-600">·</span>
                <span className="text-[#22D3EE]">Edição Miami Sunset</span>
                <span aria-hidden="true" className="text-zinc-600">·</span>
                <span>A partir de R$ 150,00</span>
              </div>

              <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bebas tracking-wide uppercase leading-[0.98] text-white max-w-2xl text-balance">
                Concorra ao{' '}
                <span className="bg-gradient-to-r from-[#FF8E53] via-[#FB7185] to-[#22D3EE] bg-clip-text text-transparent">
                  PlayStation 5 + GTA VI
                </span>{' '}
                na Street Store
              </h2>

              <p className="text-sm sm:text-[15px] text-zinc-300 max-w-xl leading-relaxed">
                Cada pedido a partir de <strong className="text-white font-semibold">R$ 150,00</strong> gera
                automaticamente seu bilhete exclusivo. Clima Vice direto para o seu setup.
              </p>

              {/* Clean unboxed metrics + single primary action */}
              <div className="flex flex-wrap items-center gap-5 pt-1">
                <div className="flex items-center gap-2 text-xs sm:text-sm text-zinc-200 tabular-nums">
                  <Ticket className="w-4 h-4 text-[#FF8E53] shrink-0" />
                  <span>
                    <strong className="text-white font-bold">{raffleCounts.total}</strong> / {raffleCounts.goal} bilhetes confirmados
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs sm:text-sm text-zinc-300">
                  <Trophy className="w-4 h-4 text-[#22D3EE] shrink-0" />
                  <span>Sorteio ao completar a meta</span>
                </div>
              </div>

              <div className="pt-2">
                <span className="inline-flex items-center gap-2.5 px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#FF6B4A] via-[#E11D48] to-[#DB2777] text-white text-xs font-bold uppercase tracking-wider shadow-lg shadow-rose-950/50 group-hover:brightness-110 transition-all whitespace-nowrap">
                  <Gamepad2 className="w-4 h-4 shrink-0" />
                  <span>Abrir Página do Sorteio</span>
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform shrink-0" />
                </span>
              </div>
            </div>

            {/* Right Showcase Stage: Animated PlayStation 5 + GTA 6 Miami Artwork */}
            <div className="lg:col-span-5 relative flex items-center justify-center min-h-[220px] sm:min-h-[260px]">
              {/* Subtle ambient Miami dusk halo behind stage */}
              <div
                aria-hidden="true"
                className="absolute inset-4 rounded-full bg-gradient-to-tr from-[#FF6B4A]/20 via-[#EC4899]/15 to-[#22D3EE]/25 blur-2xl pointer-events-none"
              />

              <div className="relative w-full max-w-[430px] h-[225px] sm:h-[260px]">
                {/* GTA 6 Miami Vice Card (back-right floating in counter-phase) */}
                <motion.div
                  animate={
                    shouldReduceMotion
                      ? undefined
                      : {
                          y: [0, 7, 0],
                          rotate: [2, 0.5, 2],
                        }
                  }
                  transition={{
                    duration: 5.2,
                    repeat: Infinity,
                    ease: 'easeInOut',
                  }}
                  className="absolute right-0 top-2 w-[64%] aspect-[4/3] rounded-xl overflow-hidden border border-[#22D3EE]/40 shadow-2xl bg-[#111116] z-10 group-hover:translate-x-1 transition-transform duration-300"
                >
                  <img
                    src={gta6MiamiPosterImg}
                    alt="Arte estilo Miami inspirada em GTA VI"
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/15 to-transparent" />
                  <div className="absolute bottom-2.5 left-3 right-3 flex items-center justify-between text-[10px] font-bold tracking-wider uppercase text-white">
                    <span className="text-[#FF8E53]">GTA VI</span>
                    <span className="text-[#22D3EE]">Miami Vibe</span>
                  </div>
                </motion.div>

                {/* PlayStation 5 Console Card (front-left levitating gently) */}
                <motion.div
                  animate={
                    shouldReduceMotion
                      ? undefined
                      : {
                          y: [0, -8, 0],
                          rotate: [-1.5, 0, -1.5],
                        }
                  }
                  transition={{
                    duration: 4.4,
                    repeat: Infinity,
                    ease: 'easeInOut',
                  }}
                  className="absolute left-0 bottom-0 w-[62%] aspect-[4/3] rounded-xl overflow-hidden border border-[#FF8E53]/45 shadow-[0_20px_50px_rgba(0,0,0,0.8)] bg-[#0b0d12] z-20 group-hover:-translate-x-1 transition-transform duration-300"
                >
                  <img
                    src={ps5MiamiConsoleImg}
                    alt="PlayStation 5 e Controle DualSense iluminados ao pôr do sol de Miami"
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-transparent" />
                  {/* Smooth diagonal dusk sheen sweep */}
                  {!shouldReduceMotion && (
                    <motion.div
                      aria-hidden="true"
                      animate={{ x: ['-120%', '180%'] }}
                      transition={{ duration: 4.8, repeat: Infinity, repeatDelay: 2.5, ease: 'easeInOut' }}
                      className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/15 to-transparent skew-x-[-20deg] pointer-events-none"
                    />
                  )}
                  <div className="absolute bottom-2.5 left-3 right-3 flex items-center justify-between text-[10px] font-bold tracking-wider uppercase text-white">
                    <span>PlayStation 5</span>
                    <span className="text-[#22D3EE]">Console + DualSense</span>
                  </div>
                </motion.div>
              </div>
            </div>
          </div>
        </a>
      </div>
    </section>
  );
}
