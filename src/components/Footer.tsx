import { 
  MapPin, 
  Phone, 
  Mail, 
  Instagram, 
  ShieldCheck, 
  Truck, 
  RefreshCw, 
  HelpCircle
} from 'lucide-react';
import { motion } from 'motion/react';

import { ProductCategory } from '../types';

interface FooterProps {
  onOpenTracking?: () => void;
  onSelectCategory?: (category: ProductCategory | 'all', subcat?: string) => void;
  onOpenPolicies?: (tab: 'faq' | 'shipping' | 'returns') => void;
}

export function Footer({ onOpenTracking, onSelectCategory, onOpenPolicies }: FooterProps = {}) {

  return (
    <footer className="bg-[#080808] border-t border-[#1F1F1F] text-zinc-400 text-xs">
      {/* 3 Core Guarantees */}
      <div className="border-b border-[#1A1A1A] py-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-40px' }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 md:grid-cols-3 gap-6"
        >
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-[#E50914] shrink-0">
              <Truck className="w-5 h-5" />
            </div>
            <div>
              <p className="font-bold text-white text-sm">Envio para todo o Brasil</p>
              <p className="text-zinc-500">Rastreio em tempo real via Correios e Jadlog</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-[#E50914] shrink-0">
              <RefreshCw className="w-5 h-5" />
            </div>
            <div>
              <p className="font-bold text-white text-sm">Primeira Troca Grátis</p>
              <p className="text-zinc-500">Até 7 dias após o recebimento da peça</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-[#E50914] shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <p className="font-bold text-white text-sm">100% Original e Autêntico</p>
              <p className="text-zinc-500">Garantia total de procedência e qualidade</p>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Main Footer Links */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <motion.div
          initial={{ opacity: 0, y: 25 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-40px' }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-8"
        >
          
          {/* Brand & Store Info */}
          <div className="lg:col-span-5 space-y-4">
            <div className="h-12 w-40 flex items-center">
              <img
                src="/assets/aistudio/nova-logo_0b1a92f5.png"
                alt="Street Store Itabira"
                loading="lazy"
                decoding="async"
                className="h-full w-full object-contain filter drop-shadow-[0_2px_8px_rgba(229,9,20,0.3)]"
              />
            </div>
            <p className="text-zinc-400 max-w-sm leading-relaxed">
              Street Store é autoridade no streetwear nacional. Peças de alta densidade, modelagens autênticas e os melhores calçados para quem vive o asfalto.
            </p>

            <div className="space-y-1.5 pt-2">
              <div className="flex items-center gap-2 text-zinc-300">
                <MapPin className="w-4 h-4 text-[#E50914] shrink-0" />
                <span>Avenida João Pinheiro, 353 - Centro · Itabira - MG · CEP 35900-539</span>
              </div>
              <div className="flex items-center gap-2 text-zinc-300">
                <Phone className="w-4 h-4 text-[#E50914] shrink-0" />
                <span>WhatsApp: (31) 98480-6556</span>
              </div>
              <a href="mailto:streetstore364@gmail.com" className="flex items-center gap-2 text-zinc-300 hover:text-white transition-colors">
                <Mail className="w-4 h-4 text-[#E50914] shrink-0" />
                <span>streetstore364@gmail.com</span>
              </a>
            </div>
          </div>

          {/* Categorias Reais do Site */}
          <div className="lg:col-span-2 space-y-3">
            <h4 className="text-xs font-black uppercase tracking-wider text-white font-oswald">
              CATEGORIAS DO SITE
            </h4>
            <ul className="space-y-2 text-xs">
              {[
                { label: 'Moletons & Corta-Ventos', cat: 'roupas' as const, subcat: 'hoodies' },
                { label: 'Camisetas Oversized', cat: 'roupas' as const, subcat: 'camisetas' },
                { label: 'Calças Cargo & Baggy', cat: 'roupas' as const, subcat: 'calcas' },
                { label: 'Shorts & Bermudas', cat: 'roupas' as const, subcat: 'shorts' },
                { label: 'Tênis & Sneakers Skate', cat: 'calcados' as const, subcat: 'sneakers' },
                { label: 'Bonés & Toucas Beanie', cat: 'acessorios' as const, subcat: 'bones' },
                { label: 'Óculos Radar & Juliet', cat: 'acessorios' as const, subcat: 'acessorios-metal' },
                { label: 'Shoulder Bags & Mochilas', cat: 'acessorios' as const, subcat: 'bags' },
              ].map((item) => (
                <li key={item.label}>
                  <a
                    href="#catalogo"
                    onClick={(e) => {
                      if (onSelectCategory) {
                        e.preventDefault();
                        onSelectCategory(item.cat, item.subcat);
                        const el = document.getElementById('catalogo');
                        if (el) el.scrollIntoView({ behavior: 'smooth' });
                      }
                    }}
                    className="hover:text-white transition-colors cursor-pointer block"
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Atendimento & Institucional */}
          <div className="lg:col-span-2 space-y-3">
            <h4 className="text-xs font-black uppercase tracking-wider text-white font-oswald">
              AJUDA & SUPORTE
            </h4>
            <ul className="space-y-2">
              <li>
                <button
                  type="button"
                  onClick={onOpenTracking}
                  className="hover:text-white transition-colors flex items-center gap-1.5 cursor-pointer text-left"
                >
                  <Truck className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Rastrear Pedido</span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onOpenPolicies ? onOpenPolicies('returns') : (onOpenTracking && onOpenTracking())}
                  className="hover:text-white transition-colors flex items-center gap-1.5 cursor-pointer text-left"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-[#E50914]" />
                  <span>Trocas e Devoluções</span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onOpenPolicies && onOpenPolicies('shipping')}
                  className="hover:text-white transition-colors flex items-center gap-1.5 cursor-pointer text-left"
                >
                  <Truck className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Política de Entregas</span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onOpenPolicies && onOpenPolicies('faq')}
                  className="hover:text-white transition-colors flex items-center gap-1.5 cursor-pointer text-left"
                >
                  <HelpCircle className="w-3.5 h-3.5 text-yellow-400" />
                  <span>FAQ & Guia de Medidas</span>
                </button>
              </li>
              <li>
                <a href="https://wa.me/5531984806556" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Suporte no WhatsApp</span>
                </a>
              </li>
              <li>
                <a href="mailto:streetstore364@gmail.com" className="hover:text-white transition-colors flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-zinc-400" />
                  <span>streetstore364@gmail.com</span>
                </a>
              </li>
            </ul>
          </div>

          {/* Formas de Pagamento & Segurança */}
          <div className="lg:col-span-3 space-y-4">
            <h4 className="text-xs font-black uppercase tracking-wider text-white font-oswald">
              FORMAS DE PAGAMENTO
            </h4>
            <div className="flex flex-wrap gap-2 text-[10px] font-bold text-zinc-300">
              <span className="px-2.5 py-1.5 bg-zinc-900 border border-zinc-800 rounded">PIX (5% OFF)</span>
              <span className="px-2.5 py-1.5 bg-zinc-900 border border-zinc-800 rounded">Cartão até 6x</span>
              <span className="px-2.5 py-1.5 bg-zinc-900 border border-zinc-800 rounded">Boleto Bancário</span>
            </div>

            <div className="pt-2">
              <h4 className="text-xs font-black uppercase tracking-wider text-white font-oswald mb-2">
                REDES SOCIAIS
              </h4>
              <a
                href="https://instagram.com/streetstoreitabira"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-800 rounded-lg transition-colors"
              >
                <Instagram className="w-4 h-4 text-pink-400" />
                <span>@streetstoreitabira</span>
              </a>
            </div>
          </div>

        </motion.div>

        {/* Copyright */}
        <div className="mt-12 pt-6 border-t border-zinc-900 flex flex-col sm:flex-row items-center justify-between gap-4 text-[11px] text-zinc-400">
          <p>© {new Date().getFullYear()} Street Store. Todos os direitos reservados. CNPJ: 45.892.109/0001-32 · Itabira - MG.</p>
          <p className="flex items-center gap-2">
            <span>Autoridade no Streetwear Nacional</span>
            <span aria-hidden="true">·</span>
            <span>Checkout Seguro & Criptografia SSL 256-bit</span>
          </p>
        </div>
      </div>
    </footer>
  );
}
