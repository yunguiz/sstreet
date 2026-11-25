import React, { useEffect, useState } from 'react';
import { Gamepad2, Trophy, Users, Sparkles, CheckCircle2, Ticket, Flame } from 'lucide-react';

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

export function Ps5RaffleSection() {
  const [status, setStatus] = useState<RaffleStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/raffle/ps5/status')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setStatus(data);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return null;
  if (!status || !status.active) return null;

  return (
    <section className="relative py-14 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-[#0D0D0D] via-[#161616] to-[#0D0D0D] border-y border-red-600/30 overflow-hidden">
      {/* Background glow & subtle ambient graphics */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(229,9,20,0.08)_0%,transparent_70%)] pointer-events-none" />
      
      <div className="max-w-7xl mx-auto relative z-10 space-y-8">
        
        {/* Header Badge & Title */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-red-600/20 border border-red-500/40 text-red-400 text-xs font-black uppercase tracking-widest shadow-lg shadow-red-950/40 animate-pulse">
            <Gamepad2 className="w-4 h-4 text-red-500" />
            <span>SORTEIO OFICIAL STREET STORE • PLAYSTATION 5</span>
          </div>
          <h2 className="text-3xl sm:text-5xl font-black text-white uppercase tracking-wider font-oswald">
            CONCORRA A UM <span className="text-red-600 drop-shadow-[0_0_25px_rgba(229,9,20,0.5)]">PS5 DE 5ª GERAÇÃO</span>
          </h2>
          <p className="text-sm sm:text-base text-zinc-300 max-w-2xl mx-auto leading-relaxed">
            Faça compras a partir de <strong className="text-white font-bold">R$ 150,00</strong> em produtos oficiais da Street Store para receber automaticamente o seu bilhete da sorte exclusivo!
          </p>
        </div>

        {/* Progress Card */}
        <div className="max-w-3xl mx-auto p-6 sm:p-8 rounded-2xl bg-[#121212] border border-zinc-800 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 right-0 transform translate-x-6 -translate-y-6 w-32 h-32 bg-red-600/10 rounded-full blur-2xl pointer-events-none" />

          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-red-600/20 border border-red-500/40 flex items-center justify-center text-red-500 font-bold">
                <Trophy className="w-6 h-6" />
              </div>
              <div>
                <span className="text-xs uppercase tracking-widest text-zinc-400 font-semibold block">Meta de Participações</span>
                <span className="text-2xl sm:text-3xl font-black text-white font-oswald">
                  {status.total} <span className="text-zinc-500 text-lg">/ {status.goal} Bilhetes</span>
                </span>
              </div>
            </div>

            <div className="text-right sm:text-right w-full sm:w-auto p-3 rounded-xl bg-zinc-900 border border-zinc-800">
              <span className="text-xs text-zinc-400 block uppercase">Faltam apenas</span>
              <span className="text-xl sm:text-2xl font-black text-red-500 font-oswald">
                {status.remaining} {status.remaining === 1 ? 'compra' : 'compras'}
              </span>
            </div>
          </div>

          {/* Visual Progress Bar */}
          <div className="space-y-2">
            <div className="flex justify-between text-xs font-bold text-zinc-400 uppercase">
              <span>Progresso Atual</span>
              <span className="text-white">{status.percentage}% Concluído</span>
            </div>
            <div className="w-full h-4 bg-zinc-900 rounded-full overflow-hidden p-0.5 border border-zinc-800">
              <div
                className="h-full bg-gradient-to-r from-red-700 via-red-500 to-amber-500 rounded-full transition-all duration-1000 shadow-[0_0_15px_rgba(229,9,20,0.6)]"
                style={{ width: `${Math.max(3, status.percentage)}%` }}
              />
            </div>
          </div>
        </div>

        {/* Recent Tickets Table / Feed */}
        <div className="max-w-4xl mx-auto space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-black text-white uppercase tracking-wide font-oswald flex items-center gap-2">
              <Ticket className="w-5 h-5 text-red-500" />
              <span>Últimos Bilhetes Gerados na Loja</span>
            </h3>
            <span className="text-xs text-zinc-400 bg-zinc-900 px-3 py-1 rounded-full border border-zinc-800">
              Atualizado em tempo real
            </span>
          </div>

          <div className="bg-[#121212] border border-zinc-800 rounded-2xl overflow-hidden shadow-xl">
            {status.recentEntries.length === 0 ? (
              <div className="p-8 text-center text-zinc-400 text-sm">
                Nenhum bilhete gerado ainda. Seja o primeiro a comprar e garantir o seu!
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-zinc-800 bg-zinc-900/60 text-zinc-400 text-xs uppercase tracking-wider font-oswald">
                      <th className="py-3 px-4">Código do Bilhete</th>
                      <th className="py-3 px-4">Participante</th>
                      <th className="py-3 px-4">Localidade</th>
                      <th className="py-3 px-4 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60 text-sm">
                    {status.recentEntries.map((entry, idx) => (
                      <tr key={idx} className="hover:bg-zinc-900/40 transition-colors">
                        <td className="py-3 px-4 font-mono font-bold text-red-400 tracking-wider">
                          {entry.ticketCode}
                        </td>
                        <td className="py-3 px-4 text-white font-medium">
                          {entry.customerName}
                        </td>
                        <td className="py-3 px-4 text-zinc-400 text-xs">
                          {entry.cityState}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-bold">
                            <CheckCircle2 className="w-3 h-3" /> {entry.status}
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
