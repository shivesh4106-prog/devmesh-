import { PrismaClient } from '@prisma/client';
import { broadcastEvent } from './socketService';

const prisma = new PrismaClient();

interface BufferedEvent {
  id: string;
  endpointId: string;
  method: string;
  headers: string;
  rawBody: string;
  redactedBody: string;
  sourceIp: string;
  hmacStatus: string;
  schemaMutation: string | null;
  traceId: string;
}

// In-memory queue — decouples HTTP 202 response from DB write
const eventQueue: BufferedEvent[] = [];
let isDraining = false;

export function pushToBuffer(event: BufferedEvent) {
  eventQueue.push(event);
}

export async function startBufferDrainer() {
  console.log('[Buffer] In-memory event buffer drainer started (100ms interval)');
  setInterval(async () => {
    if (isDraining || eventQueue.length === 0) return;
    isDraining = true;

    const batch = eventQueue.splice(0, 50); // Process up to 50 at a time

    try {
      for (const ev of batch) {
        await prisma.webhookEvent.create({
          data: {
            id: ev.id,
            endpointId: ev.endpointId,
            method: ev.method,
            headers: ev.headers,
            rawBody: ev.rawBody,
            redactedBody: ev.redactedBody,
            sourceIp: ev.sourceIp,
            hmacStatus: ev.hmacStatus,
            schemaMutation: ev.schemaMutation,
            traceId: ev.traceId,
          },
        });

        // Broadcast to all connected WebSocket clients after DB persist
        broadcastEvent('new_event', {
          id: ev.id,
          endpointId: ev.endpointId,
          method: ev.method,
          hmacStatus: ev.hmacStatus,
          schemaMutation: ev.schemaMutation ? JSON.parse(ev.schemaMutation) : null,
          traceId: ev.traceId,
          receivedAt: new Date().toISOString(),
          redactedBody: JSON.parse(ev.redactedBody),
          headers: JSON.parse(ev.headers),
        });
      }

      if (batch.length > 0) {
        console.log(`[Buffer] Persisted ${batch.length} event(s) to MySQL`);
      }
    } catch (err: any) {
      console.error('[Buffer] Error persisting events:', err.message);
      // Re-queue failed events
      eventQueue.unshift(...batch);
    } finally {
      isDraining = false;
    }
  }, 100);
}

export { prisma };
