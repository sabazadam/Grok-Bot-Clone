import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../api';
import type { ProviderInfo, SettingsPatch, SettingsView } from '../types';

interface Props {
  onClose: () => void;
}

export default function SettingsModal({ onClose }: Props) {
  const [providers, setProviders] = useState<ProviderInfo[] | null>(null);
  const [settings, setSettings] = useState<SettingsView | null>(null);
  // Only fields the user actually touched end up in the PUT body.
  const [keyEdits, setKeyEdits] = useState<Record<string, string>>({});
  const [keyRemovals, setKeyRemovals] = useState<Record<string, boolean>>({});
  const [urlEdits, setUrlEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.getProviders(), api.getSettings()])
      .then(([provs, setts]) => {
        if (cancelled) return;
        setProviders(provs);
        setSettings(setts);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(`Could not load settings: ${err.message}`);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const keyProviders = providers?.filter((p) => p.needsKey) ?? [];
  const urlProviders = providers?.filter((p) => p.needsBaseUrl) ?? [];

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const keys: Record<string, string> = {};
    for (const [id, value] of Object.entries(keyEdits)) {
      if (value.trim() !== '') keys[id] = value.trim();
    }
    for (const [id, remove] of Object.entries(keyRemovals)) {
      if (remove) keys[id] = ''; // empty string deletes the stored key
    }
    const baseUrls: Record<string, string> = {};
    for (const [id, value] of Object.entries(urlEdits)) {
      if (value.trim() !== (settings?.baseUrls[id] ?? '')) baseUrls[id] = value.trim();
    }

    const patch: SettingsPatch = {};
    if (Object.keys(keys).length > 0) patch.keys = keys;
    if (Object.keys(baseUrls).length > 0) patch.baseUrls = baseUrls;
    if (!patch.keys && !patch.baseUrls) {
      onClose();
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await api.putSettings(patch);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true">
        <header className="modal-header">
          <h3>Settings</h3>
          <button className="icon-btn" onClick={onClose} title="Close">
            ✕
          </button>
        </header>

        <form className="modal-body" onSubmit={save}>
          {providers === null && !error && <div className="thread-hint">Loading…</div>}

          {keyProviders.length > 0 && (
            <>
              <div className="settings-section">API keys</div>
              {keyProviders.map((p) => {
                const isSet = settings?.keys[p.id]?.set === true;
                const removing = keyRemovals[p.id] === true;
                return (
                  <label className="field" key={p.id}>
                    <span>
                      {p.label}
                      {isSet && !removing && <em className="key-state">configured</em>}
                      {removing && <em className="key-state removing">will be removed</em>}
                    </span>
                    <div className="key-input-row">
                      <input
                        type="password"
                        id={`apikey-${p.id}`}
                        name={`apikey-${p.id}`}
                        autoComplete="off"
                        disabled={removing}
                        value={keyEdits[p.id] ?? ''}
                        placeholder={isSet ? 'configured' : 'not set'}
                        onChange={(e) => {
                          setKeyEdits((prev) => ({ ...prev, [p.id]: e.target.value }));
                          setKeyRemovals((prev) => ({ ...prev, [p.id]: false }));
                        }}
                      />
                      {isSet && (
                        <button
                          type="button"
                          className="btn subtle small"
                          onClick={() => {
                            setKeyRemovals((prev) => ({ ...prev, [p.id]: !removing }));
                            if (!removing)
                              setKeyEdits((prev) => ({ ...prev, [p.id]: '' }));
                          }}
                        >
                          {removing ? 'Keep' : 'Remove'}
                        </button>
                      )}
                    </div>
                  </label>
                );
              })}
            </>
          )}

          {urlProviders.length > 0 && (
            <>
              <div className="settings-section">Base URLs</div>
              {urlProviders.map((p) => (
                <label className="field" key={p.id}>
                  <span>{p.label}</span>
                  <input
                    type="text"
                    id={`baseurl-${p.id}`}
                    name={`baseurl-${p.id}`}
                    value={urlEdits[p.id] ?? settings?.baseUrls[p.id] ?? ''}
                    placeholder="http://localhost:11434/v1"
                    onChange={(e) =>
                      setUrlEdits((prev) => ({ ...prev, [p.id]: e.target.value }))
                    }
                  />
                </label>
              ))}
            </>
          )}

          {error && <div className="form-error">{error}</div>}

          <footer className="modal-footer">
            <button type="button" className="btn subtle" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={saving || providers === null}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
