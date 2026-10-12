import crypto from 'crypto';

// ─── Sensitive Data Redaction ────────────────────────────────────────────────
const SENSITIVE_KEYS = new Set([
  'authorization', 'api_key', 'apikey', 'secret', 'password',
  'passwd', 'card_number', 'cardnumber', 'token', 'access_token',
  'refresh_token', 'private_key', 'client_secret', 'x-api-key',
  'x-auth-token', 'cvv', 'ssn',
]);

export function redactSensitiveFields(obj: any, depth = 0): any {
  if (depth > 10) return obj; // Guard against circular refs
  if (typeof obj !== 'object' || obj === null) return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => redactSensitiveFields(item, depth + 1));
  }

  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = redactSensitiveFields(value, depth + 1);
    }
  }
  return result;
}

// ─── Schema Drift / Mutation Detection ──────────────────────────────────────
export interface SchemaMutation {
  added: string[];
  removed: string[];
  typeMutated: { field: string; from: string; to: string }[];
}

function flattenKeys(obj: any, prefix = ''): Record<string, string> {
  if (typeof obj !== 'object' || obj === null) return {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    result[fullKey] = Array.isArray(value) ? 'array' : typeof value;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      Object.assign(result, flattenKeys(value, fullKey));
    }
  }
  return result;
}

export function detectSchemaMutation(
  previousBody: any,
  currentBody: any
): SchemaMutation | null {
  try {
    const prev = flattenKeys(previousBody);
    const curr = flattenKeys(currentBody);

    const added = Object.keys(curr).filter((k) => !(k in prev));
    const removed = Object.keys(prev).filter((k) => !(k in curr));
    const typeMutated: SchemaMutation['typeMutated'] = [];

    for (const key of Object.keys(curr)) {
      if (key in prev && prev[key] !== curr[key]) {
        typeMutated.push({ field: key, from: prev[key], to: curr[key] });
      }
    }

    if (added.length === 0 && removed.length === 0 && typeMutated.length === 0) {
      return null;
    }

    return { added, removed, typeMutated };
  } catch {
    return null;
  }
}

// ─── HMAC Verification ───────────────────────────────────────────────────────
export type HmacStatus = 'VERIFIED' | 'TAMPERED' | 'UNVERIFIED';

export function verifyHmac(
  rawBody: Buffer | string,
  headers: Record<string, string>,
  secret: string | null | undefined
): HmacStatus {
  if (!secret) return 'UNVERIFIED';

  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);

  // GitHub-style: X-Hub-Signature-256: sha256=<hex>
  const githubSig = headers['x-hub-signature-256'] || headers['X-Hub-Signature-256'];
  if (githubSig) {
    const expected = `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
    return githubSig === expected ? 'VERIFIED' : 'TAMPERED';
  }

  // Stripe-style: Stripe-Signature: t=<ts>,v1=<hex>
  const stripeSig = headers['stripe-signature'] || headers['Stripe-Signature'];
  if (stripeSig) {
    const parts = Object.fromEntries(stripeSig.split(',').map((p: string) => p.split('=')));
    const timestamp = parts['t'];
    const v1 = parts['v1'];
    if (timestamp && v1) {
      const signedPayload = `${timestamp}.${body.toString()}`;
      const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
      return v1 === expected ? 'VERIFIED' : 'TAMPERED';
    }
  }

  // Generic X-Signature header
  const genericSig = headers['x-signature'] || headers['X-Signature'];
  if (genericSig) {
    const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
    return genericSig === expected ? 'VERIFIED' : 'TAMPERED';
  }

  return 'UNVERIFIED';
}

// ─── Code Snippet Generation ────────────────────────────────────────────────
export function generateCurl(event: {
  method: string;
  headers: Record<string, string>;
  rawBody: string;
  endpointId: string;
}): string {
  const headerLines = Object.entries(event.headers)
    .filter(([k]) => !['host', 'content-length'].includes(k.toLowerCase()))
    .map(([k, v]) => `  -H '${k}: ${v}'`)
    .join(' \\\n');

  const bodyPart = event.rawBody && event.rawBody !== '{}'
    ? `  -d '${event.rawBody.replace(/'/g, "'\\''")}' \\\n`
    : '';

  return `curl -X ${event.method} \\\n${headerLines} \\\n${bodyPart}  'http://localhost:3001/api/v1/ingest/${event.endpointId}'`;
}

export function generateNodeFetch(event: {
  method: string;
  headers: Record<string, string>;
  rawBody: string;
  endpointId: string;
}): string {
  const headersStr = JSON.stringify(
    Object.fromEntries(
      Object.entries(event.headers).filter(([k]) => !['host', 'content-length'].includes(k.toLowerCase()))
    ),
    null,
    2
  );

  return `const response = await fetch('http://localhost:3001/api/v1/ingest/${event.endpointId}', {
  method: '${event.method}',
  headers: ${headersStr},
  body: ${event.rawBody ? `\`${event.rawBody.replace(/`/g, '\\`')}\`` : 'undefined'},
});
const data = await response.json();
console.log(data);`;
}

export function generatePythonRequests(event: {
  method: string;
  headers: Record<string, string>;
  rawBody: string;
  endpointId: string;
}): string {
  const filteredHeaders = Object.fromEntries(
    Object.entries(event.headers).filter(([k]) => !['host', 'content-length'].includes(k.toLowerCase()))
  );
  const headersStr = JSON.stringify(filteredHeaders, null, 4);
  const bodyPart = event.rawBody ? `\ndata = '''${event.rawBody}'''\n` : '\ndata = None\n';

  return `import requests
import json

headers = ${headersStr}
${bodyPart}
response = requests.${event.method.toLowerCase()}(
    'http://localhost:3001/api/v1/ingest/${event.endpointId}',
    headers=headers,
    data=data
)
print(response.status_code, response.json())`;
}
