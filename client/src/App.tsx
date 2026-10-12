import { useState, useEffect, useCallback, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  Zap, Plus, Trash2, RefreshCw, Copy, CheckCheck, Shield,
  ShieldAlert, ShieldOff, AlertTriangle, Terminal,
  Code2, X, GitCompare, Activity, Globe, Clock, Wifi,
  WifiOff, Server, Layers, Eye, EyeOff, Play, Loader2,
  Search, Download, Send, Sparkles, Edit3
} from 'lucide-react';
import {
  endpointsApi, eventsApi, replayApi, ingestApi
} from './api';
import type {
  Endpoint, WebhookEvent, ReplayLog, SchemaMutation, Snippets
} from './api';

const WS_URL = import.meta.env.VITE_WS_URL || 'http://localhost:3001';
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// ─── Utility functions ───────────────────────────────────────────────────────
function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 5000) return 'just now';
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return new Date(dateStr).toLocaleTimeString();
}

function formatJson(obj: any): string {
  try {
    if (typeof obj === 'string') return JSON.stringify(JSON.parse(obj), null, 2);
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

function downloadJson(data: any, filename: string) {
  const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function computeHmacSha256Hex(secret: string, message: string): Promise<string> {
  try {
    const enc = new TextEncoder();
    const key = await window.crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const signature = await window.crypto.subtle.sign('HMAC', key, enc.encode(message));
    return Array.from(new Uint8Array(signature))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return 'sha256_mock_signature';
  }
}

function syntaxHighlight(json: string): string {
  return json
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"(\[REDACTED\])"/g, '<span class="json-redacted">"$1"</span>')
    .replace(/"([^"]+)":/g, '<span class="json-key">"$1"</span>:')
    .replace(/: "([^"]*)"/g, ': <span class="json-string">"$1"</span>')
    .replace(/: (\d+\.?\d*)/g, ': <span class="json-number">$1</span>')
    .replace(/: (true|false)/g, ': <span class="json-bool">$1</span>')
    .replace(/: null/g, ': <span class="json-null">null</span>');
}

// ─── Toast component ─────────────────────────────────────────────────────────
function Toast({ msg, onClose }: { msg: string; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3000);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div className="toast">
      <CheckCheck size={15} style={{ color: 'var(--accent-green)' }} />
      <span>{msg}</span>
    </div>
  );
}

// ─── HMAC Badge ──────────────────────────────────────────────────────────────
function HmacBadge({ status }: { status: string }) {
  if (status === 'VERIFIED') return (
    <span className="badge badge-verified"><Shield size={9} />VERIFIED</span>
  );
  if (status === 'TAMPERED') return (
    <span className="badge badge-tampered"><ShieldAlert size={9} />TAMPERED</span>
  );
  return <span className="badge badge-unverified"><ShieldOff size={9} />UNVERIFIED</span>;
}

// ─── Schema Mutation Badge & Panel ───────────────────────────────────────────
function MutationBadge({ mutation }: { mutation: SchemaMutation | null }) {
  if (!mutation) return null;
  const count = mutation.added.length + mutation.removed.length + mutation.typeMutated.length;
  return (
    <span className="badge badge-mutation" title="Schema drift detected">
      <AlertTriangle size={9} />SCHEMA DRIFT ({count})
    </span>
  );
}

