import { Router, Request, Response } from 'express';
import { prisma } from '../services/bufferService';

export const analyticsRouter = Router();

analyticsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const endpointId = req.query.endpointId as string | undefined;

    const eventWhere = endpointId ? { endpointId } : {};

    // 1. Fetch total events
    const totalEvents = await prisma.webhookEvent.count({ where: eventWhere });

    // 2. Fetch all events (capped at 500 for fast analytics) to compute metrics
    const events = await prisma.webhookEvent.findMany({
      where: eventWhere,
      orderBy: { receivedAt: 'desc' },
      take: 500,
      select: {
        id: true,
        endpointId: true,
        method: true,
        headers: true,
        rawBody: true,
        hmacStatus: true,
        schemaMutation: true,
        contractStatus: true,
        receivedAt: true,
      },
    });

    // 3. HMAC breakdown
    let verifiedCount = 0;
    let tamperedCount = 0;
    let unverifiedCount = 0;

    // 4. Contract validation breakdown
    let contractValidCount = 0;
    let contractViolatedCount = 0;
    let contractNoneCount = 0;

    // 5. Schema drift metrics
    let driftCount = 0;
    let totalAddedFields = 0;
    let totalRemovedFields = 0;
    let totalMutatedTypes = 0;

    // 6. Top event types & providers breakdown
    const eventTypeCounts: Record<string, number> = {};

    // 7. Time distribution (grouped by hourly or 10-minute buckets)
    const timeBuckets: Record<string, number> = {};

    for (const ev of events) {
      // HMAC
      if (ev.hmacStatus === 'VERIFIED') verifiedCount++;
      else if (ev.hmacStatus === 'TAMPERED') tamperedCount++;
      else unverifiedCount++;

      // Contract
      if (ev.contractStatus === 'VALID') contractValidCount++;
      else if (ev.contractStatus === 'VIOLATED') contractViolatedCount++;
      else contractNoneCount++;

      // Drift
      if (ev.schemaMutation) {
        driftCount++;
        try {
          const mut = JSON.parse(ev.schemaMutation);
          if (mut.added) totalAddedFields += mut.added.length;
          if (mut.removed) totalRemovedFields += mut.removed.length;
          if (mut.typeMutated) totalMutatedTypes += mut.typeMutated.length;
        } catch { /* ignore */ }
      }

      // Event Type extraction
      let identifiedType = 'generic';
      try {
        const hdrs = JSON.parse(ev.headers);
        const ghEvent = hdrs['x-github-event'] || hdrs['X-GitHub-Event'];
        const stripeSig = hdrs['stripe-signature'] || hdrs['Stripe-Signature'];
        const shopifyTopic = hdrs['x-shopify-topic'] || hdrs['X-Shopify-Topic'];

        const bodyObj = JSON.parse(ev.rawBody);

        if (ghEvent) {
          identifiedType = `github.${ghEvent}`;
        } else if (stripeSig || bodyObj.type) {
          identifiedType = bodyObj.type ? `stripe.${bodyObj.type}` : 'stripe.webhook';
        } else if (shopifyTopic) {
          identifiedType = `shopify.${shopifyTopic}`;
        } else if (bodyObj.event) {
          identifiedType = String(bodyObj.event);
        }
      } catch { /* ignore */ }

      eventTypeCounts[identifiedType] = (eventTypeCounts[identifiedType] || 0) + 1;

      // Group time into format: HH:mm
      const date = new Date(ev.receivedAt);
      const minutes = Math.floor(date.getMinutes() / 5) * 5;
      const bucketKey = `${date.getHours().toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
      timeBuckets[bucketKey] = (timeBuckets[bucketKey] || 0) + 1;
    }

    // 8. Replay & Chaos stats
    const replayWhere = endpointId ? { event: { endpointId } } : {};
    const replays = await prisma.replayLog.findMany({
      where: replayWhere,
      select: {
        latencyMs: true,
        success: true,
        chaosMode: true,
        responseStatus: true,
      },
    });

    const totalReplays = replays.length;
    const successfulReplays = replays.filter((r) => r.success).length;
    const latencies = replays.map((r) => r.latencyMs || 0).filter((l) => l > 0).sort((a, b) => a - b);

    const avgLatency =
      latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;
    const p50 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.5)] : 0;
    const p90 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.9)] : 0;
    const p99 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.99)] : 0;

    const chaosBreakdown: Record<string, number> = {};
    for (const r of replays) {
      const mode = r.chaosMode || 'normal';
      chaosBreakdown[mode] = (chaosBreakdown[mode] || 0) + 1;
    }

    // Prepare sorted timeline array (last 12 buckets)
    const timeline = Object.entries(timeBuckets)
      .map(([time, count]) => ({ time, count }))
      .slice(-12);

    return res.json({
      summary: {
        totalEvents,
        sampleCount: events.length,
        driftRatePercent: totalEvents > 0 ? Math.round((driftCount / events.length) * 100) : 0,
        verifiedRatePercent: totalEvents > 0 ? Math.round((verifiedCount / events.length) * 100) : 0,
        contractValidPercent:
          contractValidCount + contractViolatedCount > 0
            ? Math.round((contractValidCount / (contractValidCount + contractViolatedCount)) * 100)
            : 100,
      },
      hmac: {
        verified: verifiedCount,
        tampered: tamperedCount,
        unverified: unverifiedCount,
      },
      contract: {
        valid: contractValidCount,
        violated: contractViolatedCount,
        none: contractNoneCount,
      },
      drift: {
        totalDriftEvents: driftCount,
        totalAddedFields,
        totalRemovedFields,
        totalMutatedTypes,
      },
      topEventTypes: Object.entries(eventTypeCounts)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 6),
      timeline,
      replayChaos: {
        totalReplays,
        successfulReplays,
        successRatePercent: totalReplays > 0 ? Math.round((successfulReplays / totalReplays) * 100) : 100,
        latencies: {
          avg: avgLatency,
          p50,
          p90,
          p99,
          min: latencies[0] || 0,
          max: latencies[latencies.length - 1] || 0,
        },
        chaosBreakdown,
      },
    });
  } catch (err: any) {
    console.error('[Analytics] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});
