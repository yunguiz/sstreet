import dotenv from 'dotenv';
dotenv.config();

const BLING_TOKEN_ENDPOINT = 'https://www.bling.com.br/Api/v3/oauth/token';
const BLING_TOKEN_FALLBACK_ENDPOINT = 'https://api.bling.com.br/v3/oauth/token';
const BLING_API_BASE = 'https://api.bling.com.br/v3';

const code = process.argv[2];

if (!code) {
  console.log('Uso: node scripts/sync-bling.js <CODIGO_AUTORIZACAO_OU_TOKEN>');
  process.exit(1);
}

const clientId = (process.env.BLING_CLIENT_ID || '').trim();
const clientSecret = (process.env.BLING_CLIENT_SECRET || '').trim();
if (!clientId || !clientSecret) {
  console.error('Erro: defina BLING_CLIENT_ID e BLING_CLIENT_SECRET no .env antes de executar este script.');
  process.exit(1);
}

const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

async function run() {
  let cleanCode = code.trim();
  if (cleanCode.includes('code=')) {
    const params = new URLSearchParams(cleanCode.split('?')[1] || cleanCode);
    cleanCode = params.get('code') || cleanCode;
  }

  console.log('Trocando código no Bling...');

  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: cleanCode,
    }).toString();

    const headers = {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'User-Agent': 'StreetStore/1.0',
    };

    let res = await fetch(BLING_TOKEN_ENDPOINT, {
      method: 'POST',
      headers,
      body,
    });

    if (res.status === 403) {
      res = await fetch(BLING_TOKEN_FALLBACK_ENDPOINT, {
        method: 'POST',
        headers,
        body,
      });
    }

    const json = await res.json();
    console.log('Resposta do Bling:', { ok: res.ok, status: res.status, hasAccessToken: Boolean(json.access_token) });

    if (json.access_token) {
      const fs = await import('fs');
      const tokenData = {
        access_token: json.access_token,
        refresh_token: json.refresh_token,
        expires_in: json.expires_in || 21600,
        token_type: json.token_type || 'Bearer',
        scope: json.scope || '',
        obtained_at: Date.now(),
      };
      fs.writeFileSync('.bling_tokens.json', JSON.stringify(tokenData, null, 2));
      console.log('✅ Tokens salvos em .bling_tokens.json!');

      const prodRes = await fetch(`${BLING_API_BASE}/produtos?pagina=1&limite=100`, {
        headers: {
          Authorization: `Bearer ${json.access_token}`,
          Accept: 'application/json',
        },
      });
      const prodJson = await prodRes.json();
      console.log(`📦 Produtos encontrados no Bling: ${prodJson.data?.length || 0}`);
    }
  } catch (err) {
    console.error('Erro:', err);
  }
}

run();
