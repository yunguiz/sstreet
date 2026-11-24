const DEFAULT_MELHOR_ENVIO_URL = 'https://melhorenvio.com.br';
const DEFAULT_FROM_CEP = '35900539';
const DEFAULT_USER_AGENT = 'StreetStore (streetstore364@gmail.com)';
const MIN_INSURANCE_BRL = 20;

export class MelhorEnvioValidationError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number = 400) {
    super(message);
    this.name = 'MelhorEnvioValidationError';
    this.statusCode = statusCode;
  }
}

export interface MelhorEnvioSenderConfig {
  nome: string;
  telefone: string;
  email: string;
  documento: string;
  endereco: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  estado: string;
  cep: string;
}

export function sanitizeCep(cep: string): string {
  return String(cep || '').replace(/\D/g, '').slice(0, 8);
}

export function isValidBrazilianCep(cep: string): boolean {
  const clean = sanitizeCep(cep);
  return /^\d{8}$/.test(clean) && !/^(\d)\1{7}$/.test(clean);
}

function resolveMelhorEnvioBaseUrl(): string {
  const candidates = [process.env.MELHOR_ENVIO_URL, process.env.MELHOR_ENVIO_API_URL];
  for (const raw of candidates) {
    const cleaned = (raw || '')
      .trim()
      .replace(/\/+$/, '')
      .replace(/\/api\/v2$/i, '');
    if (/^https?:\/\//i.test(cleaned)) {
      return cleaned;
    }
  }
  return DEFAULT_MELHOR_ENVIO_URL;
}

export function getMelhorEnvioSenderFromEnv(): MelhorEnvioSenderConfig {
  const envCep = sanitizeCep(process.env.MELHOR_ENVIO_FROM_POSTAL_CODE || DEFAULT_FROM_CEP);
  const cep = isValidBrazilianCep(envCep) ? envCep : DEFAULT_FROM_CEP;

  const envState = (process.env.MELHOR_ENVIO_FROM_STATE || 'MG').trim().toUpperCase().slice(0, 2);

  return {
    nome: (process.env.MELHOR_ENVIO_FROM_NAME || 'Street Store Itabira').trim(),
    telefone: (process.env.MELHOR_ENVIO_FROM_PHONE || '31984806556').replace(/\D/g, '') || '31984806556',
    email: (process.env.MELHOR_ENVIO_FROM_EMAIL || 'streetstore364@gmail.com').trim(),
    documento: (process.env.MELHOR_ENVIO_FROM_DOCUMENT || '45892109000132').replace(/\D/g, ''),
    endereco: (process.env.MELHOR_ENVIO_FROM_STREET || 'Avenida João Pinheiro').trim(),
    numero: (process.env.MELHOR_ENVIO_FROM_NUMBER || '353').trim(),
    complemento: (process.env.MELHOR_ENVIO_FROM_COMPLEMENT || '').trim(),
    bairro: (process.env.MELHOR_ENVIO_FROM_DISTRICT || 'Centro').trim(),
    cidade: (process.env.MELHOR_ENVIO_FROM_CITY || 'Itabira').trim(),
    estado: envState.length === 2 ? envState : 'MG',
    cep,
  };
}

function getMelhorEnvioConfig() {
  const token = (process.env.MELHOR_ENVIO_TOKEN || '').trim();
  if (!token) {
    throw new Error('Variável de ambiente MELHOR_ENVIO_TOKEN não configurada.');
  }

  const rawUrl = resolveMelhorEnvioBaseUrl();
  const userAgent = (process.env.MELHOR_ENVIO_USER_AGENT || DEFAULT_USER_AGENT).trim();
  const sender = getMelhorEnvioSenderFromEnv();

  return {
    token,
    apiBaseUrl: `${rawUrl}/api/v2`,
    userAgent,
    fromPostalCode: sender.cep,
    sender,
  };
}

function parseOptionalPositiveNumber(
  raw: unknown,
  fallback: number,
  fieldName: string,
  allowZero: boolean = false
): number {
  if (raw === undefined || raw === null || raw === '') {
    return fallback;
  }
  const num = Number(raw);
  if (!Number.isFinite(num)) {
    throw new MelhorEnvioValidationError(`Campo "${fieldName}" deve ser um número válido.`);
  }
  if (allowZero ? num < 0 : num <= 0) {
    throw new MelhorEnvioValidationError(
      `Campo "${fieldName}" deve ser ${allowZero ? 'maior ou igual a zero' : 'maior que zero'}.`
    );
  }
  return num;
}

