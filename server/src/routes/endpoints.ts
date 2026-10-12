import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../services/bufferService';

export const endpointRouter = Router();

// List all endpoints
endpointRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const endpoints = await prisma.endpoint.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { events: true } } },
    });
    return res.json(endpoints);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Create endpoint
endpointRouter.post('/', async (req: Request, res: Response) => {
  const { name, hmacSecret, contractSchema } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  try {
    const slug = uuidv4().split('-')[0];
    const endpoint = await prisma.endpoint.create({
      data: {
        id: uuidv4(),
        name,
        slug,
        hmacSecret: hmacSecret || null,
        contractSchema: contractSchema || null,
      },
    });
    return res.status(201).json(endpoint);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Update endpoint (e.g. name, hmacSecret, contractSchema)
endpointRouter.patch('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { name, hmacSecret, contractSchema } = req.body;
    const updated = await prisma.endpoint.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(hmacSecret !== undefined && { hmacSecret }),
        ...(contractSchema !== undefined && { contractSchema }),
      },
      include: { _count: { select: { events: true } } },
    });
    return res.json(updated);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Get single endpoint
endpointRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const endpoint = await prisma.endpoint.findUnique({
      where: { id },
      include: { _count: { select: { events: true } } },
    });
    if (!endpoint) return res.status(404).json({ error: 'Not found' });
    return res.json(endpoint);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Delete endpoint
endpointRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    await prisma.endpoint.delete({ where: { id } });
    return res.json({ deleted: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});
