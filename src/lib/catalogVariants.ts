export interface CatalogColorOption {
  name: string;
  hex: string;
}

export interface CatalogVariantItem {
  id: number;
  sku?: string;
  price: number;
  comparePrice?: number;
  stock: number;
  size?: string;
  color?: string;
}

interface ColorRule {
  name: string;
  hex: string;
  regex: RegExp;
}

/**
 * Ordered from most specific (multi-word / compound) to generic single-word
 * so "OFF WHITE" always resolves to "Off-White" (never "Branco") and
 * "ROSE GOLD" resolves to "Rose Gold" (never "Rosa").
 */
const COLOR_RULES: ColorRule[] = [
  {
    name: 'Off-White',
    hex: '#EAE6DF',
    regex: /\b(off[\s-]*(?:white|withe|whithe)|offwhite)\b|\bcom\s+off\b/i,
  },
  {
    name: 'Rose Gold',
    hex: '#E0A99B',
    regex: /\b(rose\s*gold)\b/i,
  },
  {
    name: 'Azul Marinho',
    hex: '#172554',
    regex: /\b(azul\s+marinho|marinho|navy)\b/i,
  },
  {
    name: 'Jeans',
    hex: '#3B6EA5',
    regex: /\b(jeans(?:\s+claro|\s+escuro)?|denim)\b/i,
  },
  {
    name: 'Bordô',
    hex: '#7F1D1D',
    regex: /\b(bordo|vinho|marsala|burgundy)\b/i,
  },
  {
    name: 'Creme',
    hex: '#F3EAD3',
    regex: /\b(creme|cream|marfim|nude)\b/i,
  },
  {
    name: 'Mostarda',
    hex: '#CA8A04',
    regex: /\b(mostarda|mustard)\b/i,
  },
  {
    name: 'Preto',
    hex: '#111111',
    regex: /\b(all[\s-]?black|preto|preta|black|negro|negra)\b/i,
  },
  {
    name: 'Branco',
    hex: '#FFFFFF',
    regex: /\b(branco|branca|white)\b/i,
  },
  {
    name: 'Cinza',
    hex: '#6B7280',
    regex: /\b(cinza|grey|gray|chumbo|grafite|mescla)\b/i,
  },
  {
    name: 'Azul',
    hex: '#1E3A8A',
    regex: /\b(azul|blue|safira|celeste|turquesa|ciano)\b/i,
  },
  {
    name: 'Verde',
    hex: '#14532D',
    regex: /\b(verde|green|militar|musgo|oliva)\b/i,
  },
  {
    name: 'Vermelho',
    hex: '#DC2626',
    regex: /\b(vermelho|vermelha|red|carmesim)\b/i,
  },
  {
    name: 'Roxo',
    hex: '#6B21A8',
    regex: /\b(roxo|roxa|purple|lilas|violeta|lavanda)\b/i,
  },
  {
    name: 'Rosa',
    hex: '#F472B6',
    regex: /\b(rosa|pink|rose)\b/i,
  },
  {
    name: 'Marrom',
    hex: '#78350F',
    regex: /\b(marrom|marron|brown|cafe|chocolate|terracota)\b/i,
  },
  {
    name: 'Bege',
    hex: '#D6C5A7',
    regex: /\b(bege|areia|caramelo|caqui|khaki|camelo)\b/i,
  },
  {
    name: 'Amarelo',
    hex: '#EAB308',
    regex: /\b(amarelo|amarela|yellow)\b/i,
  },
  {
    name: 'Laranja',
    hex: '#EA580C',
    regex: /\b(laranja|orange|coral)\b/i,
  },
  {
    name: 'Prata',
    hex: '#9CA3AF',
    regex: /\b(prata|prateado|prateada|silver)\b/i,
  },
  {
    name: 'Dourado',
    hex: '#F59E0B',
    regex: /\b(dourado|dourada|ouro|gold)\b/i,
  },
  {
    name: 'Multicor',
    hex: '#A855F7',
    regex: /\b(multi[\s-]?cor|colorido|colorida)\b/i,
  },
  {
    name: 'Transparente',
    hex: '#E5E7EB',
    regex: /\b(transparente|cristal)\b/i,
  },
];

