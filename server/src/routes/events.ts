import { Router, Request, Response } from 'express';
import { prisma } from '../services/bufferService';
import {
  generateCurl,
  generateNodeFetch,
  generatePythonRequests,
} from '../services/webhookUtils';

export const eventsRouter = Router();

// List events for an endpoint
eventsRouter.get('/endpoint/:endpointId', async (req: Request, res: Response) => {
  const endpointId = req.params.endpointId as string;
  const limit = parseInt(req.query.limit as string) || 50;

  try {
    const events = await prisma.webhookEvent.findMany({
      where: { endpointId },
      orderBy: { receivedAt: 'desc' },
      take: limit,
    });
    return res.json(events);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Get single event with full details
eventsRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const event = await prisma.webhookEvent.findUnique({
      where: { id },
      include: { replays: { orderBy: { replayedAt: 'desc' }, take: 10 } },
    });
    if (!event) return res.status(404).json({ error: 'Event not found' });
    return res.json(event);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Generate code snippets for an event
eventsRouter.get('/:id/snippets', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const event = await prisma.webhookEvent.findUnique({ where: { id } });
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const headers = JSON.parse(event.headers) as Record<string, string>;
    const snippetData = {
      method: event.method,
      headers,
      rawBody: event.rawBody,
      endpointId: event.endpointId,
    };

    return res.json({
      curl: generateCurl(snippetData),
      nodeFetch: generateNodeFetch(snippetData),
      python: generatePythonRequests(snippetData),
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Delete single event
eventsRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    await prisma.webhookEvent.delete({ where: { id } });
    return res.json({ deleted: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Delete all events for an endpoint
eventsRouter.delete('/endpoint/:endpointId', async (req: Request, res: Response) => {
  try {
    const endpointId = req.params.endpointId as string;
    const result = await prisma.webhookEvent.deleteMany({ where: { endpointId } });
    return res.json({ deletedCount: result.count });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});
