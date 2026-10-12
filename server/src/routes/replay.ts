import { Router, Request, Response } from 'express';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../services/bufferService';

export const replayRouter = Router();

interface ReplayBody {
  targetUrl: string;
  delayMs?: number;
  chaosMode?: 'timeout' | 'error429' | 'error504' | null;
  customBody?: string;
  customHeaders?: Record<string, string>;
}

replayRouter.post('/:eventId', async (req: Request, res: Response) => {
  const eventId = req.params.eventId as string;
  const { targetUrl, delayMs = 0, chaosMode, customBody, customHeaders } = req.body as ReplayBody;

  if (!targetUrl) {
    return res.status(400).json({ error: 'targetUrl is required' });
  }

  try {
    const event = await prisma.webhookEvent.findUnique({ where: { id: eventId } });
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // ── Chaos & Latency Injection ─────────────────────────────────────────
    const clampedDelay = Math.min(Math.max(delayMs || 0, 0), 5000);
    if (clampedDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, clampedDelay));
    }

    let responseStatus: number | null = null;
    let responseBody: string | null = null;
    let latencyMs: number | null = null;
    let success = false;
    let chaosTriggered = false;

    // Simulate chaos modes without hitting target URL
    if (chaosMode === 'error429') {
      chaosTriggered = true;
      responseStatus = 429;
      responseBody = JSON.stringify({ error: 'Too Many Requests', chaos: true, simulated: true });
      latencyMs = clampedDelay;
    } else if (chaosMode === 'error504') {
      chaosTriggered = true;
      responseStatus = 504;
      responseBody = JSON.stringify({ error: 'Gateway Timeout', chaos: true, simulated: true });
      latencyMs = clampedDelay;
    } else if (chaosMode === 'timeout') {
      chaosTriggered = true;
      responseStatus = 0;
      responseBody = JSON.stringify({ error: 'Connection Timeout (Simulated)', chaos: true });
      latencyMs = 5000;
    } else {
      // Real forwarding to target URL
      const headers = JSON.parse(event.headers) as Record<string, string>;
      const forwardHeaders: Record<string, string> = {};

      for (const [k, v] of Object.entries(headers)) {
        if (!['host', 'content-length', 'connection'].includes(k.toLowerCase())) {
          forwardHeaders[k] = v;
        }
      }
      if (customHeaders && typeof customHeaders === 'object') {
        for (const [k, v] of Object.entries(customHeaders)) {
          forwardHeaders[k] = String(v);
        }
      }
      forwardHeaders['x-devmesh-replay'] = 'true';
      forwardHeaders['x-devmesh-trace'] = event.traceId;

      const reqStart = Date.now();
      try {
        const payloadToSend = customBody !== undefined ? customBody : event.rawBody;
        const axiosResp = await axios({
          method: event.method as any,
          url: targetUrl,
          headers: forwardHeaders,
          data: payloadToSend,
          timeout: 10000,
          validateStatus: () => true, // Don't throw on non-2xx
        });
        latencyMs = Date.now() - reqStart;
        responseStatus = axiosResp.status;
        responseBody = typeof axiosResp.data === 'string'
          ? axiosResp.data.substring(0, 2000)
          : JSON.stringify(axiosResp.data).substring(0, 2000);
        success = axiosResp.status >= 200 && axiosResp.status < 300;
      } catch (axErr: any) {
        latencyMs = Date.now() - reqStart;
        responseStatus = 0;
        responseBody = axErr.message;
        success = false;
      }
    }

    // Persist replay log
    const replayLog = await prisma.replayLog.create({
      data: {
        id: uuidv4(),
        eventId,
        targetUrl,
        delayMs: clampedDelay,
        chaosMode: chaosMode || null,
        responseStatus,
        responseBody,
        latencyMs,
        success,
      },
    });

    return res.status(200).json({
      replayId: replayLog.id,
      eventId,
      targetUrl,
      delayMs: clampedDelay,
      chaosMode: chaosMode || null,
      chaosTriggered,
      responseStatus,
      responseBodyPreview: responseBody?.substring(0, 500),
      latencyMs,
      success,
    });
  } catch (err: any) {
    console.error('[Replay] Error:', err.message);
    return res.status(500).json({ error: 'Replay failed', detail: err.message });
  }
});

// Get replay logs for an event
replayRouter.get('/logs/:eventId', async (req: Request, res: Response) => {
  const eventId = req.params.eventId as string;
  try {
    const logs = await prisma.replayLog.findMany({
      where: { eventId },
      orderBy: { replayedAt: 'desc' },
      take: 20,
    });
    return res.json(logs);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});