function stripAccents(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export const COLOR_HEX_MAP: Record<string, string> = {
  preto: '#111111',
  preta: '#111111',
  branco: '#FFFFFF',
  branca: '#FFFFFF',
  'off-white': '#EAE6DF',
  'off white': '#EAE6DF',
  offwhite: '#EAE6DF',
  creme: '#F3EAD3',
  cinza: '#6B7280',
  chumbo: '#374151',
  grafite: '#374151',
  azul: '#1E3A8A',
  'azul marinho': '#172554',
  marinho: '#172554',
  jeans: '#3B6EA5',
  verde: '#14532D',
  militar: '#3F4E2E',
  vermelho: '#DC2626',
  vermelha: '#DC2626',
  bordô: '#7F1D1D',
  bordo: '#7F1D1D',
  vinho: '#7F1D1D',
  marsala: '#7F1D1D',
  rosa: '#F472B6',
  'rose gold': '#E0A99B',
  roxo: '#6B21A8',
  roxa: '#6B21A8',
  bege: '#D6C5A7',
  caqui: '#A89F81',
  marrom: '#78350F',
  marron: '#78350F',
  mostarda: '#CA8A04',
  laranja: '#EA580C',
  amarelo: '#EAB308',
  prata: '#9CA3AF',
  dourado: '#F59E0B',
  multicor: '#A855F7',
  transparente: '#E5E7EB',
};

const CLOTHES_SIZE_ORDER = [
  'PP',
  'P',
  'M',
  'G',
  'GG',
  'XG',
  'XGG',
  'XXG',
  'EG',
  'EGG',
  'G1',
  'G2',
  'G3',
  'G4',
];

const UNIQUE_SIZE_LABELS = new Set(['TAMANHO ÚNICO', 'TAMANHO UNICO', 'ÚNICO', 'UNICO', 'U', 'AJUSTÁVEL', 'AJUSTAVEL']);
const GENERIC_COLOR_LABELS = new Set(['PADRÃO', 'PADRAO', 'COR ÚNICA', 'COR UNICA', 'ÚNICA', 'UNICA', '']);

/**
 * Checks whether a trailing/colon segment is an actual garment, shoe, cap, or numeric size.
 * Rejects numbers like "77" or "9060" that belong to a product model name (e.g. "RECORTADA 19:77").
 */
export function isRecognizedSizeToken(raw: string): boolean {
  const s = String(raw || '').trim().toUpperCase();
  if (!s) return false;
  if (CLOTHES_SIZE_ORDER.includes(s)) return true;
  if (UNIQUE_SIZE_LABELS.has(s)) return true;
  // Shoe / pants / kids clothing numeric sizes (10, 12, 14, 16 or 32..56)
  if (/^(1[0246]|[23][0-9]|4[0-9]|5[0-6])$/.test(s)) return true;
  // Numeric ranges like "33 A 36", "35-46", "37 A 40", "41 A 44"
  if (/^\d{2}\s*(?:A|-|\/)\s*\d{2}$/.test(s)) return true;
  // Cap circumference sizes like "55.8 CM", "56.8 CM", "58.7 CM"
  if (/^\d{2}(?:[.,]\d)?\s*CM$/.test(s)) return true;
  return false;
}

export function normalizeSizeLabel(raw: string): string {
  const trimmed = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!trimmed) return 'Tamanho Único';
  const upper = trimmed.toUpperCase();
  if (upper === 'UNICO' || upper === 'ÚNICO' || upper === 'TAMANHO UNICO' || upper === 'TAMANHO ÚNICO') {
    return 'Tamanho Único';
  }
  if (upper === 'AJUSTAVEL' || upper === 'AJUSTÁVEL') {
    return 'Ajustável';
  }
  if (/^(PP|P|M|G|GG|XG|XGG|XXG|EG|EGG|G[1-4])$/.test(upper)) {
    return upper;
  }
  if (/^\d{2}(?:[.,]\d)?\s*CM$/i.test(trimmed)) {
    return upper;
  }
  if (/^\d{2}\s*(?:A|-|\/)\s*\d{2}$/i.test(trimmed)) {
    return upper;
  }
  return trimmed.length <= 5 ? upper : trimmed;
}

export function sortSizes(sizes: string[]): string[] {
  const cleaned = Array.from(
    new Set(
      sizes
        .map((s) => normalizeSizeLabel(s))
        .filter((s) => s.length > 0)
    )
  );

  // If real sizes exist alongside "Tamanho Único", strip "Tamanho Único"
  const nonUnique = cleaned.filter((s) => !UNIQUE_SIZE_LABELS.has(s.toUpperCase()));
  const target = nonUnique.length > 0 ? nonUnique : cleaned;

  return [...target].sort((a, b) => {
    const ua = a.toUpperCase();
    const ub = b.toUpperCase();

    const idxA = CLOTHES_SIZE_ORDER.indexOf(ua);
    const idxB = CLOTHES_SIZE_ORDER.indexOf(ub);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;

    const numA = parseFloat(ua.replace(',', '.'));
    const numB = parseFloat(ub.replace(',', '.'));
    if (!Number.isNaN(numA) && !Number.isNaN(numB) && /^\d/.test(ua) && /^\d/.test(ub)) {
      if (numA !== numB) return numA - numB;
    }

    return ua.localeCompare(ub, 'pt-BR');
  });
}

