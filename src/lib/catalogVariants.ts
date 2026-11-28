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
  image?: string;
  images?: string[];
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
    name: 'Roxo com Preto',
    hex: '#6B21A8',
    regex: /\b(?:roxo|roxa|purple)\s*(?:com|c\/|\/|\+|e|-)\s*(?:preto|preta|black)\b/i,
  },
  {
    name: 'Preto com Roxo',
    hex: '#111111',
    regex: /\b(?:preto|preta|black)\s*(?:com|c\/|\/|\+|e|-)\s*(?:roxo|roxa|purple)\b/i,
  },
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
  'roxo com preto': '#6B21A8',
  'roxa com preto': '#6B21A8',
  'roxo/preto': '#6B21A8',
  'preto com roxo': '#111111',
  'preta com roxo': '#111111',
  'preto/roxo': '#111111',
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

const TITLE_COLOR_STRIP_REGEX =
  /\b(?:off[\s-]*(?:white|withe|whithe)|offwhite|rose\s*gold|azul\s+marinho|all[\s-]?black|multi[\s-]?cor|colorid[oa]|pret[oa]s?|branc[oa]s?|cinza|grafite|chumbo|mescla|azul|verde|militar|musgo|oliva|vermelh[oa]s?|bord[oô]|vinho|marsala|burgundy|rox[oa]s?|lil[aá]s|violeta|lavanda|ros[ae]|pink|marrom|marron|caf[eé]|chocolate|terracota|beg[eé]|areia|caramelo|caqui|khaki|camelo|amarel[oa]s?|laranja|coral|creme|cream|marfim|nude|mostarda|prata|pratead[oa]|dourad[oa]|ouro|estonad[oa]|transparente|cristal|black|white|navy|grey|gray|blue|green|red|purple|brown|yellow|orange|silver|gold)\b/gi;

export function isExpiredPresignedImageUrl(url?: string): boolean {
  const clean = String(url || '').trim();
  if (!clean || !clean.startsWith('http')) return false;
  try {
    const parsed = new URL(clean);
    const expiresParam = parsed.searchParams.get('Expires');
    if (expiresParam) {
      const expSec = Number(expiresParam);
      if (Number.isFinite(expSec) && expSec > 0 && expSec * 1000 <= Date.now()) {
        return true;
      }
    }
    const amzDate = parsed.searchParams.get('X-Amz-Date');
    const amzExpires = parsed.searchParams.get('X-Amz-Expires');
    if (amzDate && amzExpires) {
      const m = amzDate.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
      if (m) {
        const startMs = Date.UTC(
          Number(m[1]),
          Number(m[2]) - 1,
          Number(m[3]),
          Number(m[4]),
          Number(m[5]),
          Number(m[6])
        );
        const ttlSec = Number(amzExpires);
        if (Number.isFinite(ttlSec) && startMs + ttlSec * 1000 <= Date.now()) {
          return true;
        }
      }
    }
  } catch {
    // ignore malformed URL
  }
  return false;
}

export function isValidPhotoUrl(url?: string): boolean {
  const u = String(url || '').trim();
  if (!u) return false;
  const low = u.toLowerCase();
  if (
    low.includes('streetstore-fallback') ||
    low.includes('placeholder') ||
    low.includes('unsplash.com') ||
    low.includes('/src/assets/')
  ) {
    return false;
  }
  if (isExpiredPresignedImageUrl(u)) return false;
  return true;
}

export function isLowResThumbnailUrl(url?: string): boolean {
  const low = String(url || '').toLowerCase().trim();
  if (!low) return true;
  if (
    low.includes('miniatura') ||
    low.includes('/thumb/') ||
    low.includes('_thumb.') ||
    low.includes('-thumb.') ||
    low.includes('_mini.') ||
    low.includes('-mini.') ||
    /-(?:50|100|150|200|240|250|300|320|480)-\d+\.(?:jpe?g|png|webp|avif)/i.test(low)
  ) {
    return true;
  }
  if (low.includes('orgbling.s3.amazonaws.com') || low.includes('bling.com')) {
    try {
      const parsed = new URL(low);
      if (
        /\/(?:t|p|m)\/[^/]+$/i.test(parsed.pathname) ||
        /\/(?:t|p|m)\/[a-z0-9_-]{8,}/i.test(parsed.pathname)
      ) {
        return true;
      }
    } catch {
      if (/\/(?:t|p|m)\/[a-z0-9_-]{8,}/i.test(low)) return true;
    }
  }
  return false;
}

