import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  ShoppingBag,
  Truck,
  Ruler,
  Check,
  ShieldCheck,
  Database,
  ArrowRight,
  Crown,
  AlertCircle,
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  Maximize2
} from 'lucide-react';
import { Product } from '../types';
import { cleanDescription } from '../lib/cleanHtml';
import { getImagesForColor, sortSizes } from '../lib/catalogVariants';
import { calculateShippingQuotes, ShippingOption } from '../services/shipping';
import { ProductImage } from './ProductImage';

interface ProductModalProps {
  product: Product | null;
  isOpen: boolean;
  initialColor?: string;
  isFavorited?: boolean;
  onToggleFavorite?: (productId: string) => void;
  onClose: () => void;
  onAddToCart: (product: Product, size: string, color: string, quantity: number) => void;
  onBuyNow: (product: Product, size: string, color: string, quantity: number) => void;
}

export function ProductModal({
  product,
  isOpen,
  initialColor,
  isFavorited = false,
  onToggleFavorite,
  onClose,
  onAddToCart,
  onBuyNow
}: ProductModalProps) {
  // Declare all hooks unconditionally at the top of the component (Rules of Hooks)
  const [selectedImage, setSelectedImage] = useState(0);
  const [selectedSize, setSelectedSize] = useState(product?.sizes?.[0] || 'Tamanho Único');
  const [selectedColor, setSelectedColor] = useState(initialColor || product?.colors?.[0]?.name || 'Cor Única');
  const [quantity, setQuantity] = useState(1);
  const [showSizeGuide, setShowSizeGuide] = useState(false);
  const [showIntegrationDetails, setShowIntegrationDetails] = useState(false);

  // Hover zoom & Fullscreen Lightbox state
  const [isHoverZooming, setIsHoverZooming] = useState(false);
  const [zoomOrigin, setZoomOrigin] = useState({ x: 50, y: 50 });
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [isLightboxZoomed, setIsLightboxZoomed] = useState(false);
  const [lightboxZoomOrigin, setLightboxZoomOrigin] = useState({ x: 50, y: 50 });

  // CEP simulator state
  const [cep, setCep] = useState('');
  const [shippingCalculated, setShippingCalculated] = useState(false);
  const [shippingLoading, setShippingLoading] = useState(false);
  const [shippingOptions, setShippingOptions] = useState<ShippingOption[]>([]);

  const inStockVariants = useMemo(() => {
    if (!product?.variantsList || product.variantsList.length === 0) return [];
    return product.variantsList.filter((v) => v.stock > 0);
  }, [product]);

  const selectableColors = useMemo(() => {
    if (!product) return [];
    const baseColors = product.colors?.length ? product.colors : [{ name: 'Cor Única', hex: '#1C1C1C' }];
    const hasVariantColors = inStockVariants.some((v) => Boolean(v.color));
    if (!hasVariantColors) return baseColors;
    const activeColorSet = new Set(inStockVariants.map((v) => (v.color || '').toLowerCase()).filter(Boolean));
    const filtered = baseColors.filter((c) => activeColorSet.has(c.name.toLowerCase()));
    return filtered.length > 0 ? filtered : baseColors;
  }, [product, inStockVariants]);

  const galleryImages = useMemo(() => {
    if (!product) return [];
    const pool: string[] = [];
    const pushUrl = (u?: string) => {
      const clean = typeof u === 'string' ? u.trim() : '';
      if (!clean || pool.includes(clean)) return;
      pool.push(clean);
    };

    for (const img of product.images || []) pushUrl(img);
    if (product.colorImages && typeof product.colorImages === 'object') {
      for (const urls of Object.values(product.colorImages)) {
        if (Array.isArray(urls)) {
          for (const img of urls) pushUrl(img);
        }
      }
    }
    for (const v of product.variantsList || []) {
      if (v.image) pushUrl(v.image);
    }

    const real = pool.filter((u) => !u.includes('streetstore-fallback'));
    return real.length > 0 ? real : pool;
  }, [product]);

  const selectableSizes = useMemo(() => {
    if (!product) return [];
    if (inStockVariants.length > 0) {
      const hasVariantColors = inStockVariants.some((v) => Boolean(v.color));
      const matchingColorVariants =
        hasVariantColors && selectableColors.length > 1 && selectedColor
          ? inStockVariants.filter((v) => (v.color || '').toLowerCase() === selectedColor.toLowerCase())
          : inStockVariants;
      const pool = matchingColorVariants.length > 0 ? matchingColorVariants : inStockVariants;
      const fromVars = sortSizes(pool.map((v) => v.size || '').filter(Boolean));
      if (fromVars.length > 0) return fromVars;
    }
    if (product.variantsList && product.variantsList.length > 0) {
      return [];
    }
    return product.sizes?.length ? sortSizes(product.sizes) : ['Tamanho Único'];
  }, [product, inStockVariants, selectableColors.length, selectedColor]);

  const selectedVariantStock = useMemo(() => {
    if (!product) return 0;
    if (inStockVariants.length > 0) {
      const exact = inStockVariants.find(
        (v) =>
          (v.size || '').toLowerCase() === selectedSize.toLowerCase() &&
          (!v.color || v.color.toLowerCase() === selectedColor.toLowerCase())
      ) || inStockVariants.find((v) => (v.size || '').toLowerCase() === selectedSize.toLowerCase());
      if (exact) return exact.stock;
    }
    return product.stockCount ?? 0;
  }, [product, inStockVariants, selectedSize, selectedColor]);

  const resolveImageIndexForColor = (colorName: string): number => {
    if (!product || galleryImages.length === 0) return 0;
    const colorImgs = getImagesForColor(product, colorName);
    for (const url of colorImgs) {
      const idx = galleryImages.indexOf(url);
      if (idx >= 0) return idx;
    }
    return 0;
  };

  // Synchronize selection whenever active product or initialColor changes
  useEffect(() => {
    if (product) {
      const matchedInitial =
        initialColor &&
        selectableColors.find((c) => c.name.toLowerCase() === initialColor.toLowerCase())?.name;
      const nextColor = matchedInitial || selectableColors[0]?.name || product.colors?.[0]?.name || 'Cor Única';
      setSelectedColor(nextColor);
      setSelectedSize(selectableSizes[0] || product.sizes?.[0] || 'Tamanho Único');
      setSelectedImage(resolveImageIndexForColor(nextColor));
      setShowSizeGuide(false);
      setQuantity(1);
      setIsLightboxOpen(false);
      setIsLightboxZoomed(false);
      setIsHoverZooming(false);
    }
  }, [product?.id, initialColor]);

  // Keep selectedSize and quantity valid when color or available sizes update
  useEffect(() => {
    if (selectableSizes.length > 0 && !selectableSizes.includes(selectedSize)) {
      setSelectedSize(selectableSizes[0]);
    }
  }, [selectableSizes, selectedSize]);

  useEffect(() => {
    if (selectedVariantStock > 0 && quantity > selectedVariantStock) {
      setQuantity(selectedVariantStock);
    }
  }, [selectedVariantStock, quantity]);

  // Keyboard navigation for Lightbox and modal close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isLightboxOpen) {
          setIsLightboxOpen(false);
          setIsLightboxZoomed(false);
        } else {
          onClose();
        }
      } else if (isLightboxOpen && galleryImages.length > 1) {
        if (e.key === 'ArrowRight') {
          setSelectedImage((prev) => (prev + 1) % galleryImages.length);
          setIsLightboxZoomed(false);
        } else if (e.key === 'ArrowLeft') {
          setSelectedImage((prev) => (prev - 1 + galleryImages.length) % galleryImages.length);
          setIsLightboxZoomed(false);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isLightboxOpen, galleryImages.length, onClose]);

  // Early return only AFTER all hooks are declared
  if (!product || !isOpen) return null;

  const isUniqueSize = selectableSizes.length <= 1 && (
    selectableSizes.length === 0 ||
    selectableSizes[0] === 'Tamanho Único' ||
    selectableSizes[0] === 'Único' ||
    selectableSizes[0] === 'Ajustável'
  );

  const isSingleColor = selectableColors.length <= 1;
  const isOutOfStock = (product.stockCount ?? 0) <= 0 || selectableSizes.length === 0;
  const activeImageSrc = galleryImages[selectedImage] || galleryImages[0] || product.images[0];

  const handleSelectColor = (colorName: string) => {
    setSelectedColor(colorName);
    const matchingIdx = resolveImageIndexForColor(colorName);
    setSelectedImage(matchingIdx);
  };

  const handleMainImageMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
    setZoomOrigin({ x, y });
  };

  const handleLightboxMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isLightboxZoomed) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
    setLightboxZoomOrigin({ x, y });
  };

  const handleSimulateShipping = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCep = cep.replace(/\D/g, '');
    if (cleanCep.length < 8) return;
    setShippingLoading(true);
    try {
      const res = await calculateShippingQuotes({
        cep: cleanCep,
        cartTotal: product.price,
        items: [{
          id: product.id,
          price: product.price,
          quantity,
          weight: (product.integration?.weightGrams || 350) / 1000
        }]
      });
      if (res && res.options && res.options.length > 0) {
        setShippingOptions(res.options);
      }
      setShippingCalculated(true);
    } catch {
      setShippingCalculated(true);
    } finally {
      setShippingLoading(false);
    }
  };

  const installments = (product.price / 6).toFixed(2).replace('.', ',');
  const cleanedDescription = cleanDescription(product.description);

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-6"
      onClick={onClose}
    >
      {/* Modal Dialog Card */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        transition={{ duration: 0.2 }}
        className="relative w-full max-w-4xl bg-[#121212] border border-[#262626] rounded-2xl shadow-2xl overflow-hidden my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Favorite Crown Button */}
        <button
          onClick={() => {
            if (onToggleFavorite) onToggleFavorite(product.id);
          }}
          aria-label={isFavorited ? 'Remover dos favoritos' : 'Favoritar produto com a coroa'}
          title={isFavorited ? 'Peça coroada nos favoritos' : 'Coroar peça favorita'}
          className={`absolute top-4 right-16 z-20 p-2 rounded-full backdrop-blur-md transition-all duration-200 cursor-pointer ${
            isFavorited
              ? 'bg-yellow-400/25 text-yellow-400 border border-yellow-400/70 scale-105 shadow-[0_0_14px_rgba(250,204,21,0.6)]'
              : 'bg-black/60 text-zinc-400 hover:text-yellow-400 hover:bg-black/90 border border-zinc-700'
          }`}
        >
          <Crown className={`w-5 h-5 transition-transform ${isFavorited ? 'fill-yellow-400 scale-105' : ''}`} />
        </button>

        {/* Close Button */}
        <button
          onClick={onClose}
          aria-label="Fechar detalhes do produto"
          className="absolute top-4 right-4 z-20 p-2 text-zinc-400 hover:text-white bg-black/60 hover:bg-black rounded-full transition-colors border border-zinc-700 cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="grid grid-cols-1 md:grid-cols-2">
          {/* Left Column: Gallery with Hover Loupe Zoom & Click Lightbox */}
          <div className="p-4 sm:p-6 bg-zinc-950 flex flex-col justify-between border-b md:border-b-0 md:border-r border-[#262626]">
            <div>
              {/* Main Active Image with Hover Zoom + Click to Enlarge */}
              <div
                onMouseEnter={(e) => {
                  if (window.matchMedia('(pointer: fine)').matches) {
                    handleMainImageMouseMove(e);
                    setIsHoverZooming(true);
                  }
                }}
                onMouseMove={(e) => {
                  if (isHoverZooming) handleMainImageMouseMove(e);
                }}
                onMouseLeave={() => setIsHoverZooming(false)}
                onClick={() => {
                  setIsLightboxZoomed(false);
                  setIsLightboxOpen(true);
                }}
                role="button"
                tabIndex={0}
                aria-label="Ampliar imagem do produto"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setIsLightboxZoomed(false);
                    setIsLightboxOpen(true);
                  }
                }}
                className="group/img relative aspect-square w-full rounded-xl overflow-hidden bg-[#181818] border border-zinc-800 cursor-zoom-in select-none"
              >
                <div
                  className="w-full h-full transition-transform duration-150 ease-out will-change-transform"
                  style={{
                    transform: isHoverZooming ? 'scale(2.05)' : 'scale(1)',
                    transformOrigin: `${zoomOrigin.x}% ${zoomOrigin.y}%`,
                  }}
                >
                  <ProductImage
                    src={activeImageSrc}
                    candidates={galleryImages}
                    alt={`${product.name}${selectedColor && selectedColor !== 'Cor Única' ? ` - ${selectedColor}` : ''}`}
                    loading="eager"
                    className="w-full h-full object-cover object-center"
                  />
                </div>

                {product.tag && (
                  <span className="absolute top-3 left-3 z-10 bg-[#E50914] text-white text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded pointer-events-none">
                    {product.tag}
                  </span>
                )}

                {/* Subtle Zoom / Lightbox Affordance Hint */}
                <span className="absolute bottom-3 right-3 z-10 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-black/75 border border-zinc-700/80 text-[10px] font-bold text-zinc-200 backdrop-blur-sm opacity-90 group-hover/img:opacity-100 transition-opacity pointer-events-none">
                  <Maximize2 className="w-3 h-3 text-[#E50914]" />
                  <span>Ampliar</span>
                </span>
              </div>

              {/* Thumbnails Row */}
              {galleryImages.length > 1 && (
                <div className="flex items-center gap-3 mt-4 overflow-x-auto no-scrollbar">
                  {galleryImages.map((img, idx) => (
                    <button
                      key={`${img}-${idx}`}
                      type="button"
                      onClick={() => setSelectedImage(idx)}
                      className={`relative w-16 h-16 rounded-lg overflow-hidden border-2 transition-all shrink-0 cursor-pointer ${
                        selectedImage === idx
                          ? 'border-[#E50914] scale-105'
                          : 'border-zinc-800 opacity-60 hover:opacity-100'
                      }`}
                    >
                      <ProductImage src={img} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Model & Origin Notice */}
            <div className="mt-4 pt-4 border-t border-zinc-800/80 text-xs text-zinc-400 space-y-1">
              <p><strong className="text-zinc-300">Caimento:</strong> {product.details.modelInfo}</p>
              <p><strong className="text-zinc-300">Origem:</strong> {product.details.origin}</p>
            </div>
          </div>

          {/* Right Column: Purchase Options on TOP -> Description at BOTTOM */}
          <div className="p-6 flex flex-col justify-between space-y-5 max-h-[85vh] overflow-y-auto">
            {/* 1. Header info & Price */}
            <div>
              <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-zinc-400 font-bold mb-1">
                <span className="text-[#E50914]">{product.category}</span>
                <span>/</span>
                <span>{product.subcategory}</span>
                <span>/</span>
                <span>SKU: {product.integration.sku}</span>
              </div>

              <h2 className="text-2xl font-black text-white font-display leading-tight">
                {product.name}
              </h2>

              {/* Price & Installments */}
              <div className="mt-3 flex items-baseline gap-3">
                <span className="text-2xl sm:text-3xl font-extrabold text-white tabular-nums">
                  R$ {product.price.toFixed(2).replace('.', ',')}
                </span>
                {product.originalPrice > product.price && (
                  <span className="text-sm text-zinc-500 line-through tabular-nums">
                    R$ {product.originalPrice.toFixed(2).replace('.', ',')}
                  </span>
                )}
                <span className="text-xs text-green-400 font-bold bg-green-950/60 px-2 py-0.5 rounded border border-green-800/60">
                  5% OFF no PIX
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-1">
                ou em até <strong className="text-zinc-200">6x de R$ {installments}</strong> sem juros no cartão
              </p>

              {/* Stock Indicator */}
              <div className="mt-3">
                {isOutOfStock ? (
                  <div className="p-3.5 rounded-xl bg-red-950/40 border border-red-800/60 text-xs space-y-1.5 shadow-md">
                    <div className="flex items-center gap-2 text-[#E50914] font-black uppercase tracking-wider font-oswald text-sm">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>PRODUTO ESGOTADO / SEM ESTOQUE</span>
                    </div>
                    <p className="text-zinc-300 leading-relaxed text-[11px]">
                      Esta peça está sem estoque no momento. Assim que novas unidades forem repostas, ela ficará disponível para compra novamente aqui na loja.
                    </p>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-xs">
                    <span className={`w-2 h-2 rounded-full ${selectedVariantStock <= 4 ? 'bg-amber-400' : 'bg-green-500'}`} />
                    <span className="text-zinc-300 font-medium">
                      {selectedVariantStock <= 4
                        ? isUniqueSize
                          ? `Apenas ${selectedVariantStock} ${selectedVariantStock === 1 ? 'unidade restante' : 'unidades restantes'} no estoque!`
                          : `Apenas ${selectedVariantStock} ${selectedVariantStock === 1 ? 'unidade disponível' : 'unidades disponíveis'} no tamanho ${selectedSize}!`
                        : `Estoque disponível para envio imediato.`}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* 2. Color Selector (switches image immediately on click) */}
            {isSingleColor ? (
              <div className="space-y-1.5 border-t border-zinc-800/80 pt-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-zinc-300">
                    Cor:
                  </span>
                  <span className="text-[10px] font-bold text-zinc-400 bg-zinc-900 border border-zinc-800 px-2 py-0.5 rounded tracking-wide uppercase">
                    {(selectableColors[0]?.name || 'Cor Única') === 'Cor Única' ? 'Modelo Exclusivo' : 'Cor Única'}
                  </span>
                </div>
                <div className="inline-flex items-center gap-2.5 px-3.5 py-2 rounded-lg bg-zinc-900/90 border border-zinc-700/80 text-xs font-medium text-white shadow-xs">
                  <span
                    className="w-3.5 h-3.5 rounded-full border border-zinc-600 shrink-0"
                    style={{ backgroundColor: selectableColors[0]?.hex || '#1C1C1C' }}
                  />
                  <span className="font-semibold">{selectableColors[0]?.name || 'Cor Única'}</span>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                </div>
              </div>
            ) : (
              <div className="space-y-2 border-t border-zinc-800/80 pt-3">
                <span className="text-xs font-bold uppercase tracking-wider text-zinc-200 block">
                  Cor: <strong className="text-white">{selectedColor}</strong>
                </span>
                <div className="flex flex-wrap items-center gap-2.5">
                  {selectableColors.map((c) => (
                    <button
                      key={c.name}
                      type="button"
                      onClick={() => handleSelectColor(c.name)}
                      title={c.name}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                        selectedColor === c.name
                          ? 'border-[#E50914] bg-zinc-800 text-white shadow-sm shadow-red-950/40'
                          : 'border-zinc-800 bg-[#161616] text-zinc-400 hover:text-white hover:border-zinc-700'
                      }`}
                    >
                      <span
                        className="w-3.5 h-3.5 rounded-full border border-zinc-600 shrink-0"
                        style={{ backgroundColor: c.hex }}
                      />
                      <span>{c.name}</span>
                      {selectedColor === c.name && <Check className="w-3.5 h-3.5 text-[#E50914]" />}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 3. Size Selector */}
            {isUniqueSize ? (
              <div className="space-y-1.5 border-t border-zinc-800/80 pt-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-zinc-300">
                    Tamanho:
                  </span>
                  <span className="text-[10px] font-bold text-zinc-400 bg-zinc-900 border border-zinc-800 px-2 py-0.5 rounded tracking-wide uppercase">
                    {product.category === 'acessorios' ? 'Acessório // Tamanho Único' : 'Tamanho Único'}
                  </span>
                </div>
                <div className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-zinc-900/90 border border-zinc-700/80 text-xs font-bold text-white shadow-xs">
                  <span>{selectableSizes[0] || 'Tamanho Único'}</span>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                </div>
              </div>
            ) : (
              <div className="space-y-2 border-t border-zinc-800/80 pt-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-zinc-200">
                    Tamanho: <strong className="text-white">{selectedSize}</strong>
                  </span>
                  {product.category === 'roupas' && (
                    <button
                      type="button"
                      onClick={() => setShowSizeGuide(!showSizeGuide)}
                      className="text-xs text-[#E50914] hover:underline flex items-center gap-1 font-semibold cursor-pointer"
                    >
                      <Ruler className="w-3.5 h-3.5" />
                      <span>Guia de Medidas</span>
                    </button>
                  )}
                </div>

                {/* Sizes Buttons (Strictly in-stock sizes only) */}
                <div className="flex flex-wrap gap-2">
                  {selectableSizes.map((sz) => (
                    <button
                      key={sz}
                      type="button"
                      onClick={() => setSelectedSize(sz)}
                      className={`px-3.5 py-2 text-xs font-bold rounded-lg border transition-all cursor-pointer ${
                        selectedSize === sz
                          ? 'bg-[#E50914] text-white border-[#E50914] shadow-md shadow-red-950/60'
                          : 'bg-[#181818] text-zinc-300 border-zinc-700 hover:border-zinc-500'
                      }`}
                    >
                      {sz}
                    </button>
                  ))}
                </div>

                {/* Size Guide Drawer Dropdown (Only for clothing) */}
                <AnimatePresence>
                  {showSizeGuide && product.category === 'roupas' && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden bg-[#181818] border border-zinc-700 rounded-lg p-3 text-xs space-y-2"
                    >
                      <p className="font-bold text-white uppercase tracking-wider">Tabela de Medidas (Centímetros)</p>
                      <div className="grid grid-cols-4 gap-2 text-center text-[11px] text-zinc-400 border-t border-zinc-800 pt-2">
                        <span className="font-bold text-zinc-300">Tamanho</span>
                        <span className="font-bold text-zinc-300">Tórax</span>
                        <span className="font-bold text-zinc-300">Comp.</span>
                        <span className="font-bold text-zinc-300">Manga</span>
                        <span>P</span><span>58 cm</span><span>72 cm</span><span>24 cm</span>
                        <span>M</span><span>60 cm</span><span>74 cm</span><span>25 cm</span>
                        <span>G</span><span>63 cm</span><span>77 cm</span><span>26 cm</span>
                        <span>GG</span><span>66 cm</span><span>80 cm</span><span>27 cm</span>
                      </div>
                      <p className="text-[10px] text-zinc-400 italic">
                        *Modelagem Streetwear Boxy (ombros caídos e tronco reto).
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* 4. Quantity Selector */}
            <div className="flex items-center gap-4">
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-200">
                Quantidade:
              </span>
              <div className={`flex items-center bg-[#181818] border border-zinc-700 rounded-lg overflow-hidden ${isOutOfStock ? 'opacity-40 cursor-not-allowed' : ''}`}>
                <button
                  type="button"
                  disabled={isOutOfStock}
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  className="px-3 py-1.5 text-zinc-400 hover:text-white hover:bg-zinc-800 disabled:cursor-not-allowed cursor-pointer"
                >
                  -
                </button>
                <span className="px-4 py-1.5 text-xs font-bold text-white tabular-nums">
                  {isOutOfStock ? 0 : quantity}
                </span>
                <button
                  type="button"
                  disabled={isOutOfStock || quantity >= selectedVariantStock}
                  onClick={() => setQuantity(Math.min(Math.max(1, selectedVariantStock), quantity + 1))}
                  className="px-3 py-1.5 text-zinc-400 hover:text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
                >
                  +
                </button>
              </div>
              {isOutOfStock && (
                <span className="text-[11px] font-bold text-red-400 uppercase tracking-wide">
                  0 no estoque
                </span>
              )}
            </div>

            {/* 5. Primary Action Buttons */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <button
                type="button"
                disabled={isOutOfStock}
                onClick={() => {
                  if (isOutOfStock) return;
                  onAddToCart(product, selectedSize, selectedColor, quantity);
                }}
                className={`py-3 px-4 rounded-xl border font-bold text-xs uppercase tracking-wider transition-all duration-150 flex items-center justify-center gap-2 ${
                  isOutOfStock
                    ? 'bg-zinc-900/60 border-zinc-800 text-zinc-500 cursor-not-allowed opacity-60'
                    : 'bg-zinc-900 hover:bg-zinc-800 text-white border-zinc-700 active:scale-95 cursor-pointer'
                }`}
              >
                <ShoppingBag className="w-4 h-4" />
                <span>{isOutOfStock ? 'Sem Estoque' : 'Adicionar ao Carrinho'}</span>
              </button>

              <button
                type="button"
                disabled={isOutOfStock}
                onClick={() => {
                  if (isOutOfStock) return;
                  onBuyNow(product, selectedSize, selectedColor, quantity);
                }}
                className={`py-3 px-4 rounded-xl font-black text-xs uppercase tracking-wider transition-all duration-150 flex items-center justify-center gap-2 ${
                  isOutOfStock
                    ? 'bg-zinc-800 text-zinc-500 border border-zinc-700 cursor-not-allowed opacity-60'
                    : 'bg-[#E50914] hover:bg-[#c90812] text-white active:scale-95 shadow-lg shadow-red-950/60 cursor-pointer'
                }`}
              >
                <span>{isOutOfStock ? 'Esgotado no Momento' : 'Comprar Agora'}</span>
                {!isOutOfStock && <ArrowRight className="w-4 h-4" />}
              </button>
            </div>

            {/* 6. Frete Simulator */}
            <div className="p-3 rounded-xl bg-[#161616] border border-zinc-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-zinc-200 flex items-center gap-1.5 uppercase">
                  <Truck className="w-3.5 h-3.5 text-[#E50914]" />
                  <span>Calcular Frete e Prazo</span>
                </span>
                <span className="text-[10px] text-zinc-500">Ex: 35900-000</span>
              </div>
              <form onSubmit={handleSimulateShipping} className="flex gap-2">
                <input
                  type="text"
                  maxLength={9}
                  value={cep}
                  onChange={(e) => setCep(e.target.value.replace(/\D/g, ''))}
                  placeholder="Digite seu CEP"
                  className="flex-1 bg-black/60 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-[#E50914]"
                />
                <button
                  type="submit"
                  disabled={shippingLoading}
                  className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer"
                >
                  {shippingLoading ? 'Calculando...' : 'Calcular'}
                </button>
              </form>

              {shippingCalculated && (
                <div className="mt-2 space-y-1.5 pt-2 border-t border-zinc-800 text-[11px]">
                  {shippingOptions.length > 0 ? (
                    shippingOptions.slice(0, 4).map((opt) => (
                      <div key={opt.id} className="flex items-center justify-between text-zinc-300 py-0.5">
                        <div className="flex items-center gap-1.5">
                          {opt.company?.picture && (
                            <img src={opt.company.picture} alt={opt.company.name} loading="lazy" decoding="async" className="w-3.5 h-3.5 object-contain" />
                          )}
                          <span className="font-medium text-white">{opt.company?.name} {opt.name}</span>
                          <span className="text-[10px] text-zinc-500">({opt.deliveryText})</span>
                        </div>
                        <strong className="text-emerald-400 font-bold">{opt.priceFormatted}</strong>
                      </div>
                    ))
                  ) : (
                    <>
                      <div className="flex items-center justify-between text-zinc-300">
                        <span>Sedex Expresso (1 a 2 dias úteis)</span>
                        <strong className="text-white">R$ 18,90</strong>
                      </div>
                      <div className="flex items-center justify-between text-zinc-300">
                        <span>Correios PAC (3 a 5 dias úteis)</span>
                        <strong className="text-emerald-400">R$ 12,50</strong>
                      </div>
                    </>
                  )}
                  <div className="flex items-center justify-between text-zinc-300 pt-1 border-t border-zinc-800/60">
                    <span className="text-zinc-400">Retirada Loja Física (Av. João Pinheiro, 353 - Centro, Itabira)</span>
                    <strong className="text-emerald-400 font-bold">Grátis (Em 2h)</strong>
                  </div>
                </div>
              )}
            </div>

            {/* 7. Product Description (Moved to the bottom, below purchase & shipping controls) */}
            {cleanedDescription && (
              <div className="border-t border-zinc-800/80 pt-4 space-y-1.5">
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-200">
                  Descrição do Produto
                </h3>
                <div className="text-xs sm:text-sm text-zinc-300 leading-relaxed whitespace-pre-line">
                  {cleanedDescription}
                </div>
              </div>
            )}

            {/* 8. Technical Specifications Accordion */}
            <div className="pt-2 border-t border-zinc-800/80">
              <button
                type="button"
                onClick={() => setShowIntegrationDetails(!showIntegrationDetails)}
                className="text-[11px] text-zinc-500 hover:text-zinc-300 flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Database className="w-3 h-3 text-zinc-400" />
                <span>Ficha Técnica e Logística de Envio</span>
              </button>

              <AnimatePresence>
                {showIntegrationDetails && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden mt-2 p-2.5 rounded-lg bg-zinc-950 border border-zinc-800 text-[10px] font-mono text-zinc-400 space-y-1"
                  >
                    <div><span className="text-zinc-500">Código da Peça:</span> {product.integration.sku}</div>
                    <div><span className="text-zinc-500">Código de Barras (EAN):</span> {product.integration.barcode}</div>
                    <div><span className="text-zinc-500">Dimensões p/ Embalagem:</span> {product.integration.dimensionsCm.width}x{product.integration.dimensionsCm.height}x{product.integration.dimensionsCm.depth} cm</div>
                    <div><span className="text-zinc-500">Peso Estimado:</span> {product.integration.weightGrams}g</div>
                    <div className="text-green-400 text-[9px] pt-1">● Peça autenticada Street Store Oficial</div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Trust Footer */}
            <div className="flex items-center justify-between text-[11px] text-zinc-400 pt-2 border-t border-zinc-900">
              <span className="flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-green-400" /> 100% Original Autêntico
              </span>
              <span>Troca grátis em 7 dias</span>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Fullscreen Lightbox Modal (Click image to enlarge) */}
      <AnimatePresence>
        {isLightboxOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={(e) => {
              e.stopPropagation();
              setIsLightboxOpen(false);
              setIsLightboxZoomed(false);
            }}
            className="fixed inset-0 z-[70] bg-black/95 backdrop-blur-md flex flex-col items-center justify-center p-4 sm:p-8"
          >
            {/* Lightbox Top Controls */}
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-5xl flex items-center justify-between mb-3 px-1"
            >
              <span className="text-xs sm:text-sm font-bold text-zinc-200 truncate pr-4">
                {product.name}
                {selectedColor && selectedColor !== 'Cor Única' ? ` · ${selectedColor}` : ''}
              </span>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsLightboxZoomed((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-xs font-bold text-white transition-colors cursor-pointer"
                >
                  {isLightboxZoomed ? <ZoomOut className="w-4 h-4" /> : <ZoomIn className="w-4 h-4" />}
                  <span>{isLightboxZoomed ? 'Reduzir' : 'Zoom 2x'}</span>
                </button>
                <button
                  type="button"
                  aria-label="Fechar visualização ampliada"
                  onClick={() => {
                    setIsLightboxOpen(false);
                    setIsLightboxZoomed(false);
                  }}
                  className="p-2 rounded-full bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-200 hover:text-white transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Lightbox Image Stage */}
            <div
              onClick={(e) => {
                e.stopPropagation();
                setIsLightboxZoomed((prev) => !prev);
              }}
              onMouseMove={handleLightboxMouseMove}
              className={`relative max-w-5xl max-h-[76vh] w-full flex items-center justify-center overflow-hidden rounded-2xl bg-[#0D0D0D] border border-zinc-800 ${
                isLightboxZoomed ? 'cursor-zoom-out' : 'cursor-zoom-in'
              }`}
            >
              {galleryImages.length > 1 && (
                <button
                  type="button"
                  aria-label="Imagem anterior"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedImage((prev) => (prev - 1 + galleryImages.length) % galleryImages.length);
                    setIsLightboxZoomed(false);
                  }}
                  className="absolute left-3 z-20 p-2.5 rounded-full bg-black/75 hover:bg-black border border-zinc-700 text-white transition-colors cursor-pointer"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
              )}

              <div
                className="flex items-center justify-center transition-transform duration-200 ease-out"
                style={{
                  transform: isLightboxZoomed ? 'scale(2)' : 'scale(1)',
                  transformOrigin: `${lightboxZoomOrigin.x}% ${lightboxZoomOrigin.y}%`,
                }}
              >
                <ProductImage
                  src={activeImageSrc}
                  candidates={galleryImages}
                  alt={product.name}
                  loading="eager"
                  className="max-h-[74vh] max-w-full w-auto object-contain select-none"
                />
              </div>

              {galleryImages.length > 1 && (
                <button
                  type="button"
                  aria-label="Próxima imagem"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedImage((prev) => (prev + 1) % galleryImages.length);
                    setIsLightboxZoomed(false);
                  }}
                  className="absolute right-3 z-20 p-2.5 rounded-full bg-black/75 hover:bg-black border border-zinc-700 text-white transition-colors cursor-pointer"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              )}
            </div>

            {/* Lightbox Bottom Thumbnails */}
            {galleryImages.length > 1 && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-2.5 mt-4 overflow-x-auto max-w-full px-2"
              >
                {galleryImages.map((img, idx) => (
                  <button
                    key={`lb-${img}-${idx}`}
                    type="button"
                    onClick={() => {
                      setSelectedImage(idx);
                      setIsLightboxZoomed(false);
                    }}
                    className={`w-14 h-14 rounded-lg overflow-hidden border-2 transition-all shrink-0 cursor-pointer ${
                      selectedImage === idx
                        ? 'border-[#E50914] scale-105'
                        : 'border-zinc-800 opacity-60 hover:opacity-100'
                    }`}
                  >
                    <ProductImage src={img} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