function MutationPanel({ mutation }: { mutation: SchemaMutation }) {
  return (
    <div style={{
      background: 'rgba(234,179,8,0.06)', border: '1px solid rgba(234,179,8,0.25)',
      borderRadius: 8, padding: 12, marginTop: 12
    }}>
      <div style={{ color: 'var(--accent-yellow)', fontWeight: 600, fontSize: 12, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
        <AlertTriangle size={12} /> Schema Mutation Detected
      </div>
      {mutation.added.length > 0 && (
        <div style={{ marginBottom: 6 }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>ADDED FIELDS</span>
          {mutation.added.map(f => (
            <div key={f} className="diff-added" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, padding: '2px 6px', borderRadius: 4, marginTop: 2 }}>
              + {f}
            </div>
          ))}
        </div>
      )}
      {mutation.removed.length > 0 && (
        <div style={{ marginBottom: 6 }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>REMOVED FIELDS</span>
          {mutation.removed.map(f => (
            <div key={f} className="diff-removed" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, padding: '2px 6px', borderRadius: 4, marginTop: 2 }}>
              - {f}
            </div>
          ))}
        </div>
      )}
      {mutation.typeMutated.length > 0 && (
        <div>
          <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>TYPE MUTATIONS</span>
          {mutation.typeMutated.map(m => (
            <div key={m.field} style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--accent-orange)', marginTop: 2 }}>
              ~ {m.field}: {m.from} → {m.to}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Diff Modal ───────────────────────────────────────────────────────────────
function DiffModal({ events, onClose }: { events: WebhookEvent[]; onClose: () => void }) {
  const [left, setLeft] = useState(0);
  const [right, setRight] = useState(Math.min(1, events.length - 1));

  if (events.length < 2) return null;

  const leftBody = (() => { try { return JSON.parse(events[left].rawBody); } catch { return {}; } })();
  const rightBody = (() => { try { return JSON.parse(events[right].rawBody); } catch { return {}; } })();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal fade-in" onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 700 }}>
            <GitCompare size={16} style={{ color: 'var(--accent-purple)' }} /> Payload Diff Comparator
          </h3>
          <button className="btn btn-secondary" onClick={onClose} style={{ padding: '4px 8px' }}>
            <X size={14} />
          </button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          <div>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, display: 'block' }}>LEFT EVENT</label>
            <select
              className="dm-input"
              value={left}
              onChange={e => setLeft(+e.target.value)}
              style={{ background: 'var(--bg-secondary)' }}
            >
              {events.map((ev, i) => (
                <option key={ev.id} value={i}>{timeAgo(ev.receivedAt)} — {ev.traceId.slice(0, 8)}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, display: 'block' }}>RIGHT EVENT</label>
            <select
              className="dm-input"
              value={right}
              onChange={e => setRight(+e.target.value)}
              style={{ background: 'var(--bg-secondary)' }}
            >
              {events.map((ev, i) => (
                <option key={ev.id} value={i}>{timeAgo(ev.receivedAt)} — {ev.traceId.slice(0, 8)}</option>
              ))}
            </select>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
              Event #{left + 1} — {timeAgo(events[left].receivedAt)}
            </div>
            <pre className="code-block" style={{ maxHeight: 400 }}
              dangerouslySetInnerHTML={{ __html: syntaxHighlight(formatJson(leftBody)) }} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
              Event #{right + 1} — {timeAgo(events[right].receivedAt)}
            </div>
            <pre className="code-block" style={{ maxHeight: 400 }}
              dangerouslySetInnerHTML={{ __html: syntaxHighlight(formatJson(rightBody)) }} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Snippet Viewer ───────────────────────────────────────────────────────────
function SnippetViewer({ eventId, onCopy }: { eventId: string; onCopy: (msg: string) => void }) {
  const [snippets, setSnippets] = useState<Snippets | null>(null);
  const [activeTab, setActiveTab] = useState<'curl' | 'nodeFetch' | 'python'>('curl');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!eventId) return;
    setLoading(true);
    eventsApi.getSnippets(eventId)
      .then(r => setSnippets(r.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [eventId]);

  if (loading) return (
    <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>
      <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
    </div>
  );
  if (!snippets) return null;

  const tabs = [
    { id: 'curl' as const, label: 'cURL', icon: <Terminal size={11} /> },
    { id: 'nodeFetch' as const, label: 'Node.js', icon: <Code2 size={11} /> },
    { id: 'python' as const, label: 'Python', icon: <Code2 size={11} /> },
  ];

  const current = snippets[activeTab];

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div className="tab-bar" style={{ border: 'none', gap: 4 }}>
          {tabs.map(t => (
            <button key={t.id} className={`tab ${activeTab === t.id ? 'active' : ''}`}
              onClick={() => setActiveTab(t.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px', fontSize: 11, border: 'none', background: 'none', cursor: 'pointer' }}>
              {t.icon}{t.label}
            </button>
          ))}
        </div>
        <button className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: 11 }}
          onClick={() => { navigator.clipboard.writeText(current); onCopy(`${activeTab} snippet copied!`); }}>
          <Copy size={11} />Copy
        </button>
      </div>
      <pre className="code-block" style={{ fontSize: 11 }}>{current}</pre>
    </div>
  );
}

// ─── Inspector Panel ──────────────────────────────────────────────────────────
function InspectorPanel({
  event, onCopy, onDelete
}: {
  event: WebhookEvent | null;
  onCopy: (msg: string) => void;
  onDelete?: (id: string) => void;
}) {
  const [tab, setTab] = useState<'payload' | 'headers' | 'snippets'>('payload');
  const [showRedacted, setShowRedacted] = useState(true);

  useEffect(() => { if (event) setTab('payload'); }, [event?.id]);

  if (!event) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        height: '100%', color: 'var(--text-muted)', gap: 12
      }}>
        <Server size={40} style={{ opacity: 0.3 }} />
        <div style={{ fontSize: 14, fontWeight: 500 }}>Select an event to inspect</div>
        <div style={{ fontSize: 12 }}>Click any event from the feed on the left</div>
      </div>
    );
  }

  const parsedBody = (() => {
    try {
      return JSON.parse(showRedacted ? event.redactedBody : event.rawBody);
    } catch { return event.rawBody; }
  })();

  const parsedHeaders = (() => {
    try { return JSON.parse(event.headers); } catch { return {}; }
  })();

  const mutation: SchemaMutation | null = (() => {
    try { return event.schemaMutation ? JSON.parse(event.schemaMutation) : null; }
    catch { return null; }
  })();

  const tabs = [
    { id: 'payload' as const, label: 'Payload' },
    { id: 'headers' as const, label: 'Headers' },
    { id: 'snippets' as const, label: 'Code Gen' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Event meta bar */}
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-card)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          <span className={`badge badge-${event.method.toLowerCase() === 'post' ? 'post' : 'get'}`}>
            {event.method}
          </span>
          <HmacBadge status={event.hmacStatus} />
          <MutationBadge mutation={mutation} />
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            <button className="btn btn-secondary" style={{ padding: '3px 8px', fontSize: 11 }}
              title="Download JSON"
              onClick={() => {
                downloadJson(parsedBody, `devmesh-event-${event.traceId.slice(0, 8)}.json`);
                onCopy('Downloaded event JSON!');
              }}>
              <Download size={11} />Export
            </button>
            {onDelete && (
              <button className="btn btn-danger" style={{ padding: '3px 8px', fontSize: 11 }}
                title="Delete this event"
                onClick={() => onDelete(event.id)}>
                <Trash2 size={11} />
              </button>
            )}
            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 4 }}>
              <Clock size={10} style={{ display: 'inline', marginRight: 4 }} />
              {timeAgo(event.receivedAt)}
            </span>
          </div>
        </div>
        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--text-muted)' }}>
          Trace: <span style={{ color: 'var(--accent-blue)' }}>{event.traceId}</span>
        </div>
      </div>

      {/* Tab bar */}
      <div className="tab-bar" style={{ background: 'var(--bg-card)', paddingLeft: 8 }}>
        {tabs.map(t => (
          <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
            style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        {tab === 'payload' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>JSON PAYLOAD</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: 11 }}
                  onClick={() => setShowRedacted(v => !v)}>
                  {showRedacted ? <Eye size={11} /> : <EyeOff size={11} />}
                  {showRedacted ? 'Redacted' : 'Raw'}
                </button>
                <button className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: 11 }}
                  onClick={() => {
                    navigator.clipboard.writeText(formatJson(parsedBody));
                    onCopy('Payload copied!');
                  }}>
                  <Copy size={11} />Copy
                </button>
              </div>
            </div>
            <pre className="code-block" style={{ maxHeight: 280 }}
              dangerouslySetInnerHTML={{ __html: syntaxHighlight(formatJson(parsedBody)) }} />
            {mutation && <MutationPanel mutation={mutation} />}
          </>
        )}

        {tab === 'headers' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>REQUEST HEADERS</span>
              <button className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: 11 }}
                onClick={() => { navigator.clipboard.writeText(JSON.stringify(parsedHeaders, null, 2)); onCopy('Headers copied!'); }}>
                <Copy size={11} />Copy
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {Object.entries(parsedHeaders).map(([k, v]) => (
                <div key={k} style={{
                  display: 'grid', gridTemplateColumns: '180px 1fr', gap: 12,
                  padding: '6px 10px', borderRadius: 6, background: 'var(--bg-secondary)',
                  border: '1px solid var(--border)',
                }}>
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--accent-purple)', wordBreak: 'break-all' }}>{k}</span>
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--text-secondary)', wordBreak: 'break-all' }}>{String(v)}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {tab === 'snippets' && (
          <>
            <div style={{ marginBottom: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>INSTANT CODE GENERATION</span>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                Reproduce this exact event from your terminal or scripts
              </div>
            </div>
            <SnippetViewer eventId={event.id} onCopy={onCopy} />
          </>
        )}
      </div>
    </div>
  );
}

