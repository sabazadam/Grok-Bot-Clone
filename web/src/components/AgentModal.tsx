import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../api';
import type { Agent, AgentInput, ProviderInfo } from '../types';

interface Props {
  /** null → create a new agent; otherwise edit this one. */
  agent: Agent | null;
  onClose: () => void;
  onSaved: (agent: Agent, created: boolean) => void;
}

const PRESET_COLORS = [
  '#7c5cff',
  '#5b8def',
  '#2dd4bf',
  '#4ade80',
  '#facc15',
  '#fb923c',
  '#f472b6',
  '#f87171',
];

const DESCRIPTION_PLACEHOLDER =
  'e.g. You are Piper, our product performance analyst. Each morning open the ' +
  'metrics dashboard in the browser, note anything unusual, and message Scout ' +
  'if you need a data pull. Always ask me before sending anything external.';

export default function AgentModal({ agent, onClose, onSaved }: Props) {
  const editing = agent !== null;
  const [providers, setProviders] = useState<ProviderInfo[] | null>(null);
  const [name, setName] = useState(agent?.name ?? '');
  const [title, setTitle] = useState(agent?.title ?? '');
  const [description, setDescription] = useState(agent?.description ?? '');
  const [provider, setProvider] = useState(agent?.provider ?? '');
  const [model, setModel] = useState(agent?.model ?? '');
  const [color, setColor] = useState(
    agent?.color ?? PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getProviders()
      .then((list) => {
        if (cancelled) return;
        setProviders(list);
        if (!agent && list.length > 0) {
          const preferred = list.find((p) => p.hasKey || !p.needsKey) ?? list[0];
          setProvider((prev) => prev || preferred.id);
          setModel((prev) => prev || (preferred.models[0] ?? ''));
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setError(`Could not load providers: ${err.message}`);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const currentProvider = providers?.find((p) => p.id === provider) ?? null;

  const changeProvider = (nextId: string) => {
    const prev = providers?.find((p) => p.id === provider);
    const next = providers?.find((p) => p.id === nextId);
    setProvider(nextId);
    // Swap in a sensible model suggestion unless the user typed a custom one.
    if (!model || (prev && prev.models.includes(model))) {
      setModel(next?.models[0] ?? '');
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Give the agent a name.');
      return;
    }
    if (!provider) {
      setError('Pick a provider.');
      return;
    }
    if (!model.trim()) {
      setError('Pick or type a model.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (agent) {
        const patch: Partial<AgentInput> = {};
        if (name.trim() !== agent.name) patch.name = name.trim();
        if (title.trim() !== agent.title) patch.title = title.trim();
        if (description !== agent.description) patch.description = description;
        if (provider !== agent.provider) patch.provider = provider;
        if (model.trim() !== agent.model) patch.model = model.trim();
        if (color !== agent.color) patch.color = color;
        const updated =
          Object.keys(patch).length > 0 ? await api.updateAgent(agent.id, patch) : agent;
        onSaved(updated, false);
      } else {
        const created = await api.createAgent({
          name: name.trim(),
          title: title.trim(),
          description,
          provider,
          model: model.trim(),
          color,
        });
        onSaved(created, true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true">
        <header className="modal-header">
          <h3>{editing ? `Edit ${agent.name}` : 'New agent'}</h3>
          <button className="icon-btn" onClick={onClose} title="Close">
            ✕
          </button>
        </header>

        <form className="modal-body" onSubmit={submit}>
          <div className="field-row">
            <label className="field">
              <span>Name</span>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Piper"
                maxLength={40}
              />
            </label>
            <label className="field">
              <span>Title</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Product performance"
                maxLength={60}
              />
            </label>
          </div>

          <label className="field">
            <span>Role &amp; standing rules</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={DESCRIPTION_PLACEHOLDER}
              rows={5}
            />
          </label>

          <div className="field-row">
            <label className="field">
              <span>Provider</span>
              <select
                value={provider}
                onChange={(e) => changeProvider(e.target.value)}
                disabled={providers === null}
              >
                {providers === null && <option value="">Loading…</option>}
                {providers?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                    {p.needsKey && !p.hasKey ? ' — key missing' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Model</span>
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="model id"
                list="botbox-model-suggestions"
              />
              <datalist id="botbox-model-suggestions">
                {currentProvider?.models.map((m) => <option key={m} value={m} />)}
              </datalist>
            </label>
          </div>

          {currentProvider && currentProvider.needsKey && !currentProvider.hasKey && (
            <div className="field-hint warn">
              No API key configured for {currentProvider.label} — add one in Settings before
              this agent can run.
            </div>
          )}

          <div className="field">
            <span className="field-label">Color</span>
            <div className="swatches">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`swatch${c === color ? ' selected' : ''}`}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                  title={c}
                />
              ))}
            </div>
          </div>

          {error && <div className="form-error">{error}</div>}

          <footer className="modal-footer">
            <button type="button" className="btn subtle" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create agent'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