export interface ProdutoFreteInput {
  id?: string | number;
  // Padrão Melhor Envio
  weight?: number;
  height?: number;
  width?: number;
  length?: number;
  insurance_value?: number;
  quantity?: number;
  // Aliases em português para flexibilidade
  peso?: number; // em kg
  altura?: number; // em cm
  largura?: number; // em cm
  comprimento?: number; // em cm
  valorSegurado?: number;
  preco?: number;
  price?: number;
  quantidade?: number;
}

export interface TransportadoraFormatada {
  id: number;
  nome: string;
  empresa: {
    id: number;
    nome: string;
    logo: string;
  };
  preco: number;
  precoFormatado: string;
  desconto: number;
  moeda: string;
  prazoEntregaDias: number;
  prazoTexto: string;
}

export interface CalcularFreteResult {
  sucesso: boolean;
  cepOrigem: string;
  cepDestino: string;
  transportadoras: TransportadoraFormatada[];
}

/**
 * Calcula fretes disponíveis na API v2 do Melhor Envio (POST /api/v2/me/shipment/calculate).
 */
export async function calcularFreteMelhorEnvio(params: {
  cepDestino: string;
  cepOrigem?: string;
  produtos: ProdutoFreteInput[];
}): Promise<CalcularFreteResult> {
  const cepDestino = sanitizeCep(params.cepDestino);
  if (!isValidBrazilianCep(cepDestino)) {
    throw new MelhorEnvioValidationError('CEP de destino inválido. Informe 8 dígitos numéricos válidos.');
  }

  if (!Array.isArray(params.produtos) || params.produtos.length === 0) {
    throw new MelhorEnvioValidationError(
      'Informe ao menos um produto com dimensões e peso para cálculo do frete.'
    );
  }

  if (params.produtos.length > 50) {
    throw new MelhorEnvioValidationError('Limite máximo de 50 itens por cálculo de frete excedido.');
  }

  const productsPayload = params.produtos.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new MelhorEnvioValidationError(`Item na posição ${index} do array produtos é inválido.`);
    }

    const peso = parseOptionalPositiveNumber(item.weight ?? item.peso, 0.35, `produtos[${index}].peso`);
    const altura = parseOptionalPositiveNumber(item.height ?? item.altura, 5, `produtos[${index}].altura`);
    const largura = parseOptionalPositiveNumber(item.width ?? item.largura, 24, `produtos[${index}].largura`);
    const comprimento = parseOptionalPositiveNumber(
      item.length ?? item.comprimento,
      30,
      `produtos[${index}].comprimento`
    );
    const valorSegurado = parseOptionalPositiveNumber(
      item.insurance_value ?? item.valorSegurado ?? item.preco ?? item.price,
      50,
      `produtos[${index}].valorSegurado`,
      true
    );
    const quantidadeRaw = parseOptionalPositiveNumber(
      item.quantity ?? item.quantidade,
      1,
      `produtos[${index}].quantidade`
    );

    return {
      id: String(item.id ?? `item-${index + 1}`),
      width: Math.max(11, Math.min(200, largura)),
      height: Math.max(2, Math.min(200, altura)),
      length: Math.max(16, Math.min(200, comprimento)),
      weight: Math.max(0.1, Math.min(300, Number(peso.toFixed(3)))),
      insurance_value: Math.max(MIN_INSURANCE_BRL, Number(valorSegurado.toFixed(2))),
      quantity: Math.max(1, Math.min(999, Math.round(quantidadeRaw))),
    };
  });

  const { token, apiBaseUrl, userAgent, fromPostalCode } = getMelhorEnvioConfig();
  const cepOrigem = params.cepOrigem ? sanitizeCep(params.cepOrigem) : fromPostalCode;
  if (!isValidBrazilianCep(cepOrigem)) {
    throw new MelhorEnvioValidationError('CEP de origem inválido. Informe 8 dígitos numéricos válidos.');
  }

  const response = await fetch(`${apiBaseUrl}/me/shipment/calculate`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'User-Agent': userAgent,
    },
    body: JSON.stringify({
      from: { postal_code: cepOrigem },
      to: { postal_code: cepDestino },
      products: productsPayload,
    }),
  });

  const rawText = await response.text();
  let json: unknown;
  try {
    json = JSON.parse(rawText);
  } catch {
    throw new Error(`Resposta inválida do Melhor Envio [${response.status}]: ${rawText.slice(0, 300)}`);
  }

  if (!response.ok || !Array.isArray(json)) {
    const errObj = (json && typeof json === 'object' ? json : {}) as {
      message?: string;
      error?: string;
      errors?: unknown;
    };
    const detail = errObj?.message || errObj?.error || rawText.slice(0, 300);
    throw new Error(`Erro Melhor Envio [${response.status}]: ${detail}`);
  }

  const transportadoras: TransportadoraFormatada[] = json
    .filter((opt: unknown): opt is Record<string, any> => {
      if (!opt || typeof opt !== 'object') return false;
      const rec = opt as Record<string, any>;
      if (rec.error) return false;
      const parsedPrice = Number.parseFloat(String(rec.custom_price ?? rec.price ?? ''));
      const parsedId = Number(rec.id);
      return Number.isFinite(parsedPrice) && parsedPrice >= 0 && Number.isFinite(parsedId) && parsedId > 0;
    })
    .map((opt) => {
      const preco = Number(Number.parseFloat(String(opt.custom_price ?? opt.price ?? '0')).toFixed(2));
      const rawDays = Number.parseInt(String(opt.custom_delivery_time ?? opt.delivery_time ?? '5'), 10);
      const prazo = Number.isFinite(rawDays) && rawDays >= 0 ? rawDays : 5;
      const rawDiscount = Number.parseFloat(String(opt.discount ?? '0'));
      const desconto = Number.isFinite(rawDiscount) && rawDiscount >= 0 ? Number(rawDiscount.toFixed(2)) : 0;

      return {
        id: Number(opt.id),
        nome: String(opt.name || 'Frete').trim(),
        empresa: {
          id: Number(opt.company?.id || 0),
          nome: String(opt.company?.name || 'Transportadora').trim(),
          logo: typeof opt.company?.picture === 'string' ? opt.company.picture : '',
        },
        preco,
        precoFormatado: preco.toLocaleString('pt-BR', {
          style: 'currency',
          currency: 'BRL',
        }),
        desconto,
        moeda: String(opt.currency || 'BRL'),
        prazoEntregaDias: prazo,
        prazoTexto: prazo === 1 ? '1 dia útil' : `${prazo} dias úteis`,
      };
    })
    .sort((a, b) => a.preco - b.preco);

  return {
    sucesso: true,
    cepOrigem,
    cepDestino,
    transportadoras,
  };
}