export function normalizeColorName(raw: string): string {
  const trimmed = String(raw || '').replace(/\s+/g, ' ').trim();
  const ascii = stripAccents(trimmed);
  if (!ascii || GENERIC_COLOR_LABELS.has(trimmed.toUpperCase()) || GENERIC_COLOR_LABELS.has(ascii.toUpperCase())) {
    return '';
  }

  for (const rule of COLOR_RULES) {
    if (rule.regex.test(ascii)) {
      return rule.name;
    }
  }

  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
}

export function resolveColorHex(colorName: string): string {
  const norm = String(colorName || '').trim().toLowerCase();
  const asciiNorm = stripAccents(norm);
  if (COLOR_HEX_MAP[norm]) return COLOR_HEX_MAP[norm];
  if (COLOR_HEX_MAP[asciiNorm]) return COLOR_HEX_MAP[asciiNorm];
  for (const rule of COLOR_RULES) {
    if (stripAccents(rule.name).toLowerCase() === asciiNorm || rule.regex.test(asciiNorm)) {
      return rule.hex;
    }
  }
  return '#1C1C1C';
}

export function detectColorFromText(text: string): CatalogColorOption | null {
  const source = stripAccents(String(text || '').trim());
  if (!source) return null;

  for (const rule of COLOR_RULES) {
    if (rule.regex.test(source)) {
      return { name: rule.name, hex: rule.hex };
    }
  }

  if (/\b(estonado|estonada)\b/i.test(source)) {
    return { name: 'Estonado', hex: '#4B5563' };
  }

  return null;
}

export function normalizeColorOptions(
  colors: Array<string | { name?: string; hex?: string } | null | undefined>
): CatalogColorOption[] {
  const map = new Map<string, CatalogColorOption>();

  for (const entry of colors) {
    const rawName = typeof entry === 'string' ? entry : entry?.name || '';
    const normalized = normalizeColorName(rawName);
    if (!normalized) continue;
    if (!map.has(normalized)) {
      const explicitHex = typeof entry === 'object' && entry?.hex && entry.hex !== '#1C1C1C' ? entry.hex : '';
      map.set(normalized, {
        name: normalized,
        hex: explicitHex || resolveColorHex(normalized),
      });
    }
  }

  if (map.size === 0) {
    return [{ name: 'Cor Única', hex: '#1C1C1C' }];
  }

  return Array.from(map.values());
}

/**
 * Extracts clean base product name, size, and color from any Bling item / variation record.
 * Handles:
 * - Structured Bling `variacao.nome` (e.g. "Cor:Preto;Tamanho:M")
 * - Single colon ("CAMISA COMPTOM REFLETIVA BRANCA:GG")
 * - Multi-colon ("OVERSIZED TRIP SIDE RECORTADA 19:77 PRETO/VERMELHO:M")
 * - Space-separated suffix without colon ("SUETER IMPORTADO GG", "SUETER IMPORTADO P")
 */