const FRONTEND_RESIZE_PARAMS = new Set([
  'w',
  'h',
  'width',
  'height',
  'max-w',
  'max-h',
  'size',
  'resize',
  'quality',
  'q',
  'fit',
  'thumb',
  'mini',
  'miniatura',
]);

export function cleanHighResImageUrl(url?: string): string {
  const raw = String(url || '').trim();
  if (!raw || raw.startsWith('data:image') || raw.startsWith('/')) return raw;
  try {
    const parsed = new URL(raw);
    for (const k of Array.from(parsed.searchParams.keys())) {
      if (FRONTEND_RESIZE_PARAMS.has(k.toLowerCase())) {
        parsed.searchParams.delete(k);
      }
    }
    return parsed.toString();
  } catch {
    return raw;
  }
}

const PRESIGNED_AUTH_PARAMS = new Set([
  'awsaccesskeyid',
  'expires',
  'signature',
  'x-amz-algorithm',
  'x-amz-credential',
  'x-amz-date',
  'x-amz-expires',
  'x-amz-signedheaders',
  'x-amz-signature',
  'x-amz-security-token',
]);

export function getCanonicalPhotoKey(url?: string): string {
  const clean = String(url || '').trim();
  if (!clean || clean.startsWith('data:image') || clean.startsWith('/')) return clean;
  try {
    const parsed = new URL(clean);
    for (const k of Array.from(parsed.searchParams.keys())) {
      if (PRESIGNED_AUTH_PARAMS.has(k.toLowerCase())) {
        parsed.searchParams.delete(k);
      }
    }
    return parsed.toString();
  } catch {
    return clean;
  }
}

export function sortPreferredProductImages(...lists: Array<string[] | undefined>): string[] {
  const seenKeys = new Set<string>();
  const full: string[] = [];
  const thumbs: string[] = [];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      const clean = cleanHighResImageUrl(raw);
      if (!clean || !isValidPhotoUrl(clean)) continue;
      const canonical = getCanonicalPhotoKey(clean);
      if (!canonical || seenKeys.has(canonical)) continue;
      seenKeys.add(canonical);
      if (isLowResThumbnailUrl(clean)) {
        thumbs.push(clean);
      } else {
        full.push(clean);
      }
    }
  }
  return full.length > 0 ? full : thumbs;
}

function mergeUniquePhotos(...lists: Array<string[] | undefined>): string[] {
  return sortPreferredProductImages(...lists);
}

