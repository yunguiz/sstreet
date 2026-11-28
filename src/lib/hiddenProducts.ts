import type { Product } from '../types/index.js';

function normalizeHiddenText(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function isKidsSize(rawSize: unknown): boolean {
  const s = normalizeHiddenText(rawSize).toUpperCase();
  if (!s) return false;
  if (/\b(INFANTIL|JUVENIL|KIDS?|BEBE|CRIANCA)\b/i.test(s)) return true;
  // Tamanhos numéricos infantis brasileiros: 1, 2, 4, 6, 8, 10, 12, 14, 16 (ou com "ANOS"/"M")
  if (/^(?:0?[1-9]|1[0246])(?:\s*(?:ANOS?|A|M))?$/i.test(s)) return true;
  if (/^(?:PP|P|M|G|GG)\s*(?:INF|INFANTIL|KIDS?)$/i.test(s)) return true;
  return false;
}

/**
 * Checks whether a product matches any storefront exclusion rule
 * (independent of stock level, so sync can deactivate matching records too).
 */
export function isExcludedCatalogItem(product: Partial<Product> | any): boolean {
  if (!product) return false;

  const rawName = normalizeHiddenText(product.name || product.nome || '');
  const rawSku = normalizeHiddenText(product.integration?.sku || product.sku || product.codigo || '');
  const rawDesc = normalizeHiddenText(product.description || product.descricao || '');
  const rawCat = normalizeHiddenText(product.category || product.categoriaStore || product.categoria || '');
  const rawSubcat = normalizeHiddenText(product.subcategory || product.subcategoriaStore || '');

  const variantTexts = Array.isArray(product.variantsList)
    ? product.variantsList
        .map((v: any) => normalizeHiddenText(`${v?.sku || ''} ${v?.size || ''} ${v?.color || ''}`))
        .join(' ')
    : product.variacoes && typeof product.variacoes === 'object'
      ? Object.values(product.variacoes as Record<string, any>)
          .map((v: any) => normalizeHiddenText(`${v?.codigo || ''} ${v?.nome || ''} ${v?.tamanho || ''} ${v?.cor || ''}`))
          .join(' ')
      : '';

  const fullText = `${rawName} ${rawSku} ${rawDesc} ${variantTexts}`.trim();
  const allCatalogText = `${rawName} ${rawSku} ${rawCat} ${rawSubcat} ${rawDesc} ${variantTexts}`.trim();

  // 0. Peças infantis e tamanhos infantis (ex: Camisa Compton Infantil Preta ou qualquer item infantil)
  if (
    /\b(infantil|infant|juvenil|kids?|crianca|criancas|bebe|bebes)\b/i.test(allCatalogText)
  ) {
    return true;
  }

  const candidateSizes: string[] = [];
  if (Array.isArray(product.sizes)) {
    for (const s of product.sizes) candidateSizes.push(String(s || ''));
  }
  if (Array.isArray(product.tamanhos)) {
    for (const s of product.tamanhos) candidateSizes.push(String(s || ''));
  }
  if (Array.isArray(product.variantsList)) {
    for (const v of product.variantsList) {
      if (v?.size) candidateSizes.push(String(v.size));
    }
  }
  if (product.variacoes && typeof product.variacoes === 'object') {
    for (const v of Object.values(product.variacoes as Record<string, any>)) {
      if (v?.tamanho) candidateSizes.push(String(v.tamanho));
    }
  }
  const nonEmptySizes = candidateSizes.map((s) => s.trim()).filter(Boolean);
  if (
    nonEmptySizes.length > 0 &&
    nonEmptySizes.every((s) => isKidsSize(s))
  ) {
    return true;
  }

  // 1. Relógios, carteiras e correntes
  if (
    /\b(relogios?|carteiras?|correntes?)\b/i.test(`${rawName} ${rawDesc}`) ||
    rawSku.startsWith('ctl') ||
    rawSku.startsWith('clv') ||
    rawSku.startsWith('cg') ||
    rawSku.startsWith('cap100')
  ) {
    return true;
  }

  // 2. Todos os óculos
  if (
    /\b(oculos|juliet|penny|romeo|mirage|miragem|x-metal|x metal)\b/i.test(fullText) ||
    fullText.includes('osm100') ||
    (/\bradar\b/i.test(rawName) && /\b(ev|lente|oakley|metal|sol|armacao)\b/i.test(fullText)) ||
    (/\boakley\b/i.test(rawName) && (rawSubcat === 'acessorios-metal' || /\b(lente|armacao|sol|polarizad)/i.test(fullText)))
  ) {
    return true;
  }

  // 3. Bolsas e bags (mantendo calça baggy intacta)
  if (
    rawSubcat === 'bags' ||
    /\b(bolsas?|bags?|mochilas?|pochetes?|necessaires?|shoulder|sholder)\b/i.test(`${rawName} ${rawCat}`) ||
    rawSku.startsWith('sb')
  ) {
    return true;
  }

  // 4. Todas as meias (qualquer marca/campo, preservando "meia malha", "meia estacao", "meia manga") e bonés Chronic/Tripside
  const isNewEra = /\bnew\s*era\b/i.test(`${rawName} ${rawSku} ${rawDesc}`);
  const isChronicOrTripside = /\b(chronic|trip\s*side|tripside)\b/i.test(allCatalogText);
  const isBone = rawSubcat === 'bones' || /\bbones?\b/i.test(rawName);
  const textWithoutMeiaFalsePositives = allCatalogText.replace(
    /\bmeia[\s-]+(?:malha|estacao|manga)\b/gi,
    ' '
  );
  const isMeia = /\bmeias?\b/i.test(textWithoutMeiaFalsePositives);

  if (isMeia) {
    return true;
  }

  if (isBone && !isNewEra) {
    if (isChronicOrTripside || rawName.includes('aba curva')) {
      return true;
    }
  }

  // 5. Jaquetas de couro (inclui variações "jaqueta de couro", "jaqueta couro", "jaqueta de coro", "courino", "eco-couro")
  if (
    /\bjaqueta(?:s)?\b/i.test(allCatalogText) &&
    /\b(couro|coro|courino|eco[\s-]*couro)\b/i.test(allCatalogText)
  ) {
    return true;
  }

  // 6. Todas as regatas
  if (/\bregatas?\b/i.test(allCatalogText)) {
    return true;
  }

  // 7. Calça Cargo Oncros
  if (
    /\bcalca\b/i.test(rawName) &&
    /\bcargo\b/i.test(rawName) &&
    /\b(oncros|oncross|on cross)\b/i.test(fullText)
  ) {
    return true;
  }

  // 8. Bermuda Canelada Alto Luxo Preta
  if (
    /\bbermuda\b/i.test(rawName) &&
    /\bcanelad[ao]\b/i.test(rawName) &&
    (/\balto\s*luxo\b/i.test(fullText) || /\bpret[ao]\b/i.test(fullText))
  ) {
    return true;
  }

  // 9. Todas as peças Dry Fit (qualquer variação/categoria/título com dry fit / dri fit)
  if (/\b(dry[\s_-]*fit|dryfit|dri[\s_-]*fit|drifit)\b/i.test(allCatalogText)) {
    return true;
  }

  // 10. Tudo que for da Zara
  if (/\bzara\b/i.test(allCatalogText)) {
    return true;
  }

  // 11. Qualquer item escrito skate longboard (ou longboard)
  if (/\b(skate[\s_-]*long[\s_-]*board|long[\s_-]*board)\b/i.test(allCatalogText)) {
    return true;
  }

  // 12. Qualquer item escrito prata
  if (/\bprata\b/i.test(allCatalogText)) {
    return true;
  }

  // 13. Qualquer item escrito lenco pixa-in / lencopicha-in ou variações próximas
  if (
    /\b(?:lenc[o]?[\s_-]*pi(?:x|ch)a(?:[\s_-]*in)?|lencopixain|lencopichain|lenco[\s_-]*pixain|lenco[\s_-]*pichain|pi(?:x|ch)a[\s_-]*in)\b/i.test(
      allCatalogText
    )
  ) {
    return true;
  }

  // 13b. Camisa/camiseta estonada (preserva calça baggy estonada)
  if (/\bcamis(?:et)?a(?:s)?\b/i.test(allCatalogText) && /\bestonad[ao]s?\b/i.test(allCatalogText)) {
    return true;
  }

  // 13c. Gola polo malha chinesa
  if (
    /\bmalha\s*chinesa\b/i.test(allCatalogText) ||
    (/\bgol[ao]\s*polo\b/i.test(allCatalogText) && /\bchinesa\b/i.test(allCatalogText))
  ) {
    return true;
  }

  // 13d. Camisa/camiseta canelada
  if (/\bcamis(?:et)?a(?:s)?\b/i.test(allCatalogText) && /\bcanelad[ao]s?\b/i.test(allCatalogText)) {
    return true;
  }

  // 13e. Oversized Louis Vitton / Louis Vuitton
  if (/\blouis\s*(?:vui?tton|vitton|viton)\b/i.test(allCatalogText)) {
    return true;
  }

  // 13f. Suéter Importado
  if (/\bsueter\s+importad[ao]\b/i.test(allCatalogText)) {
    return true;
  }

  // 13g. Oversized Lisa (inclui Oversized Lisa e Oversized Lisa Suedine; preserva Camiseta Chronic Lisa e Oversized estampadas)
  if (/\boversized\s+lisa\b/i.test(allCatalogText)) {
    return true;
  }

  // 13h. Boné Anth Co
  if (/\b(?:bone[\s_-]*)?anth[\s._-]*co\b/i.test(allCatalogText)) {
    return true;
  }

  // 14. Chronic multi color e Camisetas Chronic / Tripside originais multi-cor
  const isChronic = /\bchronic\b/i.test(allCatalogText);
  const isMultiColor = /\b(multi[\s-]*(?:cor(?:es)?|color(?:ido|ida|s)?)|multicolor(?:ido|ida)?)\b/i.test(allCatalogText);
  if (
    (isChronic && isMultiColor) ||
    fullText.includes('cco500') ||
    (rawName.includes('chronic') &&
      (rawName.includes('tripside') || rawName.includes('trip side')) &&
      (rawName.includes('origina') || /\bcamis(?:et)?as?\b/i.test(rawName))) ||
    (isChronicOrTripside &&
      /\bcamis(?:et)?as?\b/i.test(rawName) &&
      (isMultiColor || /\borigina(?:l|is)\b/i.test(rawName)))
  ) {
    return true;
  }

  // 15. Legados ocultos mantidos (CSM500, Street Multimarcas, Hocks Montreal, Bermudas Carpinteiro/Raio Trip Side)
  if (
    fullText.includes('csm500') ||
    rawName.includes('street multimarca') ||
    rawName.includes('street multimarcas') ||
    ((rawName.includes('hock') || rawName.includes('hocks')) && rawName.includes('montreal')) ||
    (rawName.includes('bermuda') && rawName.includes('carpinteiro') && (rawName.includes('trip side') || rawName.includes('tripside'))) ||
    (rawName.includes('bermuda') && rawName.includes('raio') && (rawName.includes('trip side') || rawName.includes('tripside')))
  ) {
    return true;
  }

  return false;
}

export function isProductHidden(product: Partial<Product> | any): boolean {
  if (!product) return false;

  // Automatically hide any out-of-stock product from the site
  if (typeof product.stockCount === 'number' && product.stockCount <= 0) {
    return true;
  }
  if (typeof product.stock === 'number' && product.stock <= 0 && product.stockCount === undefined) {
    return true;
  }
  if (String(product.tag || '').toUpperCase().trim() === 'SEM ESTOQUE') {
    return true;
  }

  return isExcludedCatalogItem(product);
}

export function filterVisibleProducts<T = Product>(products: T[]): T[] {
  if (!Array.isArray(products)) return [];
  return products.filter((p) => !isProductHidden(p));
}
