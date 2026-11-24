import React, { useState, useMemo } from 'react';
import { ClothingRailHero, GarmentKind, RailGarment } from '@/components/ui/product-rail-gallery';
import { Product } from '../types';
import { ShoppingBag, Eye, ArrowRight, RotateCw, CheckCircle2 } from 'lucide-react';

interface StreetwearRailSectionProps {
  products: Product[];
  onOpenProduct: (product: Product) => void;
  onQuickAdd: (product: Product) => void;
  onExploreCatalog: () => void;
}

interface CutoutCatalogPreset {
  id: string;
  skuPrefixes: string[];
  nameKeywords: string[];
  kind: GarmentKind;
  color: string;
  trim: string;
  image: string;
  backImage: string;
  sideImage?: string;
}

/**
 * Recortes transparentes com enquadramento uniforme (proporção 200x310)
 * pareados aos produtos reais do catálogo (Bling / Firestore).
 */
const STUDIO_CUTOUT_PRESETS: CutoutCatalogPreset[] = [
  {
    id: 'otsr-1977',
    skuPrefixes: ['OTSR1977'],
    nameKeywords: ['recortada 19', '1977', 'raglan'],
    kind: 'tee',
    color: '#0F0F11',
    trim: '#DC2626',
    image: '/assets/aistudio/C_pia_de_NOVIDADE__3__f437c7b1.png',
    backImage: '/assets/aistudio/C_pia_de_NOVIDADE__1__b4d9c4a8.png',
  },
  {
    id: 'otsr-506-off-preta',
    skuPrefixes: ['OTSR506'],
    nameKeywords: ['recortada off com preta', 'duo wave 77'],
    kind: 'tee',
    color: '#F4F4F0',
    trim: '#18181B',
    image: '/assets/aistudio/Design_sem_nome__4__bfe5aaed.png',
    backImage: '/assets/aistudio/Design_sem_nome__3__5e605338.png',
  },
  {
    id: 'otsbp-501-pixo-preto',
    skuPrefixes: ['OTSBP501', 'OVTP501'],
    nameKeywords: ['pixo preto', 'estampada preta', 'wildstyle'],
    kind: 'tee',
    color: '#121214',
    trim: '#27272A',
    image: '/assets/aistudio/Design_sem_nome__5__ef8bca41.png',
    backImage: '/assets/aistudio/Design_sem_nome__6__d3642ec7.png',
  },
  {
    id: 'otsbp-502-pixo-verde',
    skuPrefixes: ['OTSBP502'],
    nameKeywords: ['pixo verde', 'olive'],
    kind: 'tee',
    color: '#3F4734',
    trim: '#2B3224',
    image: '/assets/aistudio/Design_sem_nome__8__f44ad096.png',
    backImage: '/assets/aistudio/Design_sem_nome__7__e6ab934f.png',
  },
  {
    id: 'otsp-500-tribal',
    skuPrefixes: ['OTSP500', 'OVTP502'],
    nameKeywords: ['estampada off white', 'tribal'],
    kind: 'tee',
    color: '#0F0F12',
    trim: '#E4E4E7',
    image: '/assets/aistudio/Design_sem_nome__9__73306863.png',
    backImage: '/assets/aistudio/Design_sem_nome__9__73306863.png',
  },
  {
    id: 'otsr-505-roxo-preta',
    skuPrefixes: ['OTSR505'],
    nameKeywords: ['boxy recortada roxo com preta'],
    kind: 'tee',
    color: '#111116',
    trim: '#6B21A8',
    image: '/assets/aistudio/Design_sem_nome__10__4bbf1037.png',
    backImage: '/assets/aistudio/Design_sem_nome__10__4bbf1037.png',
  },
  {
    id: 'otspn-500-roxa-preto',
    skuPrefixes: ['OTSPN500'],
    nameKeywords: ['recortada roxa com preto'],
    kind: 'tee',
    color: '#4C1D95',
    trim: '#18181B',
    image: '/assets/aistudio/Design_sem_nome__11__0eda0283.png',
    backImage: '/assets/aistudio/Design_sem_nome__11__0eda0283.png',
  },
];

