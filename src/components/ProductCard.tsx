import React, { useState, useMemo, useEffect } from 'react';
import { motion } from 'motion/react';
import { Eye, Plus, Crown } from 'lucide-react';
import { Product } from '../types';
import { ProductImage } from './ProductImage';
import { getImagesForColor } from '../lib/catalogVariants';

interface ProductCardProps {
  product: Product;
  isFavorited?: boolean;
  priority?: boolean;
  onToggleFavorite?: (productId: string) => void;
  onOpenDetails: (product: Product, initialColor?: string) => void;
  onQuickAdd: (product: Product, preferredColor?: string) => void;
}

export function ProductCard({
  product,
  isFavorited = false,
  priority = false,
  onToggleFavorite,
  onOpenDetails,
  onQuickAdd
}: ProductCardProps) {

  const visibleColors = useMemo(
    () => (product.colors || []).filter((c) => c?.name && c.name.toLowerCase() !== 'cor única'),
    [product.colors]
  );

  const [selectedColor, setSelectedColor] = useState<string>(
    () => visibleColors[0]?.name || product.colors?.[0]?.name || 'Cor Única'
  );

  useEffect(() => {
    setSelectedColor(visibleColors[0]?.name || product.colors?.[0]?.name || 'Cor Única');
  }, [product.id, visibleColors]);

  const activeImages = useMemo(() => {
    if (visibleColors.length > 0 && selectedColor) {
      const colorImgs = getImagesForColor(product, selectedColor);
      if (colorImgs.length > 0) return colorImgs;
    }
    return product.images;
  }, [product, visibleColors.length, selectedColor]);

  const primaryImage = activeImages[0] || product.images[0];

  const installments = (product.price / 6).toFixed(2).replace('.', ',');
  const isOutOfStock = (product.stockCount ?? 0) <= 0;

  return (
    <motion.div
      className={`group relative flex flex-col bg-[#121212] rounded-xl border shadow-md transition-all duration-300 overflow-hidden cursor-pointer hover:-translate-y-1 ${
        isOutOfStock
          ? 'border-zinc-800/80 hover:border-red-900/60 opacity-90'
          : 'border-[#222222] hover:border-[#E50914]/80 hover:shadow-[0_0_28px_rgba(229,9,20,0.35),0_0_8px_rgba(229,9,20,0.5),0_16px_32px_rgba(0,0,0,0.85)]'
      }`}
    >
      {/* Streetwear Neon Top Glow Line */}
      {!isOutOfStock && (
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[#E50914] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-30 pointer-events-none" />
      )}

      {/* Visual Image Container */}
      <div
        onClick={() => onOpenDetails(product, selectedColor)}
        className="relative aspect-square w-full overflow-hidden bg-[#141414] cursor-pointer"
      >
        <ProductImage
          src={primaryImage}
          candidates={activeImages}
          priority={priority}
          alt={product.name}
          className={`w-full h-full object-cover object-center group-hover:scale-[1.03] transition-transform duration-300 ease-out ${
            isOutOfStock ? 'grayscale-[40%] contrast-90' : ''
          }`}
        />

        {/* Overlay gradient */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

        {/* Out of Stock Darkened Overlay & Badge */}
        {isOutOfStock && (
          <div className="absolute inset-0 bg-black/65 flex flex-col items-center justify-center p-2 z-10 pointer-events-none">
            <div className="px-2.5 py-1 rounded-md bg-black/90 border border-red-700/80 text-[#E50914] font-black text-[10px] sm:text-xs uppercase tracking-widest shadow-xl text-center font-oswald">
              SEM ESTOQUE
            </div>
          </div>
        )}

        {/* Minimalist Editorial Tag */}
        {isOutOfStock ? (
          <div className="absolute top-2 left-2 sm:top-3 sm:left-3 z-10">
            <span className="text-[8px] sm:text-[10px] font-black uppercase tracking-wider px-2 py-0.5 sm:py-1 rounded bg-black/90 text-[#E50914] border border-red-800/80 shadow-md">
              ESGOTADO
            </span>
          </div>
        ) : product.tag ? (
          <div className="absolute top-2 left-2 sm:top-3 sm:left-3 z-10">
            <span className={`text-[8px] sm:text-[10px] font-black uppercase tracking-wider sm:tracking-widest px-1.5 sm:px-2.5 py-0.5 sm:py-1 rounded ${
              product.tag === 'POUCAS UNIDADES'
                ? 'bg-[#E50914] text-white'
                : product.tag === 'NOVO DROP'
                ? 'bg-white text-black'
                : 'bg-zinc-800 text-zinc-100 border border-zinc-700'
            }`}>
              {product.tag}
            </span>
          </div>
        ) : null}

        {/* Crown Favorite Button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (onToggleFavorite) onToggleFavorite(product.id);
          }}
          aria-label={isFavorited ? 'Remover dos favoritos' : 'Favoritar peça'}
          title={isFavorited ? 'Peça coroada nos favoritos' : 'Coroar peça favorita'}
          className={`absolute top-2 right-2 sm:top-3 sm:right-3 z-20 p-1.5 sm:p-2 rounded-full backdrop-blur-md transition-all duration-200 cursor-pointer ${
            isFavorited
              ? 'bg-yellow-400/25 text-yellow-400 border border-yellow-400/70 scale-110 shadow-[0_0_14px_rgba(250,204,21,0.6)]'
              : 'bg-black/70 text-zinc-400 hover:text-yellow-400 hover:bg-black/90 border border-zinc-700/80 hover:scale-110'
          }`}
        >
          <Crown className={`w-3.5 h-3.5 sm:w-4 sm:h-4 transition-transform ${isFavorited ? 'fill-yellow-400 scale-105' : ''}`} />
        </button>

        {/* Quick action hover trigger buttons (desktop) */}
        <div className="hidden sm:flex absolute bottom-3 left-3 right-3 items-center gap-2 opacity-0 group-hover:opacity-100 transition-all duration-200 translate-y-2 group-hover:translate-y-0 z-10">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenDetails(product, selectedColor);
            }}
            className="flex-1 py-2 px-3 rounded-lg bg-zinc-900/90 hover:bg-black text-white text-xs font-bold uppercase tracking-wider backdrop-blur-md border border-zinc-700 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Ver Detalhes</span>
          </button>

          {isOutOfStock ? (
            <button
              disabled
              title="Peça sem estoque no momento."
              className="p-2 rounded-lg bg-zinc-800/80 text-zinc-500 text-xs font-bold border border-zinc-700/60 cursor-not-allowed"
            >
              <Plus className="w-4 h-4 opacity-30" />
            </button>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onQuickAdd(product, selectedColor);
              }}
              title="Adicionar ao Carrinho"
              className="p-2 rounded-lg bg-[#E50914] hover:bg-[#c90812] text-white text-xs font-bold transition-colors cursor-pointer active:scale-95"
            >
              <Plus className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Card Content & Metadata */}
      <div className="p-2.5 sm:p-4 flex flex-col flex-1 justify-between space-y-2 sm:space-y-3">
        <div>
          {/* Subtle unboxed metadata */}
          <div className="flex items-center gap-1.5 text-[10px] sm:text-[11px] text-zinc-400 uppercase tracking-wider font-semibold truncate">
            <span>{product.category}</span>
            <span aria-hidden="true">·</span>
            <span>{product.details.weight.split(' ')[0]}</span>
          </div>

          <h3
            onClick={() => onOpenDetails(product, selectedColor)}
            className="text-xs sm:text-base font-bold text-white group-hover:text-[#E50914] transition-colors cursor-pointer mt-1 line-clamp-2 leading-tight sm:leading-snug"
          >
            {product.name}
          </h3>

          {/* Interactive Color Swatches when product has multiple colors */}
          {visibleColors.length > 1 && (
            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
              {visibleColors.slice(0, 6).map((c) => {
                const isSelected = selectedColor.toLowerCase() === c.name.toLowerCase();
                return (
                  <button
                    key={c.name}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedColor(c.name);
                    }}
                    title={`Cor: ${c.name}`}
                    aria-label={`Selecionar cor ${c.name}`}
                    className={`w-4 h-4 sm:w-4.5 sm:h-4.5 rounded-full border transition-all cursor-pointer ${
                      isSelected
                        ? 'ring-2 ring-[#E50914] ring-offset-1 ring-offset-[#121212] border-white scale-110'
                        : 'border-zinc-600 hover:border-zinc-300 opacity-85 hover:opacity-100'
                    }`}
                    style={{ backgroundColor: c.hex }}
                  />
                );
              })}
              {visibleColors.length > 6 && (
                <span className="text-[10px] text-zinc-400 font-semibold">
                  +{visibleColors.length - 6}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Price & Installments Module */}
        <div className="pt-2 border-t border-[#222222] flex items-end justify-between gap-1.5">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-1.5 flex-wrap">
              <span className={`text-sm sm:text-lg font-bold tabular-nums ${isOutOfStock ? 'text-zinc-400' : 'text-white'}`}>
                R$ {product.price.toFixed(2).replace('.', ',')}
              </span>
              {product.originalPrice > product.price && (
                <span className="text-[10px] sm:text-xs text-zinc-500 line-through tabular-nums">
                  R$ {product.originalPrice.toFixed(2).replace('.', ',')}
                </span>
              )}
            </div>
            {isOutOfStock ? (
              <p className="text-[9px] sm:text-[10px] font-bold text-red-400 uppercase tracking-wide truncate mt-0.5">
                SEM ESTOQUE • AUTO RENOVÁVEL
              </p>
            ) : (
              <p className="text-[9px] sm:text-[11px] text-zinc-400 truncate mt-0.5">
                ou <span className="text-zinc-200 font-semibold">6x de R$ {installments}</span>
              </p>
            )}
          </div>

          {/* Touch-Friendly Quick Add Button for Mobile screens */}
          {isOutOfStock ? (
            <button
              disabled
              title="Peça sem estoque no momento"
              className="sm:hidden px-2 py-1 rounded bg-zinc-900 border border-red-900/50 text-red-400 text-[9px] font-black uppercase tracking-wider cursor-not-allowed opacity-80 shrink-0"
            >
              ESGOTADO
            </button>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onQuickAdd(product, selectedColor);
              }}
              title={`Adicionar ${product.name} à sacola`}
              aria-label={`Adicionar ${product.name} à sacola`}
              className="sm:hidden p-1.5 rounded-lg bg-[#E50914] text-white active:scale-95 shrink-0 shadow-sm cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
