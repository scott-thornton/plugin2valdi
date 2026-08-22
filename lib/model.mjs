// Shared IR + flag collection for plugin2valdi.
// The model is deliberately small: methods, value types, events, flags.
// Everything the emitters need, nothing they don't.

export class Flags {
  constructor() {
    this.items = [];
  }

  add(id, severity, message) {
    this.items.push({ id, severity, message });
    return this;
  }

  has(id) {
    return this.items.some((f) => f.id === id);
  }

  get blocking() {
    return this.items.filter((f) => f.severity === 'blocking');
  }

  get warnings() {
    return this.items.filter((f) => f.severity === 'warning');
  }

  get resolved() {
    return this.items.filter((f) => f.severity === 'resolved');
  }

  render() {
    const line = (f) => `- [${f.severity}] ${f.id}: ${f.message}`;
    const sections = ['# plugin2valdi review manifest', '', '## Blocking (must resolve by hand)', ...this.blocking.map(line), '', '## Warnings (review, likely fine)', ...this.warnings.map(line)];
    // resolved notes document what the tool handled (and how it was verified)
    // - E2E evidence lives here, e.g. the per-method resolve re-wrap proven
    // on @capacitor/device + @capacitor/preferences simulator runs
    if (this.resolved.length) sections.push('', '## Resolved (handled by the translator)', ...this.resolved.map(line));
    sections.push('');
    return sections.join('\n');
  }
}

// Normalize a plugin name to a valdi module name:
// "@example-org/apns-token" | "ApnsToken" | "apns-token" -> "apns_token"
export function moduleName(pkgName, fallback) {
  const base = (pkgName || fallback || 'module')
    .split('/')
    .pop()
    .replace(/[^a-zA-Z0-9-]/g, '');
  const snake = base.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/-+/g, '_').toLowerCase();
  return snake;
}

// PascalCase for generated class/struct names: "registration_state" -> "RegistrationState"
export function pascal(s) {
  return String(s || '').split(/[^a-zA-Z0-9]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('');
}

// camelCase for generated function names: "registration_changed" -> "registrationChanged"
export function camel(s) {
  const p = pascal(s);
  return p ? p[0].toLowerCase() + p.slice(1) : '';
}