export interface PedidoEtiquetaMelhorEnvio {
  pedidoId: string | number;
  servicoId: number; // ID do serviço selecionado no cálculo (ex: 1=PAC, 2=SEDEX, 3=Jadlog Package)
  valorTotal: number;
  remetente?: {
    nome: string;
    telefone: string;
    email: string;
    documento: string; // CPF ou CNPJ
    endereco: string;
    numero: string;
    complemento?: string;
    bairro: string;
    cidade: string;
    estado: string;
    cep: string;
  };
  destinatario: {
    nome: string;
    telefone: string;
    email: string;
    documento?: string; // CPF/CNPJ do cliente
    endereco: string;
    numero: string;
    complemento?: string;
    bairro: string;
    cidade: string;
    estado: string;
    cep: string;
  };
  itens: Array<{
    nome: string;
    quantidade: number;
    valorUnitario: number;
    pesoKg?: number;
    alturaCm?: number;
    larguraCm?: number;
    comprimentoCm?: number;
  }>;
  notaFiscal?: {
    chave?: string;
  };
}

export interface CriarEtiquetaResult {
  sucesso: boolean;
  cartId: string;
  protocolo?: string;
  status?: string;
  preco?: number;
}

/**
 * Função auxiliar: insere o frete do pedido pago no carrinho do Melhor Envio (POST /api/v2/me/cart)
 * para posterior compra/emissão da etiqueta assim que o pagamento for confirmado.
 */