export function parseBlingVariantMeta(params: {
  nome?: string;
  variacaoNome?: string;
  isParentContainer?: boolean;
}): {
  baseName: string;
  size: string;
  hasExplicitSize: boolean;
  color: CatalogColorOption | null;
} {
  const fullName = String(params.nome || '').replace(/\s+/g, ' ').trim();
  const varLabel = String(params.variacaoNome || '').replace(/\s+/g, ' ').trim();

  let size = '';
  let explicitVarColor = '';

  if (varLabel) {
    const tamMatch = varLabel.match(/(?:tamanho|tam|size)\s*[:=]\s*([^;|,/]+)/i);
    if (tamMatch?.[1]) {
      size = tamMatch[1].trim();
    } else if (isRecognizedSizeToken(varLabel)) {
      size = varLabel;
    }

    const corMatch = varLabel.match(/(?:cor|color)\s*[:=]\s*([^;|,/]+)/i);
    if (corMatch?.[1]) {
      explicitVarColor = corMatch[1].trim();
    }
  }

  let baseName = fullName;
  if (baseName.includes(' // ')) {
    baseName = baseName.split(' // ')[0].trim();
  } else if (baseName.includes(' - Tam')) {
    baseName = baseName.split(' - Tam')[0].trim();
  }

  // If fullName has colons, inspect the LAST colon segment first
  // (avoids breaking names like "OVERSIZED TRIP SIDE RECORTADA 19:77 PRETO/VERMELHO:M")
  if (!size && fullName.includes(':') && !params.isParentContainer) {
    const colonParts = fullName.split(':');
    const lastSeg = (colonParts[colonParts.length - 1] || '').trim().replace(/^tam(?:anho)?\s*/i, '').trim();
    if (lastSeg && (isRecognizedSizeToken(lastSeg) || colonParts.length === 2 && lastSeg.length <= 16)) {
      size = lastSeg;
      baseName = colonParts.slice(0, -1).join(':').trim();
    }
  } else if (params.isParentContainer && fullName.includes(':')) {
    const colonParts = fullName.split(':');
    const lastSeg = (colonParts[colonParts.length - 1] || '').trim();
    if (isRecognizedSizeToken(lastSeg)) {
      baseName = colonParts.slice(0, -1).join(':').trim();
    }
  }

  // Fallback for variations named without colons, e.g. "SUETER IMPORTADO GG" or "CAMISA POLO - M"
  if (!size && !params.isParentContainer) {
    const trailingSizeMatch = fullName.match(
      /^(.+?)\s*(?:-|–|\s)\s*(?:tam(?:anho)?\.?\s*)?(PP|P|M|G|GG|XG|XGG|XXG|G[1-4]|1[0246]|[23][0-9]|4[0-9]|5[0-6])\s*$/i
    );
    if (trailingSizeMatch?.[2]) {
      const candidateSize = trailingSizeMatch[2].trim();
      const candidateBase = trailingSizeMatch[1].trim();
      if (candidateBase.length >= 3 && isRecognizedSizeToken(candidateSize)) {
        size = candidateSize;
        baseName = candidateBase;
      }
    }
  }

  const normalizedSize = size ? normalizeSizeLabel(size) : 'Tamanho Único';
  const hasExplicitSize = Boolean(size) && !UNIQUE_SIZE_LABELS.has(normalizedSize.toUpperCase());

  // Color detection: prefer structured variation color, then variation suffix (before last colon), then fullName
  let color: CatalogColorOption | null = null;
  if (explicitVarColor) {
    color = detectColorFromText(explicitVarColor) || {
      name: normalizeColorName(explicitVarColor) || explicitVarColor,
      hex: resolveColorHex(explicitVarColor),
    };
  }
  if (!color) {
    color = detectColorFromText(`${varLabel} ${fullName}`);
  }

  return {
    baseName: baseName || fullName,
    size: normalizedSize,
    hasExplicitSize,
    color,
  };
}

export function inferStoreCategory(
  productName: string,
  rawCategory?: string,
  rawSubcategory?: string
): {
  category: 'roupas' | 'calcados' | 'acessorios';
  subcategory: 'hoodies' | 'camisetas' | 'calcas' | 'shorts' | 'sneakers' | 'bones' | 'bags' | 'acessorios-metal';
} {
  const nameAscii = stripAccents(productName).toLowerCase();
  const catAscii = stripAccents(rawCategory || '').toLowerCase();
  const subAscii = stripAccents(rawSubcategory || '').toLowerCase();
  const text = `${catAscii} ${subAscii} ${nameAscii}`;

  if (/\b(bone|bucket|gorro|touca)\b/i.test(text)) {
    return { category: 'acessorios', subcategory: 'bones' };
  }
  if (/\b(bag|shoulder|sholder|mochila|pochete|mala)\b/i.test(text)) {
    return { category: 'acessorios', subcategory: 'bags' };
  }
  if (
    /\b(oculos|radar|juliet|penny|oakley|cartier|descanso|cinto|carteira|relogio|isqueiro|corrente|chaveiro|anel|pulseira|perfume|prata|acessorios?)\b/i.test(
      text
    ) ||
    /\b(meia|cadarco|lace)\b/i.test(nameAscii)
  ) {
    return { category: 'acessorios', subcategory: 'acessorios-metal' };
  }
  if (catAscii === 'calcados' || /\b(tenis|sneaker|chinelo|bota|sandalia|sapato|calcado|dunk|jordan|air max|yeezy)\b/i.test(text)) {
    return { category: 'calcados', subcategory: 'sneakers' };
  }
  if (subAscii === 'hoodies' || /\b(moletom|hoodie|jaqueta|corta\s*vento|bobojoco|casaco|sueter)\b/i.test(text)) {
    return { category: 'roupas', subcategory: 'hoodies' };
  }
  if (
    subAscii === 'calcas' ||
    /\b(calca|jogger|jeans)\b/i.test(text) ||
    (/\bcargo\b/i.test(text) && !/\b(camisa|camiseta|polo|regata|blusa)\b/i.test(nameAscii))
  ) {
    return { category: 'roupas', subcategory: 'calcas' };
  }
  if (subAscii === 'shorts' || /\b(bermuda|short)\b/i.test(text)) {
    return { category: 'roupas', subcategory: 'shorts' };
  }

  return { category: 'roupas', subcategory: 'camisetas' };
}