// ─── Replay & Chaos Panel ─────────────────────────────────────────────────────
function ReplayChaosPanel({
  event, onCopy
}: { event: WebhookEvent | null; onCopy: (msg: string) => void }) {
  const [targetUrl, setTargetUrl] = useState('https://webhook.site/test');
  const [delayMs, setDelayMs] = useState(0);
  const [chaosMode, setChaosMode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastResult, setLastResult] = useState<any>(null);
  const [replayLogs, setReplayLogs] = useState<ReplayLog[]>([]);
  const [logTab, setLogTab] = useState<'studio' | 'history'>('studio');
  const [isEditingPayload, setIsEditingPayload] = useState(false);
  const [customPayload, setCustomPayload] = useState('');

  const chaosOptions = [
    { id: 'timeout', label: 'Connection Timeout', desc: 'Simulates 5s timeout', color: 'var(--accent-orange)' },
    { id: 'error429', label: 'Rate Limit (429)', desc: 'Simulates too many requests', color: 'var(--accent-yellow)' },
    { id: 'error504', label: 'Gateway Timeout (504)', desc: 'Simulates upstream timeout', color: 'var(--accent-red)' },
  ];

  const loadLogs = useCallback(async (eventId: string) => {
    try {
      const r = await replayApi.getLogs(eventId);
      setReplayLogs(r.data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (event?.id) {
      loadLogs(event.id);
      setLastResult(null);
      setCustomPayload(formatJson(event.rawBody));
      setIsEditingPayload(false);
    }
  }, [event?.id, event?.rawBody]);

  const handleReplay = async () => {
    if (!event || !targetUrl) return;
    setLoading(true);
    setLastResult(null);
    try {
      const r = await replayApi.replay(event.id, {
        targetUrl,
        delayMs,
        chaosMode,
        customBody: isEditingPayload ? customPayload : undefined,
      });
      setLastResult(r.data);
      loadLogs(event.id);
    } catch (err: any) {
      setLastResult({ error: err.message });
    } finally {
      setLoading(false);
    }
  };

  if (!event) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        height: '100%', color: 'var(--text-muted)', gap: 12
      }}>
        <Activity size={40} style={{ opacity: 0.3 }} />
        <div style={{ fontSize: 14, fontWeight: 500 }}>Chaos Studio</div>
        <div style={{ fontSize: 12 }}>Select an event to replay</div>
      </div>
    );
  }

  const statusColor = (status: number | null) => {
    if (!status) return 'var(--text-muted)';
    if (status >= 200 && status < 300) return 'var(--accent-green)';
    if (status >= 400 && status < 500) return 'var(--accent-yellow)';
    return 'var(--accent-red)';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div className="panel-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700 }}>
          <Zap size={14} style={{ color: 'var(--accent-orange)' }} /> Replay & Chaos Studio
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className={`tab ${logTab === 'studio' ? 'active' : ''}`}
            onClick={() => setLogTab('studio')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px', fontSize: 11 }}>
            Studio
          </button>
          <button className={`tab ${logTab === 'history' ? 'active' : ''}`}
            onClick={() => setLogTab('history')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px', fontSize: 11 }}>
            History ({replayLogs.length})
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        {logTab === 'studio' && (
          <>
            {/* Target URL */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                <Globe size={10} />TARGET URL
              </label>
              <input className="dm-input" value={targetUrl}
                onChange={e => setTargetUrl(e.target.value)}
                placeholder="https://your-server.com/webhook" />
              <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                {[
                  'https://webhook.site/test',
                  'https://httpbin.org/post',
                  'http://localhost:3000/webhook'
                ].map(preset => (
                  <button key={preset} type="button"
                    className="filter-pill"
                    onClick={() => setTargetUrl(preset)}>
                    {preset.replace('https://', '').replace('http://', '')}
                  </button>
                ))}
              </div>
            </div>

            {/* Custom Payload Editor Toggle */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Edit3 size={10} />PAYLOAD FORWARDING
                </label>
                <button
                  type="button"
                  className="filter-pill"
                  style={{
                    color: isEditingPayload ? 'var(--accent-blue)' : 'var(--text-muted)',
                    borderColor: isEditingPayload ? 'var(--accent-blue)' : undefined
                  }}
                  onClick={() => setIsEditingPayload(v => !v)}>
                  {isEditingPayload ? 'Custom Body Active' : 'Edit Before Replay'}
                </button>
              </div>
              {isEditingPayload ? (
                <textarea
                  className="dm-input font-mono"
                  rows={6}
                  style={{ fontSize: 11, resize: 'vertical' }}
                  value={customPayload}
                  onChange={e => setCustomPayload(e.target.value)}
                  placeholder="Modify JSON payload before replay..."
                />
              ) : (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-secondary)', padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)' }}>
                  Forwarding exact original payload (click Edit to tweak)
                </div>
              )}
            </div>

            {/* Latency Slider */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span><Clock size={10} style={{ display: 'inline', marginRight: 4 }} />ARTIFICIAL DELAY</span>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', color: delayMs > 2000 ? 'var(--accent-orange)' : 'var(--accent-blue)', fontWeight: 600 }}>
                  {delayMs}ms
                </span>
              </label>
              <input type="range" min={0} max={5000} step={100}
                value={delayMs} onChange={e => setDelayMs(+e.target.value)}
                className="dm-slider" />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                <span>0ms</span><span>2500ms</span><span>5000ms</span>
              </div>
            </div>

            {/* Chaos Modes */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, display: 'block' }}>
                ⚡ CHAOS FAILURE MODE
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div className={`chaos-option ${chaosMode === null ? 'active' : ''}`}
                  style={{ borderColor: chaosMode === null ? 'var(--accent-green)' : undefined }}
                  onClick={() => setChaosMode(null)}>
                  <span style={{ fontSize: 12, color: chaosMode === null ? 'var(--accent-green)' : 'var(--text-secondary)' }}>
                    Normal (No Chaos)
                  </span>
                  {chaosMode === null && <CheckCheck size={13} style={{ color: 'var(--accent-green)' }} />}
                </div>
                {chaosOptions.map(opt => (
                  <div key={opt.id} className={`chaos-option ${chaosMode === opt.id ? 'active' : ''}`}
                    onClick={() => setChaosMode(chaosMode === opt.id ? null : opt.id)}>
                    <div>
                      <div style={{ fontSize: 12, color: chaosMode === opt.id ? opt.color : 'var(--text-secondary)', fontWeight: 500 }}>
                        {opt.label}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{opt.desc}</div>
                    </div>
                    {chaosMode === opt.id && <CheckCheck size={13} style={{ color: opt.color }} />}
                  </div>
                ))}
              </div>
            </div>

            {/* Execute button */}
            <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '10px' }}
              onClick={handleReplay} disabled={loading || !targetUrl}>
              {loading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Play size={14} />}
              {loading ? 'Replaying...' : 'Execute Replay'}
            </button>

            {/* Result display */}
            {lastResult && (
              <div style={{
                marginTop: 16, padding: 12,
                background: 'var(--bg-secondary)', border: '1px solid var(--border)',
                borderRadius: 8
              }} className="fade-in">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>EXECUTION RESULT</div>
                  {lastResult.responseBodyPreview && (
                    <button className="btn btn-secondary" style={{ padding: '2px 6px', fontSize: 10 }}
                      onClick={() => {
                        navigator.clipboard.writeText(lastResult.responseBodyPreview);
                        onCopy('Response copied!');
                      }}>
                      <Copy size={10} />Copy
                    </button>
                  )}
                </div>

                {lastResult.error ? (
                  <div style={{ color: 'var(--accent-red)', fontSize: 12 }}>Error: {lastResult.error}</div>
                ) : (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                      <div style={{ background: 'var(--bg-card)', borderRadius: 6, padding: 8 }}>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>HTTP STATUS</div>
                        <div style={{ fontWeight: 700, fontSize: 18, fontFamily: 'JetBrains Mono, monospace', color: statusColor(lastResult.responseStatus) }}>
                          {lastResult.responseStatus || '—'}
                        </div>
                      </div>
                      <div style={{ background: 'var(--bg-card)', borderRadius: 6, padding: 8 }}>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>ROUNDTRIP</div>
                        <div style={{ fontWeight: 700, fontSize: 18, fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent-blue)' }}>
                          {lastResult.latencyMs ?? '—'}ms
                        </div>
                      </div>
                    </div>
                    {lastResult.chaosTriggered && (
                      <div style={{ padding: '6px 10px', background: 'rgba(249,115,22,0.1)', borderRadius: 6, fontSize: 11, color: 'var(--accent-orange)', marginBottom: 8 }}>
                        ⚡ Chaos mode triggered: {lastResult.chaosMode}
                      </div>
                    )}
                    {lastResult.responseBodyPreview && (
                      <pre className="code-block" style={{ fontSize: 10, maxHeight: 120 }}>
                        {lastResult.responseBodyPreview}
                      </pre>
                    )}
                    {lastResult.latencyMs && (
                      <div style={{ marginTop: 8 }}>
                        <div className="latency-bar"
                          style={{ width: `${Math.min((lastResult.latencyMs / 5000) * 100, 100)}%` }} />
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                          Latency: {lastResult.latencyMs}ms / 5000ms max
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </>
        )}

        {logTab === 'history' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {replayLogs.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40, fontSize: 13 }}>
                No replays yet for this event
              </div>
            ) : replayLogs.map(log => (
              <div key={log.id} style={{
                padding: 12, background: 'var(--bg-secondary)',
                border: `1px solid ${log.success ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
                borderRadius: 8
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: statusColor(log.responseStatus) }}>
                    {log.responseStatus || 'ERR'}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{timeAgo(log.replayedAt)}</span>
                </div>
                <div style={{ display: 'flex', gap: 12, fontSize: 11 }}>
                  <span style={{ color: 'var(--text-muted)' }}>⏱ {log.latencyMs}ms</span>
                  <span style={{ color: 'var(--text-muted)' }}>💤 {log.delayMs}ms delay</span>
                  {log.chaosMode && <span style={{ color: 'var(--accent-orange)' }}>⚡ {log.chaosMode}</span>}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, wordBreak: 'break-all' }}>
                  → {log.targetUrl}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Event Feed Panel ─────────────────────────────────────────────────────────
function EventFeedPanel({
  endpoint, events, selectedEventId, onSelect, onRefresh,
  onOpenSimulate, onClearAll, onCopy
}: {
  endpoint: Endpoint;
  events: WebhookEvent[];
  selectedEventId: string | null;
  onSelect: (ev: WebhookEvent) => void;
  onRefresh: () => void;
  onOpenSimulate: () => void;
  onClearAll: () => void;
  onCopy: (msg: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'verified' | 'tampered' | 'unverified' | 'drift'>('all');

  const ingestUrl = `${API_BASE}/api/v1/ingest/${endpoint.id}`;

  const copyCurl = () => {
    const curl = `curl -X POST '${ingestUrl}' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"event":"ping","timestamp":"${new Date().toISOString()}"}'`;
    navigator.clipboard.writeText(curl);
    onCopy('Sample cURL command copied!');
  };

  const copyUrl = () => {
    navigator.clipboard.writeText(ingestUrl);
    onCopy('Ingest URL copied!');
  };

  const filteredEvents = events.filter(ev => {
    if (statusFilter === 'verified' && ev.hmacStatus !== 'VERIFIED') return false;
    if (statusFilter === 'tampered' && ev.hmacStatus !== 'TAMPERED') return false;
    if (statusFilter === 'unverified' && ev.hmacStatus !== 'UNVERIFIED') return false;
    if (statusFilter === 'drift' && !ev.schemaMutation) return false;

    if (search.trim()) {
      const q = search.toLowerCase();
      const matchTrace = ev.traceId.toLowerCase().includes(q);
      const matchMethod = ev.method.toLowerCase().includes(q);
      const matchBody = ev.rawBody.toLowerCase().includes(q);
      if (!matchTrace && !matchMethod && !matchBody) return false;
    }

    return true;
  });

  const verifiedCount = events.filter(e => e.hmacStatus === 'VERIFIED').length;
  const tamperedCount = events.filter(e => e.hmacStatus === 'TAMPERED').length;
  const driftCount = events.filter(e => e.schemaMutation).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Panel Header */}
      <div className="panel-header" style={{ padding: '10px 14px' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{endpoint.name}</div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, fontFamily: 'JetBrains Mono, monospace' }}>
            {filteredEvents.length} of {events.length} event{events.length !== 1 ? 's' : ''}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button className="btn btn-primary" style={{ padding: '3px 8px', fontSize: 11 }}
            title="Simulate a webhook event"
            onClick={onOpenSimulate}>
            <Sparkles size={11} />Simulate
          </button>
          {events.length > 0 && (
            <>
              <button className="btn btn-secondary" style={{ padding: '3px 6px', fontSize: 11 }}
                title="Export all events as JSON"
                onClick={() => {
                  downloadJson(events, `devmesh-${endpoint.slug}-events.json`);
                  onCopy('Exported events JSON!');
                }}>
                <Download size={11} />
              </button>
              <button className="btn btn-danger" style={{ padding: '3px 6px', fontSize: 11 }}
                title="Clear all events"
                onClick={onClearAll}>
                <Trash2 size={11} />
              </button>
            </>
          )}
          <button className="btn btn-secondary" style={{ padding: '3px 6px' }} onClick={onRefresh} title="Refresh events">
            <RefreshCw size={11} />
          </button>
        </div>
      </div>

      {/* Ingest URL bar */}
      <div style={{
        padding: '8px 12px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-secondary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8
      }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.05em' }}>INGEST WEBHOOK URL</div>
          <div style={{
            fontFamily: 'JetBrains Mono, monospace', fontSize: 10,
            color: 'var(--accent-cyan)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
          }}>
            POST .../api/v1/ingest/{endpoint.id.slice(0, 8)}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          <button className="btn btn-secondary" style={{ padding: '3px 6px', fontSize: 10 }}
            title="Copy full Ingest URL" onClick={copyUrl}>
            <Copy size={10} />URL
          </button>
          <button className="btn btn-secondary" style={{ padding: '3px 6px', fontSize: 10 }}
            title="Copy sample cURL command" onClick={copyCurl}>
            <Terminal size={10} />cURL
          </button>
        </div>
      </div>

      {/* Search and Filters */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', background: 'var(--bg-card)' }}>
        <div style={{ position: 'relative', marginBottom: 8 }}>
          <Search size={12} style={{ position: 'absolute', left: 8, top: 8, color: 'var(--text-muted)' }} />
          <input
            className="dm-input"
            style={{ paddingLeft: 26, fontSize: 11, height: 28 }}
            placeholder="Search trace, payload..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <button
            className={`filter-pill ${statusFilter === 'all' ? 'active' : ''}`}
            onClick={() => setStatusFilter('all')}>
            All ({events.length})
          </button>
          <button
            className={`filter-pill ${statusFilter === 'verified' ? 'active' : ''}`}
            onClick={() => setStatusFilter('verified')}>
            Verified ({verifiedCount})
          </button>
          <button
            className={`filter-pill ${statusFilter === 'tampered' ? 'active' : ''}`}
            onClick={() => setStatusFilter('tampered')}>
            Tampered ({tamperedCount})
          </button>
          <button
            className={`filter-pill ${statusFilter === 'drift' ? 'active' : ''}`}
            onClick={() => setStatusFilter('drift')}>
            Drift ({driftCount})
          </button>
        </div>
      </div>

      {/* Event list */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {filteredEvents.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
            <Activity size={24} style={{ margin: '0 auto 8px', display: 'block', opacity: 0.4 }} />
            {events.length === 0 ? 'Waiting for events...' : 'No matching events found'}
            <div style={{ fontSize: 11, marginTop: 8, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              {events.length === 0 ? (
                <button className="btn btn-secondary" style={{ marginTop: 6, fontSize: 11 }} onClick={onOpenSimulate}>
                  <Sparkles size={11} />Simulate First Webhook
                </button>
              ) : (
                'Try clearing your search or filter'
              )}
            </div>
          </div>
        ) : filteredEvents.map(ev => {
          const mutation: SchemaMutation | null = (() => {
            try { return ev.schemaMutation ? JSON.parse(ev.schemaMutation) : null; }
            catch { return null; }
          })();
          return (
            <div key={ev.id}
              className={`event-item slide-in ${selectedEventId === ev.id ? 'selected' : ''}`}
              onClick={() => onSelect(ev)}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className={`badge badge-${ev.method.toLowerCase() === 'post' ? 'post' : 'get'}`}>
                    {ev.method}
                  </span>
                  {mutation && (
                    <span title="Schema Drift detected" style={{ display: 'inline-flex' }}>
                      <AlertTriangle size={11} style={{ color: 'var(--accent-yellow)' }} />
                    </span>
                  )}
                </div>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{timeAgo(ev.receivedAt)}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <HmacBadge status={ev.hmacStatus} />
                <span style={{
                  fontFamily: 'JetBrains Mono, monospace', fontSize: 10,
                  color: 'var(--text-muted)', marginLeft: 'auto'
                }}>
                  {ev.traceId.slice(0, 8)}...
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Webhook Simulator Presets & Modal ─────────────────────────────────────────
const SIMULATOR_PRESETS = [
  {
    id: 'github_push',
    name: 'GitHub Push',
    desc: 'Commits, pusher, repository ref',
    badge: 'GitHub',
    headers: { 'X-GitHub-Event': 'push' },
    body: {
      event: 'push',
      ref: 'refs/heads/main',
      repository: { name: 'devmesh', full_name: 'acme/devmesh', private: false },
      pusher: { name: 'alex.dev', email: 'alex@devmesh.io' },
      commits: [
        {
          id: 'c8f2a1b',
          message: 'feat(core): real-time chaos simulation engine',
          timestamp: '2026-10-13T04:15:00Z',
        },
      ],
      amount: 100,
    },
  },
  {
    id: 'stripe_payment',
    name: 'Stripe Payment',
    desc: 'Includes secret card & API key to test redaction',
    badge: 'Stripe',
    headers: { 'Stripe-Signature': 't=1700000000,v1=simulated_hash' },
    body: {
      type: 'payment_intent.succeeded',
      id: 'evt_3N8xYk2eZvKYlo2C',
      data: {
        object: {
          id: 'pi_3N8xYk2eZvKYlo2C',
          amount: 4900,
          currency: 'usd',
          customer: 'cus_N7aB3k9',
          status: 'succeeded',
          card_number: '4242-4242-4242-4242',
          api_key: 'sk_live_51N8xYk2eZvKYlo2C_secret',
          password: 'super_secret_credentials',
        },
      },
    },
  },
  {
    id: 'schema_drift',
    name: 'Schema Drift Demo',
    desc: 'Introduces unexpected field & type mutation',
    badge: 'Schema Drift',
    headers: { 'X-GitHub-Event': 'payment.mutated' },
    body: {
      event: 'payment.completed',
      amount: '99.99_mutated_to_string',
      currency: 'USD',
      experimental_feature_drift: true,
      new_unannounced_payload_field: 'Detect me in DevMesh diff!',
      timestamp: '2026-10-13T04:20:00Z',
    },
  },
  {
    id: 'shopify_order',
    name: 'Shopify Order',
    desc: 'E-commerce order created event',
    badge: 'Shopify',
    headers: { 'X-Shopify-Topic': 'orders/create' },
    body: {
      id: 8209829119461,
      email: 'customer@example.com',
      total_price: '149.99',
      currency: 'USD',
      financial_status: 'paid',
      line_items: [
        { title: 'DevMesh Enterprise License', price: '149.99', quantity: 1 },
      ],
    },
  },
  {
    id: 'auth0_user',
    name: 'Auth0 Signup',
    desc: 'User created event with credentials to test redaction',
    badge: 'Auth0',
    headers: { 'X-Auth0-Event': 'user.signup' },
    body: {
      event: 'user.signup',
      user_id: 'auth0|64f1289128',
      email: 'developer@devmesh.org',
      password: 'TemporarySecretPassword123!',
      authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
      verified: true,
    },
  },
];

function SimulateWebhookModal({
  endpoint,
  onClose,
  onSuccess,
  onToast,
}: {
  endpoint: Endpoint;
  onClose: () => void;
  onSuccess: () => void;
  onToast: (msg: string) => void;
}) {
  const [selectedPreset, setSelectedPreset] = useState(SIMULATOR_PRESETS[0].id);
  const [payloadText, setPayloadText] = useState(formatJson(SIMULATOR_PRESETS[0].body));
  const [headersText, setHeadersText] = useState(formatJson(SIMULATOR_PRESETS[0].headers));
  const [sigMode, setSigMode] = useState<'unverified' | 'tampered' | 'verified'>('unverified');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSelectPreset = (pId: string) => {
    setSelectedPreset(pId);
    const preset = SIMULATOR_PRESETS.find(p => p.id === pId);
    if (preset) {
      setPayloadText(formatJson(preset.body));
      setHeadersText(formatJson(preset.headers));
    }
  };

  const handleSend = async () => {
    setLoading(true);
    setError('');
    try {
      let parsedBody: any;
      try {
        parsedBody = JSON.parse(payloadText);
      } catch {
        setError('Invalid JSON in payload');
        setLoading(false);
        return;
      }

      let parsedHeaders: Record<string, string> = {};
      try {
        parsedHeaders = JSON.parse(headersText);
      } catch {
        parsedHeaders = {};
      }

      if (sigMode === 'tampered') {
        parsedHeaders['X-Hub-Signature-256'] = 'sha256=invalid_tampered_signature_hex';
      } else if (sigMode === 'verified') {
        const secret = endpoint.hmacSecret || 'default_devmesh_secret';
        const hex = await computeHmacSha256Hex(secret, payloadText);
        parsedHeaders['X-Hub-Signature-256'] = `sha256=${hex}`;
      }

      await ingestApi.send(endpoint.id, parsedBody, parsedHeaders);
      onToast('⚡ Webhook simulated & ingested successfully!');
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal fade-in" style={{ maxWidth: 680 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 6,
              background: 'rgba(249,115,22,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <Sparkles size={15} style={{ color: 'var(--accent-orange)' }} />
            </div>
            <div>
              <h3 style={{ fontSize: 15, fontWeight: 700 }}>Simulate Webhook Event</h3>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Target: {endpoint.name} (POST /api/v1/ingest/{endpoint.id.slice(0, 8)}...)
              </div>
            </div>
          </div>
          <button className="btn btn-secondary" style={{ padding: '4px 8px' }} onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        {/* Presets Grid */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8, display: 'block' }}>
            CHOOSE EVENT TEMPLATE
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 8 }}>
            {SIMULATOR_PRESETS.map(p => (
              <div
                key={p.id}
                className={`template-card ${selectedPreset === p.id ? 'active' : ''}`}
                onClick={() => handleSelectPreset(p.id)}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{p.name}</span>
                  <span className="badge" style={{ fontSize: 9 }}>{p.badge}</span>
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.4 }}>{p.desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Signature Controls */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8, display: 'block' }}>
            HMAC SIGNATURE BEHAVIOR
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <div
              className={`chaos-option ${sigMode === 'unverified' ? 'active' : ''}`}
              onClick={() => setSigMode('unverified')}
            >
              <div>
                <div style={{ fontSize: 11, fontWeight: 600 }}>Unverified</div>
                <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>No signature</div>
              </div>
              {sigMode === 'unverified' && <CheckCheck size={12} style={{ color: 'var(--text-secondary)' }} />}
            </div>
            <div
              className={`chaos-option ${sigMode === 'verified' ? 'active' : ''}`}
              style={{ borderColor: sigMode === 'verified' ? 'var(--accent-green)' : undefined }}
              onClick={() => setSigMode('verified')}
            >
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: sigMode === 'verified' ? 'var(--accent-green)' : undefined }}>
                  Verified
                </div>
                <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>Valid HMAC</div>
              </div>
              {sigMode === 'verified' && <CheckCheck size={12} style={{ color: 'var(--accent-green)' }} />}
            </div>
            <div
              className={`chaos-option ${sigMode === 'tampered' ? 'active' : ''}`}
              style={{ borderColor: sigMode === 'tampered' ? 'var(--accent-red)' : undefined }}
              onClick={() => setSigMode('tampered')}
            >
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: sigMode === 'tampered' ? 'var(--accent-red)' : undefined }}>
                  Tampered
                </div>
                <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>Bad HMAC</div>
              </div>
              {sigMode === 'tampered' && <CheckCheck size={12} style={{ color: 'var(--accent-red)' }} />}
            </div>
          </div>
        </div>

        {/* Payload Editor */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6, display: 'block' }}>
            PAYLOAD JSON
          </label>
          <textarea
            className="dm-input font-mono"
            rows={7}
            style={{ fontSize: 11, resize: 'vertical' }}
            value={payloadText}
            onChange={e => setPayloadText(e.target.value)}
          />
        </div>

        {error && <div style={{ color: 'var(--accent-red)', fontSize: 12, marginBottom: 12 }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSend} disabled={loading}>
            {loading ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={13} />}
            {loading ? 'Dispatching...' : 'Dispatch Webhook'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Create Endpoint Modal ────────────────────────────────────────────────────
function CreateEndpointModal({ onClose, onCreate }: {
  onClose: () => void;
  onCreate: (endpoint: Endpoint) => void;
}) {
  const [name, setName] = useState('');
  const [hmacSecret, setHmacSecret] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async () => {
    if (!name.trim()) { setError('Name is required'); return; }
    setLoading(true);
    setError('');
    try {
      const r = await endpointsApi.create({ name: name.trim(), hmacSecret: hmacSecret || undefined });
      onCreate(r.data);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal fade-in" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700 }}>Create Webhook Endpoint</h3>
          <button className="btn btn-secondary" style={{ padding: '4px 8px' }} onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, display: 'block' }}>ENDPOINT NAME *</label>
            <input className="dm-input" value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. GitHub Webhooks, Stripe Events" autoFocus />
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, display: 'block' }}>
              HMAC SECRET (optional — for signature verification)
            </label>
            <input className="dm-input" value={hmacSecret} onChange={e => setHmacSecret(e.target.value)}
              placeholder="your-webhook-secret" type="text" />
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
              Used to verify X-Hub-Signature-256 (GitHub) or Stripe-Signature headers
            </div>
          </div>
          {error && <div style={{ color: 'var(--accent-red)', fontSize: 12 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
            <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={handleCreate} disabled={loading}>
              {loading ? <Loader2 size={13} /> : <Plus size={13} />}
              Create Endpoint
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [selectedEndpoint, setSelectedEndpoint] = useState<Endpoint | null>(null);
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<WebhookEvent | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showSimulateModal, setShowSimulateModal] = useState(false);
  const [showDiffModal, setShowDiffModal] = useState(false);
  const [connected, setConnected] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
  }, []);

  // Load endpoints
  const loadEndpoints = useCallback(async () => {
    try {
      const r = await endpointsApi.list();
      setEndpoints(r.data);
      if (r.data.length > 0 && !selectedEndpoint) {
        setSelectedEndpoint(r.data[0]);
      }
    } catch { /* server may not be up */ }
  }, [selectedEndpoint]);

  // Load events for selected endpoint
  const loadEvents = useCallback(async (endpointId: string) => {
    setLoadingEvents(true);
    try {
      const r = await eventsApi.listByEndpoint(endpointId);
      setEvents(r.data);
      if (r.data.length > 0) {
        try {
          const detail = await eventsApi.get(r.data[0].id);
          setSelectedEvent(detail.data);
        } catch {
          setSelectedEvent(r.data[0]);
        }
      } else {
        setSelectedEvent(null);
      }
    } catch {
      setEvents([]);
      setSelectedEvent(null);
    }
    finally { setLoadingEvents(false); }
  }, []);

  useEffect(() => { loadEndpoints(); }, []);

  useEffect(() => {
    if (selectedEndpoint) {
      loadEvents(selectedEndpoint.id);
    }
  }, [selectedEndpoint?.id]);

  // Socket.io for real-time updates
  useEffect(() => {
    const socket = io(WS_URL, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on('new_event', (data: WebhookEvent) => {
      if (selectedEndpoint && data.endpointId === selectedEndpoint.id) {
        setEvents(prev => [data, ...prev].slice(0, 100));
        setSelectedEvent(prev => prev ?? data);
        // Update endpoint event count
        setEndpoints(prev => prev.map(ep =>
          ep.id === data.endpointId
            ? { ...ep, _count: { events: (ep._count?.events || 0) + 1 } }
            : ep
        ));
      }
    });

    return () => { socket.disconnect(); };
  }, [selectedEndpoint?.id]);

  const handleEndpointSelect = async (endpoint: Endpoint) => {
    setSelectedEndpoint(endpoint);
    setSelectedEvent(null);
  };

  const handleEventSelect = async (ev: WebhookEvent) => {
    // Fetch full event details with replays
    try {
      const r = await eventsApi.get(ev.id);
      setSelectedEvent(r.data);
    } catch {
      setSelectedEvent(ev);
    }
  };

  const handleDeleteEndpoint = async (id: string) => {
    await endpointsApi.delete(id);
    setEndpoints(prev => prev.filter(ep => ep.id !== id));
    if (selectedEndpoint?.id === id) {
      const remaining = endpoints.filter(ep => ep.id !== id);
      setSelectedEndpoint(remaining[0] || null);
    }
    showToast('Endpoint deleted');
  };

  const handleClearAll = async () => {
    if (!selectedEndpoint) return;
    if (!window.confirm(`Clear all captured events for "${selectedEndpoint.name}"?`)) return;
    try {
      const r = await eventsApi.clearAll(selectedEndpoint.id);
      setEvents([]);
      setSelectedEvent(null);
      setEndpoints(prev => prev.map(ep =>
        ep.id === selectedEndpoint.id ? { ...ep, _count: { events: 0 } } : ep
      ));
      showToast(`Cleared ${r.data.deletedCount} event(s)`);
    } catch (err: any) {
      showToast(`Error clearing: ${err.message}`);
    }
  };

  const handleDeleteEvent = async (id: string) => {
    try {
      await eventsApi.delete(id);
      setEvents(prev => prev.filter(e => e.id !== id));
      if (selectedEvent?.id === id) {
        setSelectedEvent(null);
      }
      setEndpoints(prev => prev.map(ep =>
        ep.id === selectedEndpoint?.id
          ? { ...ep, _count: { events: Math.max(0, (ep._count?.events || 1) - 1) } }
          : ep
      ));
      showToast('Event deleted');
    } catch (err: any) {
      showToast(`Error deleting: ${err.message}`);
    }
  };

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* ── Top Navigation Bar ── */}
      <nav style={{
        height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 20px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg-card)', flexShrink: 0,
        boxShadow: '0 1px 0 var(--border)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: 'linear-gradient(135deg, #4f8ef7, #a855f7)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 16px rgba(79,142,247,0.4)'
            }}>
              <Layers size={16} style={{ color: 'white' }} />
            </div>
            <div>
              <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-0.5px' }}>DevMesh</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>
                Webhook Inspector & Chaos Platform
              </span>
            </div>
          </div>

          {/* Quick Metrics */}
          {selectedEndpoint && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 12 }}>
              <div className="stat-chip">
                Events: <strong>{events.length}</strong>
              </div>
              {events.some(e => e.schemaMutation) && (
                <div className="stat-chip" style={{ color: 'var(--accent-yellow)', borderColor: 'rgba(234,179,8,0.3)' }}>
                  <AlertTriangle size={11} /> Drift: <strong>{events.filter(e => e.schemaMutation).length}</strong>
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Connection status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
            <div className={connected ? 'pulse-dot' : ''} style={{
              width: 8, height: 8, borderRadius: '50%',
              background: connected ? 'var(--accent-green)' : 'var(--text-muted)'
            }} />
            {connected
              ? <span style={{ color: 'var(--accent-green)' }}><Wifi size={13} style={{ display: 'inline', marginRight: 4 }} />Live</span>
              : <span style={{ color: 'var(--text-muted)' }}><WifiOff size={13} style={{ display: 'inline', marginRight: 4 }} />Offline</span>
            }
          </div>

          {selectedEndpoint && (
            <button className="btn btn-primary" style={{ fontSize: 12, background: 'linear-gradient(135deg, #f97316, #ef4444)' }}
              onClick={() => setShowSimulateModal(true)}>
              <Sparkles size={13} />Simulate Webhook
            </button>
          )}

          {selectedEndpoint && events.length >= 2 && (
            <button className="btn btn-secondary" style={{ fontSize: 11 }}
              onClick={() => setShowDiffModal(true)}>
              <GitCompare size={12} />Diff
            </button>
          )}

          <button className="btn btn-primary" style={{ fontSize: 12 }}
            onClick={() => setShowCreateModal(true)}>
            <Plus size={13} />New Endpoint
          </button>
        </div>
      </nav>

      {/* ── Main Content ── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Sidebar: Endpoints list */}
        <div style={{
          width: 220, flexShrink: 0, borderRight: '1px solid var(--border)',
          background: 'var(--bg-secondary)', overflow: 'auto', display: 'flex', flexDirection: 'column'
        }}>
          <div style={{ padding: '12px 14px 8px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.1em' }}>
            ENDPOINTS
          </div>
          {endpoints.length === 0 ? (
            <div style={{ padding: '20px 14px', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              No endpoints yet. Create one to start capturing webhooks.
            </div>
          ) : endpoints.map(ep => (
            <div key={ep.id} style={{
              padding: '8px 14px',
              background: selectedEndpoint?.id === ep.id ? 'rgba(79,142,247,0.1)' : 'transparent',
              borderLeft: selectedEndpoint?.id === ep.id ? '3px solid var(--accent-blue)' : '3px solid transparent',
              cursor: 'pointer', transition: 'all 0.15s',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between'
            }}
              onClick={() => handleEndpointSelect(ep)}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 12, fontWeight: 500, color: 'var(--text-primary)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                }}>{ep.name}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                  {ep._count?.events || 0} events
                  {ep.hmacSecret && <span style={{ marginLeft: 6 }}><Shield size={8} style={{ display: 'inline' }} /></span>}
                </div>
              </div>
              <button
                onClick={e => { e.stopPropagation(); handleDeleteEndpoint(ep.id); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, borderRadius: 4, flexShrink: 0 }}
                title="Delete endpoint">
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>

        {/* Main 3-column layout */}
        {selectedEndpoint ? (
          <div className="devmesh-grid" style={{ flex: 1 }}>
            {/* LEFT: Event Feed */}
            <div style={{ borderRight: '1px solid var(--border)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              {loadingEvents ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: 'var(--text-muted)' }}>
                  <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} />
                </div>
              ) : (
                <EventFeedPanel
                  endpoint={selectedEndpoint}
                  events={events}
                  selectedEventId={selectedEvent?.id || null}
                  onSelect={handleEventSelect}
                  onRefresh={() => loadEvents(selectedEndpoint.id)}
                  onOpenSimulate={() => setShowSimulateModal(true)}
                  onClearAll={handleClearAll}
                  onCopy={showToast}
                />
              )}
            </div>

            {/* CENTER: Inspector */}
            <div style={{ borderRight: '1px solid var(--border)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <div className="panel-header">
                <div style={{ fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Eye size={14} style={{ color: 'var(--accent-blue)' }} />Event Inspector
                </div>
                {selectedEvent && (
                  <button className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: 11 }}
                    onClick={() => { navigator.clipboard.writeText(selectedEvent.traceId); showToast('Trace ID copied!'); }}>
                    <Copy size={11} />{selectedEvent.traceId.slice(0, 8)}
                  </button>
                )}
              </div>
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <InspectorPanel event={selectedEvent} onCopy={showToast} onDelete={handleDeleteEvent} />
              </div>
            </div>

            {/* RIGHT: Replay & Chaos */}
            <div style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <ReplayChaosPanel event={selectedEvent} onCopy={showToast} />
            </div>
          </div>
        ) : (
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexDirection: 'column', gap: 16, color: 'var(--text-muted)'
          }}>
            <div style={{
              width: 80, height: 80, borderRadius: 20,
              background: 'linear-gradient(135deg, rgba(79,142,247,0.2), rgba(168,85,247,0.2))',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <Layers size={36} style={{ color: 'var(--accent-blue)' }} />
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', textAlign: 'center' }}>
                Welcome to DevMesh
              </div>
              <div style={{ fontSize: 13, marginTop: 8, textAlign: 'center', lineHeight: 1.6 }}>
                Create your first endpoint to start capturing<br />and inspecting webhook events
              </div>
            </div>
            <button className="btn btn-primary" style={{ padding: '10px 20px', fontSize: 14 }}
              onClick={() => setShowCreateModal(true)}>
              <Plus size={15} />Create First Endpoint
            </button>
          </div>
        )}
      </div>

      {/* Modals */}
      {showCreateModal && (
        <CreateEndpointModal
          onClose={() => setShowCreateModal(false)}
          onCreate={(ep) => {
            setEndpoints(prev => [ep, ...prev]);
            setSelectedEndpoint(ep);
            setShowCreateModal(false);
            showToast(`Endpoint "${ep.name}" created!`);
          }}
        />
      )}

      {showSimulateModal && selectedEndpoint && (
        <SimulateWebhookModal
          endpoint={selectedEndpoint}
          onClose={() => setShowSimulateModal(false)}
          onSuccess={() => loadEvents(selectedEndpoint.id)}
          onToast={showToast}
        />
      )}

      {showDiffModal && selectedEndpoint && (
        <DiffModal events={events} onClose={() => setShowDiffModal(false)} />
      )}

      {toast && <Toast msg={toast} onClose={() => setToast(null)} />}
    </div>
  );
}