export function stripColorFromProductTitle(rawTitle: string): string {
  const original = String(rawTitle || '').replace(/\s+/g, ' ').trim();
  if (!original) return '';

  // Remove trailing "com off" / color clauses first
  let cleaned = original
    .replace(/\bcom\s+off[\s-]*(?:white|withe|whithe)?\b/gi, ' ')
    .replace(TITLE_COLOR_STRIP_REGEX, ' ');

  // Clean orphaned separators left behind where colors were stripped
  cleaned = cleaned
    .replace(/\(\s*[-/+&,\s]*\)/g, ' ')
    .replace(/\s*[/+&]+\s*(?=[/+&\s]|$)/g, ' ')
    .replace(/(?:^|\s)[/+&-]+(?=\s|$)/g, ' ')
    .replace(/\s*[-/:+&]+\s*$/g, '')
    .replace(/^\s*[-/:+&]+\s*/g, '')
    .replace(/\s+(?:com|e|de|no|na|em|cor)$/i, '')
    .replace(/\s*[-/:+&]+\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned.length >= 3 ? cleaned : original;
}

/**
 * Separates the 3 distinct "Oversized Boxy Tripside Recortada" models so they never collapse into
 * one mixed card while still deduplicating duplicate Bling listings of the exact same model:
 * 1) Traditional cut (not "boxy")
 * 2) Boxy cut — "Roxa com Preto"
 * 3) Boxy cut — "Preto com Roxo"
 */
export function getTripsideRecortadaModelSignature(rawName: string): string | null {
  const ascii = stripAccents(String(rawName || ''))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  if (!/\b(?:tripside|trip\s+side)\b/i.test(ascii) || !/\brecortad[ao]\b/i.test(ascii)) {
    return null;
  }
  const cut = /\bboxy\b/i.test(ascii) ? 'boxy' : 'tradicional';
  let colorOrder = 'padrao';
  if (/\b(?:roxo|roxa|purple)\s*(?:com|c\/|\/|\+|e|-)\s*(?:preto|preta|black)\b/i.test(ascii)) {
    colorOrder = 'roxo-com-preto';
  } else if (/\b(?:preto|preta|black)\s*(?:com|c\/|\/|\+|e|-)\s*(?:roxo|roxa|purple)\b/i.test(ascii)) {
    colorOrder = 'preto-com-roxo';
  } else {
    const detected = detectColorFromText(ascii);
    if (detected?.name) {
      colorOrder = stripAccents(detected.name).toLowerCase().replace(/[^a-z0-9]+/g, '-');
    }
  }
  return `${cut}::${colorOrder}`;
}

export function getImagesForColor(
  product: {
    images?: string[];
    colorImages?: Record<string, string[]>;
    variantsList?: Array<{ color?: string; image?: string; images?: string[] }>;
  },
  colorName?: string
): string[] {
  const target = normalizeColorName(colorName || '').toLowerCase();
  const baseProductImages = sortPreferredProductImages(product.images);
  if (!target || target === 'cor única' || target === 'cor unica') {
    return baseProductImages;
  }

  const fromMap: string[] = [];
  const otherColorCanonicalKeys = new Set<string>();
  if (product.colorImages && typeof product.colorImages === 'object') {
    for (const [k, urls] of Object.entries(product.colorImages)) {
      if (!Array.isArray(urls)) continue;
      const normalizedKey = normalizeColorName(k).toLowerCase();
      if (normalizedKey === target) {
        fromMap.push(...urls);
      } else {
        for (const u of urls) {
          const canon = getCanonicalPhotoKey(cleanHighResImageUrl(u));
          if (canon) otherColorCanonicalKeys.add(canon);
        }
      }
    }
  }

  const fromVars: string[] = [];
  if (Array.isArray(product.variantsList)) {
    for (const v of product.variantsList) {
      const vColor = v?.color ? normalizeColorName(v.color).toLowerCase() : '';
      if (vColor === target) {
        if (Array.isArray(v.images)) fromVars.push(...v.images);
        if (v.image) fromVars.push(v.image);
      } else if (vColor) {
        if (Array.isArray(v.images)) {
          for (const u of v.images) {
            const canon = getCanonicalPhotoKey(cleanHighResImageUrl(u));
            if (canon) otherColorCanonicalKeys.add(canon);
          }
        }
        if (v.image) {
          const canon = getCanonicalPhotoKey(cleanHighResImageUrl(v.image));
          if (canon) otherColorCanonicalKeys.add(canon);
        }
      }
    }
  }

  const resolved = sortPreferredProductImages(fromMap, fromVars);
  if (resolved.length > 0) {
    return resolved;
  }

  if (otherColorCanonicalKeys.size > 0) {
    const unattributed = baseProductImages.filter(
      (u) => !otherColorCanonicalKeys.has(getCanonicalPhotoKey(cleanHighResImageUrl(u)))
    );
    if (unattributed.length > 0) return unattributed;
  }

  return baseProductImages;
}

/**
 * Unifies duplicate storefront products representing the exact same piece in different colors
 * (e.g., "Camisa Compton Refletiva Preta" + "Camisa Compton Refletiva Branca") into a single
 * product card with interactive color swatches and per-color image mapping.
 */
export function unifyProductsByColor<
  T extends {
    id: string;
    name: string;
    category: string;
    subcategory: string;
    price: number;
    originalPrice?: number;
    tag?: any;
    images: string[];
    colorImages?: Record<string, string[]>;
    sizes: string[];
    colors: { name: string; hex: string }[];
    stockCount: number;
    integration?: { sku?: string; blingId?: string; [k: string]: any };
    variantsList?: Array<{
      id: number;
      sku?: string;
      price: number;
      comparePrice?: number;
      stock: number;
      size?: string;
      color?: string;
      image?: string;
      images?: string[];
    }>;
    [k: string]: any;
  }
>(products: T[]): T[] {
  if (!Array.isArray(products) || products.length === 0) return [];

  const normalizeKeyPart = (val: string) =>
    stripAccents(val).toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

  type PreparedEntry = {
    product: T;
    strippedTitle: string;
    normStrippedTitle: string;
    modelSignature: string | null;
    titleHadColor: boolean;
    realColors: string[];
    colorImages: Record<string, string[]>;
    variants: NonNullable<T['variantsList']>;
  };

  const prepared: PreparedEntry[] = products.map((p) => {
    const modelSignature = getTripsideRecortadaModelSignature(p.name);
    const strippedTitle = modelSignature ? p.name : stripColorFromProductTitle(p.name);
    const normOrig = normalizeKeyPart(p.name);
    const normStrippedTitle = normalizeKeyPart(strippedTitle);
    const titleHadColor = Boolean(normStrippedTitle) && normStrippedTitle !== normOrig;

    const titleColor = detectColorFromText(p.name)?.name || '';
    const existingColors = (p.colors || [])
      .map((c) => normalizeColorName(c?.name || ''))
      .filter((c) => Boolean(c) && c.toLowerCase() !== 'cor única');

    const varColors = (p.variantsList || [])
      .map((v) => normalizeColorName(v?.color || ''))
      .filter(Boolean);

    const realColors = Array.from(
      new Set([...existingColors, ...varColors, ...(titleColor ? [titleColor] : [])])
    );
    const fallbackSingleColor = realColors.length === 1 ? realColors[0] : titleColor;
    const validProductImgs = mergeUniquePhotos(p.images);

    const colorImages: Record<string, string[]> = {};
    if (p.colorImages && typeof p.colorImages === 'object') {
      for (const [k, urls] of Object.entries(p.colorImages)) {
        const nk = normalizeColorName(k);
        if (!nk) continue;
        const merged = mergeUniquePhotos(colorImages[nk], urls);
        if (merged.length > 0) colorImages[nk] = merged;
      }
    }

    const baseVariants =
      Array.isArray(p.variantsList) && p.variantsList.length > 0
        ? p.variantsList.map((v) => {
            const vColor = normalizeColorName(v.color || '') || fallbackSingleColor || undefined;
            const vVarImgs = sortPreferredProductImages(v.images, v.image ? [v.image] : []);
            const vImg = vVarImgs[0] || (realColors.length <= 1 ? validProductImgs[0] : undefined);
            return {
              ...v,
              ...(vColor ? { color: vColor } : {}),
              ...(vImg ? { image: vImg } : {}),
              ...(vVarImgs.length > 0 ? { images: vVarImgs } : {}),
            };
          })
        : [
            {
              id: Number(String(p.integration?.blingId || p.id).replace(/\D/g, '')) || 0,
              sku: p.integration?.sku || p.id,
              price: p.price,
              stock: Math.max(0, p.stockCount ?? 0),
              size: p.sizes?.[0] || 'Tamanho Único',
              ...(fallbackSingleColor ? { color: fallbackSingleColor } : {}),
              ...(validProductImgs[0] ? { image: validProductImgs[0] } : {}),
              ...(validProductImgs.length > 0 ? { images: validProductImgs } : {}),
            },
          ];

    for (const v of baseVariants) {
      if (!v.color) continue;
      const vUrls = sortPreferredProductImages(v.images, v.image ? [v.image] : []);
      if (vUrls.length > 0) {
        colorImages[v.color] = mergeUniquePhotos(colorImages[v.color], vUrls);
      }
    }
    if (fallbackSingleColor && realColors.length <= 1 && validProductImgs.length > 0) {
      colorImages[fallbackSingleColor] = mergeUniquePhotos(colorImages[fallbackSingleColor], validProductImgs);
    }

    return {
      product: p,
      strippedTitle,
      normStrippedTitle,
      modelSignature,
      titleHadColor,
      realColors,
      colorImages,
      variants: baseVariants,
    };
  });

  const buckets = new Map<string, PreparedEntry[][]>();

  for (const entry of prepared) {
    const baseBucketKey = entry.modelSignature
      ? `${entry.product.category}::${entry.product.subcategory}::tripside-recortada::${entry.modelSignature}`
      : `${entry.product.category}::${entry.product.subcategory}::${entry.normStrippedTitle}`;
    let groups = buckets.get(baseBucketKey);
    if (!groups) {
      groups = [];
      buckets.set(baseBucketKey, groups);
    }

    const entryColorSet = new Set(entry.realColors.map((c) => c.toLowerCase()));
    const entryHasColor = entry.titleHadColor || entryColorSet.size > 0;

    const targetGroup = groups.find((group) => {
      const cand = group[0];
      const sameBlingId =
        Boolean(cand.product.integration?.blingId) &&
        cand.product.integration?.blingId === entry.product.integration?.blingId;
      if (sameBlingId) return true;

      const maxPrice = Math.max(cand.product.price || 0, entry.product.price || 0, 1);
      const priceDiffRatio = Math.abs((cand.product.price || 0) - (entry.product.price || 0)) / maxPrice;
      if (priceDiffRatio > 0.25) return false;

      if (entry.modelSignature && cand.modelSignature === entry.modelSignature) {
        return true;
      }

      const candColorSet = new Set(cand.realColors.map((c) => c.toLowerCase()));
      const candHasColor = cand.titleHadColor || candColorSet.size > 0;
      if (!candHasColor || !entryHasColor) return false;

      const hasDistinctColor =
        entry.realColors.some((c) => !candColorSet.has(c.toLowerCase())) ||
        cand.realColors.some((c) => !entryColorSet.has(c.toLowerCase()));
      return hasDistinctColor || (cand.titleHadColor && entry.titleHadColor);
    });

    if (targetGroup) {
      targetGroup.push(entry);
    } else {
      groups.push([entry]);
    }
  }

  const unified: T[] = [];

  for (const groups of buckets.values()) {
    for (const entries of groups) {
    if (entries.length === 1) {
      const single = entries[0];
      const mergedImgs = mergeUniquePhotos(
        single.product.images,
        ...Object.values(single.colorImages)
      );
      unified.push({
        ...single.product,
        images: mergedImgs.length > 0 ? mergedImgs : single.product.images,
        ...(Object.keys(single.colorImages).length > 0 ? { colorImages: single.colorImages } : {}),
        variantsList: single.variants,
      });
      continue;
    }

    // Group entries that actually matched each other (first entry is canonical; check price compatibility for remaining)
    const primary = entries[0];
    const cleanTitle =
      primary.modelSignature
        ? primary.product.name
        : entries.some((e) => e.titleHadColor)
          ? primary.strippedTitle
          : primary.product.name;

    const variantMap = new Map<string, NonNullable<T['variantsList']>[number]>();
    for (const e of entries) {
      for (const v of e.variants) {
        const varKey =
          v.id > 0
            ? `id:${v.id}`
            : `meta:${String(v.sku || '').toLowerCase()}::${String(v.size || '').toLowerCase()}::${String(v.color || '').toLowerCase()}`;
        const prev = variantMap.get(varKey);
        if (!prev) {
          variantMap.set(varKey, { ...v });
        } else {
          const mergedVarImgs = mergeUniquePhotos(prev.images, v.images, prev.image ? [prev.image] : [], v.image ? [v.image] : []);
          variantMap.set(varKey, {
            ...prev,
            stock: Math.max(prev.stock, v.stock),
            image: mergedVarImgs[0] || prev.image || v.image,
            ...(mergedVarImgs.length > 0 ? { images: mergedVarImgs } : {}),
          });
        }
      }
    }

    const combinedVariants = Array.from(variantMap.values());
    const inStockVariants = combinedVariants.filter((v) => v.stock > 0);
    const totalStock = inStockVariants.reduce((sum, v) => sum + v.stock, 0);

    const combinedSizes = sortSizes(
      (inStockVariants.length > 0 ? inStockVariants : combinedVariants)
        .map((v) => v.size || '')
        .filter(Boolean)
    );

    const combinedColorImages: Record<string, string[]> = {};
    for (const e of entries) {
      for (const [colorKey, urls] of Object.entries(e.colorImages)) {
        const nk = normalizeColorName(colorKey);
        if (!nk) continue;
        const merged = mergeUniquePhotos(combinedColorImages[nk], urls);
        if (merged.length > 0) combinedColorImages[nk] = merged;
      }
    }

    const inStockColors = inStockVariants
      .map((v) => v.color || '')
      .filter(Boolean);
    const allColorNames =
      inStockColors.length > 0
        ? inStockColors
        : entries.flatMap((e) => e.realColors);
    const combinedColors = normalizeColorOptions(allColorNames);

    const combinedImages = mergeUniquePhotos(
      ...entries.map((e) => e.product.images),
      ...Object.values(combinedColorImages)
    );

    const lowestPrice = Math.min(...entries.map((e) => e.product.price).filter((n) => n > 0));
    const highestOriginal = Math.max(
      ...entries.map((e) => e.product.originalPrice || Math.round(e.product.price * 1.3))
    );

    const nextTag =
      totalStock <= 0
        ? 'SEM ESTOQUE'
        : totalStock <= 3
          ? 'POUCAS UNIDADES'
          : entries.some((e) => e.product.tag === 'NOVO DROP')
            ? 'NOVO DROP'
            : primary.product.tag;

    unified.push({
      ...primary.product,
      name: cleanTitle || primary.product.name,
      price: Number.isFinite(lowestPrice) ? lowestPrice : primary.product.price,
      originalPrice: Number.isFinite(highestOriginal) ? highestOriginal : primary.product.originalPrice,
      tag: nextTag,
      stockCount: totalStock,
      sizes: combinedSizes.length > 0 ? combinedSizes : primary.product.sizes,
      colors: combinedColors,
      images: combinedImages.length > 0 ? combinedImages : primary.product.images,
      ...(Object.keys(combinedColorImages).length > 0 ? { colorImages: combinedColorImages } : {}),
      variantsList: combinedVariants,
    });
    }
  }

  return unified;
}


