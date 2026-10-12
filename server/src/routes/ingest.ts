import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { prisma, pushToBuffer } from '../services/bufferService';
import {
  redactSensitiveFields,
  detectSchemaMutation,
  verifyHmac,
} from '../services/webhookUtils';
import { validateContract } from '../services/contractValidator';

export const ingestRouter = Router();

ingestRouter.post('/:endpointId', async (req: Request, res: Response) => {
  const endpointId = req.params.endpointId as string;
  const traceId = uuidv4();
  const startTime = Date.now();

  try {
    // Validate endpoint exists
    const endpoint = await prisma.endpoint.findUnique({ where: { id: endpointId } });
    if (!endpoint) {
      return res.status(404).json({ error: 'Endpoint not found', endpointId });
    }

    // Parse headers
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (v) headers[k] = Array.isArray(v) ? v.join(', ') : v;
    }

    // Get raw body (as Buffer from express.raw middleware)
    let rawBodyStr = '';
    let parsedBody: any = {};

    if (Buffer.isBuffer(req.body)) {
      rawBodyStr = req.body.toString('utf-8');
      try { parsedBody = JSON.parse(rawBodyStr); } catch { parsedBody = { _raw: rawBodyStr }; }
    } else if (typeof req.body === 'object') {
      parsedBody = req.body;
      rawBodyStr = JSON.stringify(req.body);
    } else {
      rawBodyStr = String(req.body || '{}');
      try { parsedBody = JSON.parse(rawBodyStr); } catch { parsedBody = {}; }
    }

    // HMAC Verification
    const hmacStatus = verifyHmac(req.body as Buffer, headers, endpoint.hmacSecret);

    // JSON Schema / OpenAPI Contract Validation
    const { status: contractStatus, errors: contractErrorsList } = validateContract(
      endpoint.contractSchema,
      parsedBody
    );
    const contractErrors = contractErrorsList.length > 0 ? JSON.stringify(contractErrorsList) : null;

    // Sensitive Data Redaction
    const redactedBody = redactSensitiveFields(parsedBody);

    // Schema Mutation Detection — compare against latest event on this endpoint
    let schemaMutation: string | null = null;
    const latestEvent = await prisma.webhookEvent.findFirst({
      where: { endpointId },
      orderBy: { receivedAt: 'desc' },
    });

    if (latestEvent) {
      try {
        const previousBody = JSON.parse(latestEvent.rawBody);
        const mutation = detectSchemaMutation(previousBody, parsedBody);
        if (mutation) schemaMutation = JSON.stringify(mutation);
      } catch { /* ignore parse errors */ }
    }

    const sourceIp = (req.headers['x-forwarded-for'] as string) ||
      req.socket?.remoteAddress || 'unknown';

    const eventId = uuidv4();

    // Push to in-memory buffer (returns 202 immediately — no blocking DB call)
    pushToBuffer({
      id: eventId,
      endpointId,
      method: req.method,
      headers: JSON.stringify(headers),
      rawBody: rawBodyStr,
      redactedBody: JSON.stringify(redactedBody),
      sourceIp,
      hmacStatus,
      schemaMutation,
      contractStatus,
      contractErrors,
      traceId,
    });

    const processingMs = Date.now() - startTime;

    return res.status(202).json({
      accepted: true,
      traceId,
      eventId,
      processingMs,
      hmacStatus,
      hasSchemaMutation: !!schemaMutation,
      message: 'Event buffered and will be persisted asynchronously',
    });
  } catch (err: any) {
    console.error('[Ingest] Error:', err.message);
    return res.status(500).json({ error: 'Internal server error', traceId });
  }
});
