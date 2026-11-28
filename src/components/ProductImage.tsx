import React, { useEffect, useMemo, useState } from 'react';
import { sortPreferredProductImages } from '../lib/catalogVariants';

export const STREET_STORE_FALLBACK_IMAGE = '/assets/streetstore-fallback.svg';

const INLINE_SVG_FALLBACK =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400'%3E%3Crect width='400' height='400' fill='%230d0d10'/%3E%3Ctext x='200' y='195' text-anchor='middle' fill='%23ffffff' font-family='sans-serif' font-size='28' font-weight='900' letter-spacing='4'%3ESTREET%3C/text%3E%3Ctext x='200' y='232' text-anchor='middle' fill='%23e50914' font-family='sans-serif' font-size='28' font-weight='900' letter-spacing='5'%3ESTORE%3C/text%3E%3C/svg%3E";

interface ProductImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  src?: string;
  candidates?: string[];
  fallbackSrc?: string;
  priority?: boolean;
}

export const ProductImage: React.FC<ProductImageProps> = ({
  src,
  candidates,
  fallbackSrc = STREET_STORE_FALLBACK_IMAGE,
  priority = false,
  alt = 'Street Store Oficial',
  className = '',
  onError,
  loading = 'lazy',
  decoding = 'async',
  referrerPolicy = 'no-referrer',
  ...rest
}) => {
  const sources = useMemo(() => {
    return sortPreferredProductImages(
      src ? [src] : [],
      Array.isArray(candidates) ? candidates : []
    );
  }, [src, candidates]);

  const sourcesKey = sources.join('|');
  const [sourceIdx, setSourceIdx] = useState(0);
  const [useStaticFallback, setUseStaticFallback] = useState(() => sources.length === 0);
  const [useInlineFallback, setUseInlineFallback] = useState(false);

  useEffect(() => {
    setSourceIdx(0);
    setUseStaticFallback(sources.length === 0);
    setUseInlineFallback(false);
  }, [sourcesKey, sources.length]);

  const activeSrc = useInlineFallback
    ? INLINE_SVG_FALLBACK
    : useStaticFallback
    ? fallbackSrc
    : sources[sourceIdx] || fallbackSrc;

  const handleError = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
    if (!useStaticFallback && sourceIdx + 1 < sources.length) {
      setSourceIdx((prev) => prev + 1);
    } else if (!useStaticFallback) {
      setUseStaticFallback(true);
    } else if (!useInlineFallback) {
      setUseInlineFallback(true);
    }
    onError?.(e);
  };

  return (
    <img
      {...rest}
      key={activeSrc}
      src={activeSrc}
      alt={alt}
      loading={priority ? 'eager' : loading}
      fetchPriority={priority ? 'high' : 'auto'}
      decoding={decoding}
      referrerPolicy={referrerPolicy}
      onError={handleError}
      className={className}
    />
  );
};
