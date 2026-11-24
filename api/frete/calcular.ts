import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  calcularFreteMelhorEnvio,
  isValidBrazilianCep,
  MelhorEnvioValidationError,
  ProdutoFreteInput,
} from '../../lib/melhorEnvio';

function parseRequestBody(rawBody: unknown): Record<string, unknown> {
  if (rawBody === null || rawBody === undefined || rawBody === '') {
    return {};
  }
  if (typeof rawBody === 'string') {
    try {
      const parsed = JSON.parse(rawBody);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new MelhorEnvioValidationError('Corpo da requisição JSON deve ser um objeto.');
      }
      return parsed as Record<string, unknown>;
    } catch (err) {
      if (err instanceof MelhorEnvioValidationError) throw err;
      throw new MelhorEnvioValidationError('JSON inválido no corpo da requisição.');
    }
  }
  if (typeof rawBody === 'object' && !Array.isArray(rawBody)) {
    return rawBody as Record<string, unknown>;
  }
  throw new MelhorEnvioValidationError('Corpo da requisição inválido.');
}

/**
 * Vercel Serverless Function: POST /api/frete/calcular
 * Recebe CEP de destino e produtos (peso em kg, altura, largura, comprimento em cm e valor segurado),
 * consulta POST /api/v2/me/shipment/calculate no Melhor Envio e devolve as transportadoras formatadas.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      sucesso: false,
      erro: 'Método não permitido. Utilize POST.',
    });
  }

  try {
    const body = parseRequestBody(req.body);

    const cepDestino = String(
      body.cepDestino ?? body.cep ?? body.toPostalCode ?? body.postalCode ?? ''
    ).trim();

    const cepOrigem = body.cepOrigem !== undefined && body.cepOrigem !== null
      ? String(body.cepOrigem).trim()
      : undefined;

    const rawProdutos = (body.produtos ?? body.products ?? body.items) as ProdutoFreteInput[] | undefined;

    if (!cepDestino || !isValidBrazilianCep(cepDestino)) {
      return res.status(400).json({
        sucesso: false,
        erro: 'Informe o campo cepDestino válido com 8 dígitos numéricos.',
      });
    }

    if (cepOrigem !== undefined && cepOrigem !== '' && !isValidBrazilianCep(cepOrigem)) {
      return res.status(400).json({
        sucesso: false,
        erro: 'Informe o campo cepOrigem válido com 8 dígitos numéricos.',
      });
    }

    if (!Array.isArray(rawProdutos) || rawProdutos.length === 0) {
      return res.status(400).json({
        sucesso: false,
        erro: 'Informe o array produtos com peso (kg), altura, largura, comprimento (cm) e valorSegurado.',
      });
    }

    const resultado = await calcularFreteMelhorEnvio({
      cepDestino,
      cepOrigem: cepOrigem || undefined,
      produtos: rawProdutos,
    });

    return res.status(200).json(resultado);
  } catch (err: unknown) {
    if (err instanceof MelhorEnvioValidationError) {
      return res.status(err.statusCode).json({
        sucesso: false,
        erro: err.message,
      });
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Vercel /api/frete/calcular Error]:', message);
    return res.status(500).json({
      sucesso: false,
      erro: message,
    });
  }
}