function formatBrl(value: number): string {
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

function findMatchingCatalogProduct(products: Product[], preset: CutoutCatalogPreset): Product | undefined {
  const bySku = products.find((p) => {
    const sku = (p.integration?.sku || '').toUpperCase().trim();
    const variantSkus = (p.variantsList || []).map((v) => (v.sku || '').toUpperCase().trim());
    return preset.skuPrefixes.some(
      (prefix) => sku.startsWith(prefix) || variantSkus.some((vs) => vs.startsWith(prefix))
    );
  });
  if (bySku) return bySku;

  return products.find((p) => {
    const lowerName = (p.name || '').toLowerCase();
    return preset.nameKeywords.some((kw) => lowerName.includes(kw));
  });
}

function inferGarmentKind(product: Product): GarmentKind {
  const lower = `${product.subcategory} ${product.name}`.toLowerCase();
  if (lower.includes('moletom') || lower.includes('hoodie')) return 'hoodie';
  if (lower.includes('jaqueta') || lower.includes('jacket') || lower.includes('corta vento')) return 'jacket';
  if (lower.includes('casaco') || lower.includes('coat')) return 'coat';
  if (lower.includes('polo') || lower.includes('camisa ')) return 'shirt';
  return 'tee';
}

export const StreetwearRailSection: React.FC<StreetwearRailSectionProps> = ({
  products,
  onOpenProduct,
  onQuickAdd,
  onExploreCatalog,
}) => {
  const [activeTab, setActiveTab] = useState<'all' | 'tees' | 'hoodies'>('all');
  const [addedNotice, setAddedNotice] = useState<string | null>(null);

  type CatalogRailItem = RailGarment & {
    originalProduct: Product;
    priceFormatted: string;
  };

  const railItems: CatalogRailItem[] = useMemo(() => {
    const usedProductIds = new Set<string>();
    const mapped: CatalogRailItem[] = [];

    // 1. Vincula os recortes transparentes uniformes (200x310) aos respectivos produtos reais do catálogo
    for (const preset of STUDIO_CUTOUT_PRESETS) {
      const match = findMatchingCatalogProduct(products, preset);
      if (!match || usedProductIds.has(match.id)) continue;

      usedProductIds.add(match.id);
      const priceFormatted = formatBrl(match.price);
      const primaryColor = match.colors?.[0]?.hex || preset.color;
      const validSizes = (match.sizes || []).filter(Boolean).slice(0, 5);
      const detailsList = [
        ...(validSizes.length > 0 ? [`Tamanhos: ${validSizes.join(' · ')}`] : []),
        ...(match.details?.composition ? [match.details.composition] : []),
        ...(match.details?.weight ? [match.details.weight] : []),
        match.stockCount > 0 ? `${match.stockCount} un. em estoque` : 'Sob consulta',
      ].slice(0, 4);

      mapped.push({
        id: match.id,
        name: match.name,
        kind: preset.kind,
        color: primaryColor,
        trim: preset.trim,
        tag: priceFormatted,
        priceFormatted,
        description: match.description,
        details: detailsList,
        image: preset.image,
        backImage: preset.backImage || preset.image,
        sideImage: preset.sideImage,
        originalProduct: match,
      });
    }

    // 2. Complementa com moletons/jaquetas/camisetas reais com recorte PNG transparente se houver no catálogo
    const extraTransparentApparel = products.filter((p) => {
      if (usedProductIds.has(p.id)) return false;
      if (p.category !== 'roupas' || p.stockCount <= 0) return false;
      const img = p.images?.[0] || '';
      return /\.png(\?|$)/i.test(img);
    });

    for (const prod of extraTransparentApparel.slice(0, 4)) {
      usedProductIds.add(prod.id);
      const priceFormatted = formatBrl(prod.price);
      const frontImg = prod.images[0];
      const backImg = prod.images[1] && /\.png(\?|$)/i.test(prod.images[1]) ? prod.images[1] : frontImg;
      const validSizes = (prod.sizes || []).filter(Boolean).slice(0, 5);

      mapped.push({
        id: prod.id,
        name: prod.name,
        kind: inferGarmentKind(prod),
        color: prod.colors?.[0]?.hex || '#18181B',
        trim: '#DC2626',
        tag: priceFormatted,
        priceFormatted,
        description: prod.description,
        details: [
          ...(validSizes.length > 0 ? [`Tamanhos: ${validSizes.join(' · ')}`] : []),
          ...(prod.details?.composition ? [prod.details.composition] : []),
          `${prod.stockCount} un. em estoque`,
        ].slice(0, 4),
        image: frontImg,
        backImage: backImg,
        originalProduct: prod,
      });
    }

    return mapped;
  }, [products]);

  const filteredItems = useMemo(() => {
    if (activeTab === 'tees') return railItems.filter((i) => i.kind === 'tee' || i.kind === 'shirt');
    if (activeTab === 'hoodies') return railItems.filter((i) => i.kind === 'hoodie' || i.kind === 'jacket' || i.kind === 'coat');
    return railItems;
  }, [railItems, activeTab]);

  const hasHoodies = useMemo(
    () => railItems.some((i) => i.kind === 'hoodie' || i.kind === 'jacket' || i.kind === 'coat'),
    [railItems]
  );

  const handleOpenCatalogItem = (item: CatalogRailItem, closeModal?: () => void) => {
    closeModal?.();
    onOpenProduct(item.originalProduct);
  };

  const handleQuickBuy = (item: CatalogRailItem, closeModal?: () => void) => {
    onQuickAdd(item.originalProduct);
    closeModal?.();
    setAddedNotice(`${item.originalProduct.name} adicionado ao carrinho!`);
    setTimeout(() => setAddedNotice(null), 3500);
  };

  if (railItems.length === 0) {
    return null;
  }

  return (
    <section className="relative w-full border-t border-b border-zinc-800/80 bg-zinc-950 py-16 overflow-hidden">
      {/* Background ambient glow */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[350px] bg-red-600/10 rounded-full blur-[140px]" />
        <div className="absolute bottom-10 right-10 w-96 h-96 bg-amber-500/5 rounded-full blur-[120px]" />
      </div>

      {/* Street Store Title Header */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center mb-8">
        <p className="text-[11px] font-bold tracking-[0.28em] uppercase text-red-400 mb-3">
          Arara Interativa 3D · Street Store Itabira
        </p>

        <h2 className="text-3xl sm:text-4xl md:text-5xl font-black uppercase tracking-tight text-white font-bebas">
          NOVIDADES <span className="text-red-500">NA STREET</span>
        </h2>

        <p className="max-w-2xl mx-auto mt-2 text-sm text-zinc-400 leading-relaxed">
          Passe o mouse ou deslize o dedo para afastar os cabides na arara. Clique em qualquer peça para abrir a visualização 360°, conferir medidas e comprar direto do catálogo.
        </p>

        {/* Interactive Tabs */}
        <div className="flex flex-wrap items-center justify-center gap-2 mt-6">
          <button
            type="button"
            onClick={() => setActiveTab('all')}
            className={`px-4 py-2 rounded-md text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
              activeTab === 'all'
                ? 'bg-red-600 text-white shadow-lg shadow-red-600/30 ring-1 ring-red-500'
                : 'bg-zinc-900/90 text-zinc-400 hover:text-white border border-zinc-800'
            }`}
          >
            Todos os Drops ({railItems.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('tees')}
            className={`px-4 py-2 rounded-md text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
              activeTab === 'tees'
                ? 'bg-red-600 text-white shadow-lg shadow-red-600/30 ring-1 ring-red-500'
                : 'bg-zinc-900/90 text-zinc-400 hover:text-white border border-zinc-800'
            }`}
          >
            Camisetas &amp; Oversized
          </button>
          {hasHoodies && (
            <button
              type="button"
              onClick={() => setActiveTab('hoodies')}
              className={`px-4 py-2 rounded-md text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
                activeTab === 'hoodies'
                  ? 'bg-red-600 text-white shadow-lg shadow-red-600/30 ring-1 ring-red-500'
                  : 'bg-zinc-900/90 text-zinc-400 hover:text-white border border-zinc-800'
              }`}
            >
              Moletons &amp; Jaquetas
            </button>
          )}
        </div>
      </div>

      {/* Added to cart toast notice */}
      {addedNotice && (
        <div className="fixed bottom-6 right-6 z-50 bg-emerald-950 border border-emerald-500/50 text-emerald-100 px-4 py-3 rounded-xl shadow-2xl flex items-center gap-3 animate-in fade-in slide-in-from-bottom-5">
          <CheckCircle2 className="w-5 h-5 text-emerald-400" />
          <span className="text-xs font-bold">{addedNotice}</span>
        </div>
      )}

      {/* The Clothing Rail Hero Component backed by real catalog products */}
      <div className="w-full relative">
        <ClothingRailHero
          items={filteredItems}
          hanger="wood"
          autoplay={false}
          labels={{
            front: 'Frente',
            back: 'Costas',
            close: 'Fechar',
            show: 'Ver Peça',
          }}
          caption="Toque ou arraste qualquer cabide para escolher sua peça"
          renderDetailAction={(garment, _index, closeModal) => {
            const matchedItem = filteredItems.find((fi) => fi.id === garment.id);
            if (!matchedItem) return null;
            return (
              <>
                <button
                  type="button"
                  onClick={() => handleOpenCatalogItem(matchedItem, closeModal)}
                  className="inline-flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs font-bold uppercase tracking-wider text-white transition-colors hover:border-zinc-500 hover:bg-zinc-800 cursor-pointer"
                >
                  <Eye className="w-3.5 h-3.5" />
                  Ver Produto ({matchedItem.priceFormatted})
                </button>
                <button
                  type="button"
                  onClick={() => handleQuickBuy(matchedItem, closeModal)}
                  className="inline-flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-xs font-bold uppercase tracking-wider text-white shadow-md shadow-red-600/25 transition-colors hover:bg-red-500 cursor-pointer"
                >
                  <ShoppingBag className="w-3.5 h-3.5" />
                  Adicionar ao Carrinho
                </button>
              </>
            );
          }}
          action={
            <div className="flex flex-wrap items-center justify-center gap-3 mt-2">
              <button
                type="button"
                onClick={onExploreCatalog}
                className="inline-flex items-center gap-2 rounded-md bg-red-600 px-6 py-2.5 text-xs font-bold uppercase tracking-wider text-white shadow-lg shadow-red-600/30 transition-all hover:bg-red-500 active:scale-95 cursor-pointer"
              >
                <ShoppingBag className="w-4 h-4" />
                Explorar Catálogo Completo
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          }
        />
      </div>

      {/* Bottom Hint Banner */}
      <div className="max-w-4xl mx-auto px-4 mt-8">
        <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-zinc-900/60 border border-zinc-800 text-xs text-zinc-400">
          <div className="flex items-center gap-2">
            <RotateCw className="w-4 h-4 text-red-500 animate-spin [animation-duration:8s]" />
            <span>
              <strong>Dica de Interação:</strong> Arraste o mouse horizontalmente para simular o deslize físico dos cabides na loja física de Itabira.
            </span>
          </div>
          <button
            type="button"
            onClick={onExploreCatalog}
            className="text-red-400 hover:text-red-300 font-bold underline cursor-pointer"
          >
            Ver catálogo completo &rarr;
          </button>
        </div>
      </div>
    </section>
  );
};

export default StreetwearRailSection;
