import type { Product } from '../types';

export interface OfficialBrand {
  id: string;
  name: string;
  category: 'tenis' | 'roupas';
  categoryLabel: string;
  tagline: string;
  description: string;
  badge: string;
  searchQuery: string;
  aliases: string[];
  bgGradient: string;
  accentColor: string;
  logoText: string;
  established?: string;
}

export const OFFICIAL_BRANDS: OfficialBrand[] = [
  // --- TÊNIS ---
  {
    id: 'brand-hocks',
    name: 'HOCKS',
    category: 'tenis',
    categoryLabel: 'Tênis & Skatewear',
    tagline: 'Criada no skate, feita para o asfalto',
    description: 'Pioneira no skate nacional desde 2002. Tênis resistentes com solado vulcanizado, durabilidade extrema e silhueta chunky clássica.',
    badge: 'Skatewear Original',
    searchQuery: 'hocks',
    aliases: ['hocks', 'hock'],
    bgGradient: 'from-amber-950/40 via-zinc-900 to-black',
    accentColor: '#F59E0B',
    logoText: 'HOCKS',
    established: 'Est. 2002'
  },
  {
    id: 'brand-tesla',
    name: 'Tesla Footwear',
    category: 'tenis',
    categoryLabel: 'Tênis & Skatewear',
    tagline: 'O auge dos tênis chunky dos anos 90 e 2000',
    description: 'Referência absoluta no skate retrô com os lendários modelos Hertz, Coil e Flow XL. Língua acolchoada, costuras reforçadas e cabedal robusto.',
    badge: 'Retro Skate Icon',
    searchQuery: 'tesla',
    aliases: ['tesla', 'tesla footwear'],
    bgGradient: 'from-red-950/50 via-zinc-900 to-black',
    accentColor: '#E50914',
    logoText: 'TESLA',
    established: 'Brasil'
  },
  {
    id: 'brand-qix',
    name: 'QIX',
    category: 'tenis',
    categoryLabel: 'Tênis & Skatewear',
    tagline: 'Mais de 30 anos no coração do skate nacional',
    description: 'Tradição pura das pistas brasileiras. Modelos clássicos que marcaram gerações de skatistas com sola costurada e visual underground raiz.',
    badge: 'Lenda do Skate',
    searchQuery: 'qix',
    aliases: ['qix'],
    bgGradient: 'from-blue-950/40 via-zinc-900 to-black',
    accentColor: '#3B82F6',
    logoText: 'QIX',
    established: 'Est. 1993'
  },
  {
    id: 'brand-havaianas',
    name: 'Havaianas',
    category: 'tenis',
    categoryLabel: 'Calçados & Slides',
    tagline: 'O legítimo lifestyle e conforto brasileiro',
    description: 'A clássica borracha vulcanizada em versões City Basic, estampas especiais Warner e collabs autênticas para o dia a dia e pós-sessão.',
    badge: '100% Original',
    searchQuery: 'havaianas',
    aliases: ['havaianas'],
    bgGradient: 'from-emerald-950/40 via-zinc-900 to-black',
    accentColor: '#10B981',
    logoText: 'HAVAIANAS',
    established: 'Brasil'
  },

  // --- ROUPAS ---
  {
    id: 'brand-chronic',
    name: 'CHRONIC',
    category: 'roupas',
    categoryLabel: 'Streetwear Pesado',
    tagline: 'A voz e o peso das ruas underground',
    description: 'A marca mais marginal e autêntica do streetwear nacional. Estampas provocativas, mensagens fortes e algodão pesado de máxima densidade.',
    badge: 'Underground Puro',
    searchQuery: 'chronic',
    aliases: ['chronic'],
    bgGradient: 'from-zinc-900 via-neutral-900 to-black',
    accentColor: '#FFFFFF',
    logoText: 'CHRONIC',
    established: '420g Heavy'
  },
  {
    id: 'brand-tripside',
    name: 'Trip Side',
    category: 'roupas',
    categoryLabel: 'Vestuário Oversized',
    tagline: 'Cortes boxy e estética contemporânea',
    description: 'Especialista em camisetas oversized, recortes bicolores e bordados exclusivos. Gola canelada fechada de 3cm e caimento estruturado que não desbota.',
    badge: 'Boxy Fit Oficial',
    searchQuery: 'trip side',
    aliases: ['trip side', 'tripside'],
    bgGradient: 'from-purple-950/40 via-zinc-900 to-black',
    accentColor: '#A855F7',
    logoText: 'TRIP SIDE',
    established: 'Drop Oficial'
  },
  {
    id: 'brand-fire',
    name: 'Fire Apparel',
    category: 'roupas',
    categoryLabel: 'Streetwear Urbano',
    tagline: 'Energia visual e presença nas ruas',
    description: 'Gráficos marcantes, estética agressiva e modelagens confortáveis para quem quer se destacar com peças cheias de personalidade.',
    badge: 'Atitude Urbana',
    searchQuery: 'fire',
    aliases: ['fire', 'fire apparel'],
    bgGradient: 'from-orange-950/40 via-zinc-900 to-black',
    accentColor: '#F97316',
    logoText: 'FIRE',
    established: 'Streetwear'
  },
  {
    id: 'brand-compton',
    name: 'Compton',
    category: 'roupas',
    categoryLabel: 'Hip-Hop & West Coast',
    tagline: 'Inspirada na cultura hip-hop mundial',
    description: 'A essência da costa oeste traduzida em peças oversized, moletons pesados e tipografias marcantes homenageando a história da cultura urbana.',
    badge: 'Hip-Hop Classic',
    searchQuery: 'compton',
    aliases: ['compton', 'comptom', 'compiton'],
    bgGradient: 'from-red-950/40 via-zinc-900 to-black',
    accentColor: '#EF4444',
    logoText: 'COMPTON',
    established: 'West Coast'
  },
  {
    id: 'brand-surfavel',
    name: 'Surfavel',
    category: 'roupas',
    categoryLabel: 'Praia & Asfalto',
    tagline: 'Conexão entre o mar e o concreto da cidade',
    description: 'Estilo descontraído que transita da praia para o streetwear urbano. Tecidos leves, bermudas d’água e estampas com pegada solar e livre.',
    badge: 'Lifestyle Conexão',
    searchQuery: 'surfavel',
    aliases: ['surfavel'],
    bgGradient: 'from-cyan-950/40 via-zinc-900 to-black',
    accentColor: '#06B6D4',
    logoText: 'SURFAVEL',
    established: 'Brasil'
  },
  {
    id: 'brand-4ticity',
    name: '4ticity',
    category: 'roupas',
    categoryLabel: 'Moda Streetwear',
    tagline: 'Força, autenticidade e estilo sem filtro',
    description: 'Designs modernos com acabamento impecável, costuras duplas e estampas em serigrafia de alta definição criadas para durar.',
    badge: 'Estilo Autêntico',
    searchQuery: '4ticity',
    aliases: ['4ticity'],
    bgGradient: 'from-rose-950/40 via-zinc-900 to-black',
    accentColor: '#F43F5E',
    logoText: '4TICITY',
    established: 'Original'
  },
  {
    id: 'brand-anthco',
    name: 'Anth Co.',
    category: 'roupas',
    categoryLabel: 'Headwear & Acessórios',
    tagline: 'A maior autoridade em bonés do país',
    description: 'Os melhores snapbacks, dad hats e buckets do mercado brasileiro. Modelagens que encaixam perfeito, bordados em alto relevo e tecidos nobres.',
    badge: 'Líder em Headwear',
    searchQuery: 'anth co',
    aliases: ['anth co', 'anthco', 'anth'],
    bgGradient: 'from-yellow-950/40 via-zinc-900 to-black',
    accentColor: '#EAB308',
    logoText: 'ANTH CO.',
    established: 'Desde 2004'
  },
  {
    id: 'brand-oncross',
    name: 'Oncross',
    category: 'roupas',
    categoryLabel: 'Cargos & Bermudas',
    tagline: 'Engenharia tática para o streetwear de peso',
    description: 'Especialista em calças e bermudas cargo táticas com sarja peletizada, bolsos funcionais e caimento perfeito para usar com tênis chunky.',
    badge: 'Cargo Specialist',
    searchQuery: 'oncross',
    aliases: ['oncross', 'on cross'],
    bgGradient: 'from-zinc-900 via-stone-900 to-black',
    accentColor: '#78716C',
    logoText: 'ONCROSS',
    established: 'Heavy Cargo'
  }
];