export async function criarEtiquetaMelhorEnvio(
  pedido: PedidoEtiquetaMelhorEnvio
): Promise<CriarEtiquetaResult> {
  if (!pedido || typeof pedido !== 'object') {
    throw new MelhorEnvioValidationError('Dados do pedido ausentes para geração de etiqueta.');
  }
  if (!Array.isArray(pedido.itens) || pedido.itens.length === 0) {
    throw new MelhorEnvioValidationError('Informe ao menos um item no pedido para gerar etiqueta.');
  }
  if (!isValidBrazilianCep(pedido.destinatario?.cep)) {
    throw new MelhorEnvioValidationError('CEP do destinatário inválido para geração de etiqueta.');
  }

  const { token, apiBaseUrl, userAgent, sender } = getMelhorEnvioConfig();

  const from = pedido.remetente
    ? {
        nome: (pedido.remetente.nome || sender.nome).trim(),
        telefone: (pedido.remetente.telefone || sender.telefone).replace(/\D/g, ''),
        email: (pedido.remetente.email || sender.email).trim(),
        documento: (pedido.remetente.documento || sender.documento).replace(/\D/g, ''),
        endereco: (pedido.remetente.endereco || sender.endereco).trim(),
        numero: (pedido.remetente.numero || sender.numero).trim(),
        complemento: (pedido.remetente.complemento || sender.complemento || '').trim(),
        bairro: (pedido.remetente.bairro || sender.bairro).trim(),
        cidade: (pedido.remetente.cidade || sender.cidade).trim(),
        estado: (pedido.remetente.estado || sender.estado).trim().slice(0, 2).toUpperCase(),
        cep: isValidBrazilianCep(pedido.remetente.cep) ? sanitizeCep(pedido.remetente.cep) : sender.cep,
      }
    : sender;

  const totalPeso = Math.max(
    0.35,
    pedido.itens.reduce((acc, item) => acc + (item.pesoKg ?? 0.35) * Math.max(1, item.quantidade), 0)
  );
  const maxAltura = Math.max(
    10,
    pedido.itens.reduce((acc, item) => acc + (item.alturaCm ?? 5) * Math.max(1, item.quantidade), 0)
  );
  const maxLargura = Math.max(24, ...pedido.itens.map((i) => i.larguraCm ?? 26));
  const maxComprimento = Math.max(30, ...pedido.itens.map((i) => i.comprimentoCm ?? 30));

  const cartPayload = {
    service: Number(pedido.servicoId) || 1,
    from: {
      name: from.nome,
      phone: from.telefone.replace(/\D/g, ''),
      email: from.email,
      document: from.documento.replace(/\D/g, ''),
      address: from.endereco,
      number: from.numero,
      complement: from.complemento || '',
      district: from.bairro,
      city: from.cidade,
      state_abbr: from.estado.slice(0, 2).toUpperCase(),
      country_id: 'BR',
      postal_code: sanitizeCep(from.cep),
    },
    to: {
      name: pedido.destinatario.nome,
      phone: pedido.destinatario.telefone.replace(/\D/g, ''),
      email: pedido.destinatario.email,
      document: pedido.destinatario.documento ? pedido.destinatario.documento.replace(/\D/g, '') : undefined,
      address: pedido.destinatario.endereco,
      number: pedido.destinatario.numero || 'S/N',
      complement: pedido.destinatario.complemento || '',
      district: pedido.destinatario.bairro,
      city: pedido.destinatario.cidade,
      state_abbr: pedido.destinatario.estado.slice(0, 2).toUpperCase(),
      country_id: 'BR',
      postal_code: sanitizeCep(pedido.destinatario.cep),
    },
    products: pedido.itens.map((item) => ({
      name: item.nome,
      quantity: Math.max(1, item.quantidade),
      unitary_value: Math.max(1, Number(item.valorUnitario) || 0),
    })),
    volumes: [
      {
        height: Math.min(100, Math.round(maxAltura)),
        width: Math.min(100, Math.round(maxLargura)),
        length: Math.min(100, Math.round(maxComprimento)),
        weight: Number(totalPeso.toFixed(3)),
      },
    ],
    options: {
      insurance_value: Math.max(MIN_INSURANCE_BRL, Number(pedido.valorTotal) || 0),
      receipt: false,
      own_hand: false,
      reverse: false,
      non_commercial: !pedido.notaFiscal?.chave,
      invoice: pedido.notaFiscal?.chave ? { key: pedido.notaFiscal.chave } : undefined,
      platform: 'Street Store',
      tags: [{ tag: `Pedido #${pedido.pedidoId}`, url: '' }],
    },
  };

  const response = await fetch(`${apiBaseUrl}/me/cart`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'User-Agent': userAgent,
    },
    body: JSON.stringify(cartPayload),
  });

  const rawText = await response.text();
  let data: any;
  try {
    data = JSON.parse(rawText);
  } catch {
    throw new Error(`Resposta inválida ao inserir etiqueta no Melhor Envio [${response.status}]: ${rawText.slice(0, 300)}`);
  }

  if (!response.ok || !data?.id) {
    const errMsg = data?.message || JSON.stringify(data?.errors || data || rawText);
    throw new Error(`Falha ao criar etiqueta no carrinho Melhor Envio [${response.status}]: ${errMsg}`);
  }

  return {
    sucesso: true,
    cartId: String(data.id),
    protocolo: data.protocol ? String(data.protocol) : undefined,
    status: data.status ? String(data.status) : undefined,
    preco: data.price !== undefined ? Number(data.price) : undefined,
  };
}
