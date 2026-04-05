import { useState } from 'react';
import { useApi, apiPost, apiDelete } from '../hooks/useApi';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OAuthClient {
  client_id: string;
  name: string;
  is_active: boolean;
  created_at: string;
}

interface NewClientResult extends OAuthClient {
  client_secret: string; // shown once only
}

// ---------------------------------------------------------------------------
// Copy-to-clipboard button
// ---------------------------------------------------------------------------

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback for older browsers
      const el = document.createElement('textarea');
      el.value = value;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <button
      onClick={() => { void handleCopy(); }}
      style={{
        padding: '4px 10px',
        background: copied ? '#198754' : '#343a40',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 4,
        color: copied ? '#fff' : '#adb5bd',
        fontSize: 11,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        transition: 'all 0.15s',
      }}
    >
      {copied ? '✓ Copied' : 'Copy'}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Credential row — label + monospace value + copy button
// ---------------------------------------------------------------------------

function CredentialRow({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const [revealed, setRevealed] = useState(!secret);

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '160px 1fr auto',
      alignItems: 'center',
      gap: 12,
      padding: '14px 0',
      borderBottom: '1px solid rgba(255,255,255,0.06)',
    }}>
      <span style={{ color: '#6c757d', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </span>
      <span style={{
        fontFamily: 'monospace',
        fontSize: 13,
        color: '#e9ecef',
        wordBreak: 'break-all',
        filter: secret && !revealed ? 'blur(5px)' : 'none',
        cursor: secret && !revealed ? 'pointer' : 'default',
        userSelect: secret && !revealed ? 'none' : 'text',
        transition: 'filter 0.2s',
      }}
        onClick={() => { if (secret && !revealed) setRevealed(true); }}
        title={secret && !revealed ? 'Click to reveal' : undefined}
      >
        {value}
      </span>
      <CopyButton value={value} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// New credentials reveal panel — shown immediately after generation
// ---------------------------------------------------------------------------

function NewCredentialsPanel({
  client,
  mcpUrl,
  onDismiss,
}: {
  client: NewClientResult;
  mcpUrl: string;
  onDismiss: () => void;
}) {
  return (
    <div style={{
      background: 'rgba(25, 135, 84, 0.1)',
      border: '1px solid rgba(25, 135, 84, 0.4)',
      borderRadius: 10,
      padding: 24,
      marginBottom: 28,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <span style={{ fontSize: 20 }}>🔑</span>
        <div>
          <div style={{ color: '#75b798', fontWeight: 700, fontSize: 15 }}>
            Connector credentials generated
          </div>
          <div style={{ color: '#6c757d', fontSize: 12, marginTop: 2 }}>
            Copy these into Claude → Customize → Connectors → Add connector
          </div>
        </div>
      </div>

      <div style={{
        background: 'rgba(255,193,7,0.1)',
        border: '1px solid rgba(255,193,7,0.3)',
        borderRadius: 6,
        padding: '8px 12px',
        color: '#ffc107',
        fontSize: 12,
        marginBottom: 16,
      }}>
        ⚠ The Client Secret is shown <strong>once only</strong> and cannot be retrieved again.
        Save it now before dismissing this panel.
      </div>

      <CredentialRow label="MCP Server URL" value={mcpUrl} />
      <CredentialRow label="Client ID" value={client.client_id} />
      <CredentialRow label="Client Secret" value={client.client_secret} secret />

      <button
        onClick={onDismiss}
        style={{
          marginTop: 18,
          padding: '8px 20px',
          background: '#343a40',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 6,
          color: '#adb5bd',
          fontSize: 13,
          cursor: 'pointer',
        }}
      >
        I've saved the credentials — dismiss
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function CoWorkCredentials() {
  const mcpUrl = `${window.location.origin}/mcp`;
  const { data: clients, loading, error, refetch } = useApi<OAuthClient[]>('/api/oauth-clients');

  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [newClient, setNewClient] = useState<NewClientResult | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  async function handleGenerate() {
    setGenerating(true);
    setGenError(null);
    try {
      const result = await apiPost<NewClientResult>('/api/oauth-clients', {
        name: 'Claude AI',
      });
      setNewClient(result);
      refetch();
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Failed to generate credentials');
    } finally {
      setGenerating(false);
    }
  }

  async function handleRevoke(clientId: string) {
    if (!confirm('Revoke this connector? Claude will lose access until you generate new credentials.')) return;
    setRevoking(clientId);
    try {
      await apiDelete(`/api/oauth-clients/${clientId}`);
      refetch();
    } finally {
      setRevoking(null);
    }
  }

  const activeClients = (clients ?? []).filter((c) => c.is_active);

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '32px 24px' }}>

      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h2 style={{ color: '#fff', fontSize: 22, fontWeight: 700, margin: 0 }}>
          Co-Work Credentials
        </h2>
        <p style={{ color: '#6c757d', fontSize: 14, marginTop: 6 }}>
          Connect Claude AI to your ledger via the MCP protocol.
          Use these credentials in <strong style={{ color: '#adb5bd' }}>Claude → Customize → Connectors → Add connector</strong>.
        </p>
      </div>

      {/* New credentials panel (shown immediately after generation) */}
      {newClient && (
        <NewCredentialsPanel
          client={newClient}
          mcpUrl={mcpUrl}
          onDismiss={() => setNewClient(null)}
        />
      )}

      {/* MCP URL — always visible */}
      <div style={{
        background: '#23272f',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 10,
        padding: 20,
        marginBottom: 24,
      }}>
        <div style={{ color: '#adb5bd', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 12 }}>
          MCP Server URL
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontFamily: 'monospace', fontSize: 14, color: '#7eb7ff', flex: 1 }}>
            {mcpUrl}
          </span>
          <CopyButton value={mcpUrl} />
        </div>
        <div style={{ color: '#495057', fontSize: 11, marginTop: 8 }}>
          Enter this as the "Remote MCP server URL" in Claude's connector dialog.
        </div>
      </div>

      {/* Active connectors */}
      <div style={{
        background: '#23272f',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 10,
        padding: 20,
        marginBottom: 24,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <div style={{ color: '#fff', fontSize: 15, fontWeight: 600 }}>Active Connectors</div>
            <div style={{ color: '#6c757d', fontSize: 12, marginTop: 2 }}>
              Each connector has its own Client ID and Secret.
            </div>
          </div>
          <button
            onClick={() => { void handleGenerate(); }}
            disabled={generating}
            style={{
              padding: '8px 16px',
              background: generating ? '#495057' : '#0d6efd',
              border: 'none',
              borderRadius: 6,
              color: '#fff',
              fontSize: 13,
              fontWeight: 600,
              cursor: generating ? 'not-allowed' : 'pointer',
            }}
          >
            {generating ? 'Generating…' : '+ Generate credentials'}
          </button>
        </div>

        {genError && (
          <div style={{ color: '#ff6b7a', fontSize: 13, marginBottom: 12 }}>
            Error: {genError}
          </div>
        )}

        {loading && (
          <div style={{ color: '#6c757d', fontSize: 13, padding: '12px 0' }}>Loading…</div>
        )}
        {error && (
          <div style={{ color: '#ff6b7a', fontSize: 13 }}>Error: {error}</div>
        )}

        {!loading && !error && activeClients.length === 0 && (
          <div style={{
            textAlign: 'center',
            padding: '24px 0',
            color: '#6c757d',
            fontSize: 13,
          }}>
            No active connectors. Click "Generate credentials" to create one.
          </div>
        )}

        {activeClients.map((client) => (
          <div
            key={client.client_id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '12px 0',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ color: '#e9ecef', fontSize: 13, fontWeight: 600 }}>
                {client.name}
              </div>
              <div style={{ fontFamily: 'monospace', color: '#6c757d', fontSize: 11, marginTop: 2 }}>
                {client.client_id}
              </div>
              <div style={{ color: '#495057', fontSize: 11, marginTop: 2 }}>
                Created {new Date(client.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
              </div>
            </div>
            <button
              onClick={() => { void handleRevoke(client.client_id); }}
              disabled={revoking === client.client_id}
              style={{
                padding: '6px 12px',
                background: 'transparent',
                border: '1px solid rgba(220,53,69,0.4)',
                borderRadius: 5,
                color: '#dc3545',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              {revoking === client.client_id ? 'Revoking…' : 'Revoke'}
            </button>
          </div>
        ))}
      </div>

      {/* How to connect guide */}
      <div style={{
        background: '#23272f',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 10,
        padding: 20,
      }}>
        <div style={{ color: '#fff', fontSize: 14, fontWeight: 600, marginBottom: 14 }}>
          How to connect Claude
        </div>
        {[
          ['1', 'Click "Generate credentials" above to create a Client ID and Secret.'],
          ['2', 'In Claude, go to Customize → Connectors → Add connector.'],
          ['3', 'Enter a name (e.g. "My Ledger"), paste the MCP Server URL, Client ID, and Client Secret.'],
          ['4', 'Click Connect — Claude will open a login page. Sign in with your Luca credentials.'],
          ['5', 'Once connected, you can ask Claude to query your ledger, post transactions, approve items, and more.'],
        ].map(([num, text]) => (
          <div key={num} style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
            <span style={{
              background: '#0d6efd',
              color: '#fff',
              borderRadius: '50%',
              width: 20,
              height: 20,
              minWidth: 20,
              fontSize: 11,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              {num}
            </span>
            <span style={{ color: '#adb5bd', fontSize: 13, lineHeight: 1.5 }}>{text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