export function normalizeBrandText(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[._\-/\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function resolveOfficialBrand(brandFilter: string): OfficialBrand | undefined {
  const norm = normalizeBrandText(brandFilter);
  const compact = norm.replace(/\s+/g, '');
  if (!norm) return undefined;

  return OFFICIAL_BRANDS.find((b) => {
    const candidates = [b.id, b.name, b.searchQuery, ...b.aliases];
    return candidates.some((c) => {
      const cn = normalizeBrandText(c);
      return cn === norm || cn.replace(/\s+/g, '') === compact;
    });
  });
}

export function matchesBrandFilter(product: Product, brandFilter?: string): boolean {
  if (!brandFilter) return true;

  const normFilter = normalizeBrandText(brandFilter);
  if (!normFilter) return true;

  const matchedBrand = resolveOfficialBrand(brandFilter);
  const needles = matchedBrand
    ? Array.from(
        new Set(
          [matchedBrand.searchQuery, matchedBrand.name, ...matchedBrand.aliases]
            .map((t) => normalizeBrandText(t))
            .filter(Boolean)
        )
      )
    : [normFilter];

  const variantSkus = Array.isArray(product.variantsList)
    ? product.variantsList.map((v) => String(v?.sku || '')).join(' ')
    : '';

  const productText = normalizeBrandText(
    `${product.name || ''} ${product.integration?.sku || ''} ${variantSkus} ${product.description || ''}`
  );
  const compactProductText = productText.replace(/\s+/g, '');

  return needles.some((needle) => {
    const compactNeedle = needle.replace(/\s+/g, '');
    // Short single-word aliases (e.g. "fire", "anth", "qix") use word boundary matching to avoid false positives
    if (!needle.includes(' ') && needle.length <= 4) {
      const wordRegex = new RegExp(`(?:^|\\s)${escapeRegExp(needle)}(?:\\s|$)`, 'i');
      if (wordRegex.test(productText)) return true;
      // Also check SKU prefix when it's a 3-4 letter code like QIX
      const normSku = normalizeBrandText(product.integration?.sku || '');
      if (needle.length >= 3 && normSku.startsWith(needle)) return true;
      return false;
    }

    return productText.includes(needle) || (compactNeedle.length >= 5 && compactProductText.includes(compactNeedle));
  });
}
