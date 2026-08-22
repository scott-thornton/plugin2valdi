// Parse a Capacitor plugin contract into the plugin2valdi IR.
//
// ARCHITECTURE: the TypeScript side is parsed with @babel/parser - the
// contract grammar is open-ended TypeScript (interfaces, extends, intersection
// aliases, enums, optional members, generics), and every shape-by-regex bug
// this project ever had lived in a hand-rolled parser. The NATIVE side is
// different by design: Swift/Kotlin have no JS-accessible AST, and the
// ritual-rewriting surface is closed - paren-walking is sound there.
//
// The IR produced here is identical to the pre-AST parser's, so emitters,
// transformers, and validators are unchanged. Types are stringified into the
// canonical textual forms downstream code expects ('string', 'Name[]',
// '{ a: string, b: number }', unions joined with ' | ').

import fs from 'fs';
import path from 'path';
import { parse } from '@babel/parser';
import { CODEGEN_TYPE_MAP } from './rn.mjs';

// ---- multi-file loading (discovery stays regex - only spec names matter) ----

function tryFiles(baseDir, spec) {
  const p = path.resolve(baseDir, spec);
  const candidates = [p, `${p}.ts`, `${p}.d.ts`, path.join(p, 'index.ts'), path.join(p, 'index.d.ts')];
  for (const c of candidates) {
    try { if (fs.statSync(c).isFile()) return c; } catch {}
  }
  return null;
}

function tryPackage(fromDir, spec, entryPath) {
  for (let dir = path.dirname(entryPath); dir !== path.parse(dir).root; dir = path.dirname(dir)) {
    const pkgRoot = path.join(dir, 'node_modules', spec);
    try {
      if (!fs.statSync(pkgRoot).isDirectory()) continue;
    } catch { continue; }
    const defs = [
      path.join(pkgRoot, 'dist', 'esm', 'definitions.d.ts'),
      path.join(pkgRoot, 'dist', 'definitions.d.ts'),
      path.join(pkgRoot, 'src', 'definitions.ts'),
      path.join(pkgRoot, 'index.d.ts'),
    ];
    for (const d of defs) {
      try { if (fs.statSync(d).isFile()) return d; } catch {}
    }
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'));
      if (pkg.types || pkg.typings) {
        const t = path.join(pkgRoot, pkg.types || pkg.typings);
        try { if (fs.statSync(t).isFile()) return t; } catch {}
      }
    } catch {}
    return null;
  }
  return null;
}

function loadSources(entryPath, flags) {
  // resolve to absolute: tryPackage walks parent directories until the root,
  // and a relative entry makes that walk loop forever on '.' (a relative
  // `plugin2valdi <dir>` invocation with an external package import hangs without this)
  entryPath = path.resolve(entryPath);
  const sources = [];
  const visited = new Set();
  const queue = [entryPath];
  let externalPackages = 0;
  while (queue.length) {
    const file = queue.shift();
    const key = path.resolve(file);
    if (visited.has(key) || visited.size > 40) continue;
    visited.add(key);
    let src;
    try { src = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'); } catch { continue; }
    sources.push({ path: file, src });
    const dir = path.dirname(file);
    const specs = new Set();
    const scan = /(?:export\s+\*\s*from|import\s+type\s*\{[^}]+\}\s*from|export\s+type\s*\{[^}]+\}\s*from)\s*['"]([^'"]+)['"]/g;
    for (const m of src.matchAll(scan)) specs.add(m[1]);
    for (const spec of specs) {
      if (spec.startsWith('.')) {
        const f = tryFiles(dir, spec);
        if (f) queue.push(f);
      } else {
        const f = tryPackage(dir, spec, entryPath);
        if (f) { queue.push(f); externalPackages++; }
      }
    }
  }
  if (sources.length > 1) {
    flags.add('multi-file-contract', 'resolved', `Contract spans ${sources.length} source file(s)${externalPackages ? ` (incl. ${externalPackages} external package type file(s))` : ''} - re-export chains followed, types inlined.`);
  }
  return sources;
}

// ---- AST helpers --------------------------------------------------------

function parseTs(src) {
  return parse(src, { sourceType: 'module', plugins: ['typescript'] });
}

// Stringify an AST type node into the canonical IR textual form.
// Unknown/exotic shapes return null - callers flag them as unsupported.
function typeToString(node, flags) {
  if (!node) return null;
  switch (node.type) {
    case 'TSStringKeyword': return 'string';
    case 'TSNumberKeyword': return 'number';
    case 'TSBooleanKeyword': return 'boolean';
    case 'TSUndefinedKeyword': return 'undefined';
    case 'TSNullKeyword': return 'null';
    case 'TSVoidKeyword': return 'void';
    case 'TSAnyKeyword': return 'any';
    case 'TSUnknownKeyword': return 'unknown';
    case 'TSLiteralType':
      return node.literal.type === 'StringLiteral' ? `'${node.literal.value}'` : String(node.literal.value);
    case 'TSArrayType':
      return `${typeToString(node.elementType, flags)}[]`;
    case 'TSTypeOperator':
      // `readonly string[]` / `keyof T` - the operator is a TS-only modifier;
      // the inner type is what the contract means
      return typeToString(node.typeAnnotation);
    case 'TSTupleType': {
      // no Valdi tuple exists; the honest collapse is the array of the
      // element union (element positions are lost - flagged so the review
      // manifest carries it)
      const parts = node.elementTypes.map((t) => typeToString(t)).filter(Boolean);
      if (!parts.length || parts.length !== node.elementTypes.length) return null;
      const uniq = [...new Set(parts)];
      const collapsed = uniq.length === 1 ? `${uniq[0]}[]` : `${uniq.join(' | ')}[]`;
      if (flags) flags.add('tuple-collapsed', 'warning', `A TS tuple type collapsed to ${collapsed} - Valdi has no tuple position. Element ORDER is lost; if the positions carry meaning (AsyncStorage's [key, value] pairs), restructure into a named { key, value } struct by hand.`);
      return collapsed;
    }
    case 'TSUnionType': {
      const parts = node.types.map((t) => typeToString(t)).filter(Boolean);
      return parts.length === node.types.length ? parts.join(' | ') : null;
    }
    case 'TSQualifiedName':
      return `${typeToString(node.left)}.${node.right.name}`;
    case 'TSTypeReference':
      return node.typeName.type === 'Identifier' ? node.typeName.name : typeToString(node.typeName);
    case 'TSTypeLiteral': {
      const fields = node.members
        .filter((m) => m.type === 'TSPropertySignature' && m.key?.type === 'Identifier')
        .map((m) => {
          const t = typeToString(m.typeAnnotation?.typeAnnotation);
          return t == null ? null : `${m.key.name}${m.optional ? '?' : ''}: ${t}`;
        });
      if (fields.some((f) => f == null)) return null;
      return `{ ${fields.join(', ')} }`;
    }
    default:
      return null;
  }
}

const entityName = (expr) => (expr?.type === 'Identifier' ? expr.name : null);

// ---- contract assembly ----------------------------------------------------

export function parseContract(defsPath, flags) {
  const model = { types: [], methods: [], events: [] };
  const sources = loadSources(defsPath, flags);

  const functionAliases = new Set();
  const aliasIntersections = new Map();
  const interfaces = new Map(); // name -> { members: [TSMethodSignature], extends: [names], path }
  const enums = new Map(); // enum name -> member values
  const haveType = (name) => model.types.some((t) => t.name === name);

  for (const { path: file, src } of sources) {
    let ast;
    try {
      ast = parseTs(src);
    } catch (err) {
      flags.add(`parse-error:${path.basename(file)}`, 'blocking', `Babel could not parse ${path.basename(file)}: ${err.message}`);
      continue;
    }
    for (const stmt of ast.program.body) {
      // unexported declarations still count (e.g. `type Defs = A & B;` before
      // an exported interface that extends it - the Stripe pattern)
      const TYPE_DECLS = new Set(['TSTypeAliasDeclaration', 'TSEnumDeclaration', 'TSInterfaceDeclaration']);
      const decl = stmt.type === 'ExportNamedDeclaration' && stmt.declaration
        ? stmt.declaration
        : (TYPE_DECLS.has(stmt.type) ? stmt : null);
      if (!decl) continue;

      if (decl.type === 'TSEnumDeclaration') {
        const values = (decl.body?.members || []).map((m) =>
          m.initializer?.type === 'StringLiteral' ? m.initializer.value : m.id.name);
        enums.set(decl.id.name, values);
        if (!haveType(decl.id.name)) model.types.push({ name: decl.id.name, kind: 'union', values, fromEnum: true });
        continue;
      }

      if (decl.type === 'TSTypeAliasDeclaration') {
        const right = decl.typeAnnotation;
        if (right.type === 'TSFunctionType') {
          functionAliases.add(decl.id.name);
          // record the payload for addListener event extraction
          // (@capacitor/app: `type StateChangeListener = (state: AppState) => void`)
          const p0 = right.params[0]?.typeAnnotation?.typeAnnotation;
          const ps = p0 ? (typeToString(p0) || null) : null;
          if (!haveType(decl.id.name)) model.types.push({ name: decl.id.name, kind: 'alias', alias: ps ? `(${ps}) => void` : '() => void', payloadType: ps || 'void' });
          continue;
        }
        if (right.type === 'TSIntersectionType') {
          const parents = right.types.map((t) => t.type === 'TSTypeReference' ? t.typeName.name : null).filter(Boolean);
          aliasIntersections.set(decl.id.name, parents);
          continue;
        }
        if (right.type === 'TSTypeLiteral') {
          const fields = [];
          let ok = true;
          for (const m of right.members) {
            if (m.type !== 'TSPropertySignature' || m.key?.type !== 'Identifier') continue;
            const t = typeToString(m.typeAnnotation?.typeAnnotation);
            if (t == null) { fields.push({ name: m.key.name, optional: !!m.optional, type: "?", unsupported: true }); continue; } // softly - flagged at emission if reachable
            fields.push({ name: m.key.name, optional: !!m.optional, type: t });
          }
          if (ok && fields.length && !haveType(decl.id.name)) model.types.push({ name: decl.id.name, kind: 'object', fields });
          continue;
        }
        if (right.type === 'TSUnionType') {
          // literal union OR union-of-enum-members
          const literals = right.types.filter((t) => t.type === 'TSLiteralType' && t.literal.type === 'StringLiteral');
          const qualified = right.types.filter((t) => t.type === 'TSTypeReference' && t.typeName.type === 'TSQualifiedName');
          if (literals.length === right.types.length) {
            if (!haveType(decl.id.name)) model.types.push({ name: decl.id.name, kind: 'union', values: literals.map((t) => t.literal.value) });
          } else if (qualified.length === right.types.length && qualified.length > 0) {
            const enumName = qualified[0].typeName.left.name;
            if (enums.has(enumName) && !haveType(decl.id.name)) {
              model.types.push({ name: decl.id.name, kind: 'union', values: enums.get(enumName), fromEnum: true });
            }
          }
          continue;
        }
        // alias to a single named type - record as-is for reference resolution
        const single = typeToString(right);
        if (single && /^[\w.]+$/.test(single) && !haveType(decl.id.name)) {
          model.types.push({ name: decl.id.name, kind: 'alias', alias: single });
        }
        continue;
      }

      if (decl.type === 'TSInterfaceDeclaration') {
        const parents = (decl.extends || [])
          .map((e) => {
            const name = entityName(e.expression);
            return name && aliasIntersections.has(name) ? aliasIntersections.get(name) : name;
          })
          .flat()
          .filter(Boolean);
        if (!interfaces.has(decl.id.name)) {
          interfaces.set(decl.id.name, { members: decl.body.body, extends: parents, path: file });
        }
      }
    }
  }

  // (function aliases are flagged below - but only where the closure pass
  // proves one is REACHABLE from the plugin surface; external packages load
  // dead aliases like RegisterPlugin that are not part of the contract)

  // flatten an interface's method signatures: own + inherited (cycle-safe).
  // Two syntaxes produce callable members: TSMethodSignature (method style,
  // Capacitor + clipboard-style RN specs) and TSPropertySignature with a
  // TSFunctionType annotation (function-property style, the common RN
  // TurboModule spelling: `getValues: (db: string) => Promise<string>`)
  const flatten = (name, seen = new Set()) => {
    if (seen.has(name)) return [];
    seen.add(name);
    const iface = interfaces.get(name);
    if (!iface) return [];
    const callable = iface.members.filter((m) =>
      m.type === 'TSMethodSignature'
      || (m.type === 'TSPropertySignature' && m.typeAnnotation?.typeAnnotation?.type === 'TSFunctionType'));
    const members = callable.map((m) => {
      if (m.type === 'TSMethodSignature') return m;
      // normalize a function property into the method-signature shape the
      // rest of the pipeline reads (key, params, returnType)
      const fn = m.typeAnnotation.typeAnnotation;
      return {
        type: 'TSMethodSignature',
        key: m.key,
        optional: m.optional,
        params: fn.params,
        returnType: fn.returnType,
      };
    });
    let out = members;
    for (const parent of iface.extends) {
      out = [...flatten(parent, seen), ...out];
    }
    return out;
  };

  // plugin contract = most Promise-returning methods over the FLATTENED set,
  // SCOPED to the entry file (loaded packages contribute types only - letting
  // them compete lets e.g. @capacitor/core's WebViewPlugin hijack contracts)
  const entryKey = path.resolve(defsPath);
  const entryIfaces = [...interfaces].filter(([, i]) => path.resolve(i.path) === entryKey);
  const searchSpace = entryIfaces.length ? entryIfaces : [...interfaces];
  let pluginIface = null;
  let bestScore = 0;
  for (const [name] of searchSpace) {
    const members = flatten(name);
    const score = members.filter((m) => m.returnType?.typeAnnotation?.type === 'TSTypeReference' && m.returnType.typeAnnotation.typeName?.name === 'Promise').length + (name.endsWith('Plugin') ? 1 : 0);
    if (score > bestScore) { bestScore = score; pluginIface = { name, members }; }
  }

  if (!pluginIface) {
    flags.add('no-interface', 'blocking', 'No exported plugin interface found in definitions file(s) - cannot derive the contract.');
    return model;
  }
  model.interfaceName = pluginIface.name;
  const inheritedFrom = interfaces.get(pluginIface.name)?.extends || [];
  // React Native TurboModule spec: `interface Spec extends TurboModule`
  model.rn = inheritedFrom.includes('TurboModule');

  for (const m of pluginIface.members) {
    const name = m.key?.name;
    if (!name) continue;
    const optional = !!m.optional;
    const params = m.params
      .filter((p) => p.type === 'Identifier')
      .map((p) => ({ name: p.name, type: typeToString(p.typeAnnotation?.typeAnnotation, flags) || '' }))
      .filter((p) => p.name && p.type);

    if (name === 'addListener') {
      const evParam = m.params.find((p) => p.type === 'Identifier' && (p.name === 'event' || p.name === 'eventName'));
      const listenerParam = m.params.find((p) => p.type === 'Identifier' && (p.name === 'listenerFunc' || p.name === 'listener'));
      const evNames = [];
      const evType = evParam?.typeAnnotation?.typeAnnotation;
      if (evType?.type === 'TSLiteralType' && evType.literal.type === 'StringLiteral') evNames.push(evType.literal.value);
      if (evType?.type === 'TSUnionType') {
        for (const t of evType.types) if (t.type === 'TSLiteralType' && t.literal.type === 'StringLiteral') evNames.push(t.literal.value);
      }
      const cbType = listenerParam?.typeAnnotation?.typeAnnotation;
      let payloadNode = cbType?.type === 'TSFunctionType' ? cbType.params[0]?.typeAnnotation?.typeAnnotation : null;
      // named listener aliases (@capacitor/app: `listenerFunc: StateChangeListener`
      // where `type StateChangeListener = (state: AppState) => void`) - resolve
      // through the alias table's function-type source string
      if (!payloadNode && cbType?.type === 'TSTypeReference' && cbType.typeName?.name) {
        const alias = model.types.find((t) => t.kind === 'alias' && t.name === cbType.typeName.name);
        if (alias?.payloadType) payloadNode = { resolved: alias.payloadType };
      }
      const payload = payloadNode ? (payloadNode.resolved || typeToString(payloadNode) || 'unknown') : 'unknown';
      for (const evName of evNames) model.events.push({ name: evName, payload });
      if (!evNames.length) flags.add(`unparsed-listener:${name}`, 'warning', `addListener variant with non-literal event names skipped - port these events by hand.`);
      continue;
    }
    if (['removeAllListeners', 'removeListener', 'checkPermissions', 'requestPermissions'].includes(name)) continue;
    // RN TurboModule: emitter boilerplate absorbed by the listener machinery;
    // codegen scalars (CodegenTypes) map onto plain TS scalars
    if (model.rn) {
      const noParams = !params.length;
      if (['addListener', 'removeListeners'].includes(name) || ((name === 'setListener' || name === 'removeListener') && noParams)) continue;
      for (const p of params) {
        if (CODEGEN_TYPE_MAP[p.type]) p.type = CODEGEN_TYPE_MAP[p.type];
      }
    }

    const retNode = m.returnType?.typeAnnotation;
    const isPromise = retNode?.type === 'TSTypeReference' && retNode.typeName?.name === 'Promise';
    const typeArg = isPromise && retNode.typeArguments?.params?.[0] ? typeToString(retNode.typeArguments.params[0], flags) : null;
    if (isPromise && typeArg == null) {
      flags.add(`unsupported-return:${name}`, 'blocking', `Method ${name}() returns a Promise of a type shape the stringifier does not support - restructure by hand.`);
      continue;
    }
    if (optional) {
      flags.add(`optional-method:${name}`, 'warning', `Method ${name}() is optional in the Capacitor contract; emitted as required - verify every platform impl provides it.`);
    }
    model.methods.push({
      name,
      params,
      returns: isPromise ? typeArg : (typeToString(retNode) || 'void'),
      isPromise,
    });
  }
  if (inheritedFrom.length) {
    flags.add('extends-flattened', 'resolved', `Plugin interface ${pluginIface.name} extends [${inheritedFrom.join(', ')}] - methods flattened into the contract.`);
  }

  // interface-bodied types (option/result structs, incl. method-only hosts)
  for (const [name, iface] of interfaces) {
    if (name === pluginIface.name || haveType(name)) continue;
    const fields = [];
    let hasField = false;
    let ok = true;
    for (const member of iface.members) {
      if (member.type !== 'TSPropertySignature' || member.key?.type !== 'Identifier') continue;
      hasField = true;
      const t = typeToString(member.typeAnnotation?.typeAnnotation);
      if (t == null) { fields.push({ name: member.key.name, optional: !!member.optional, type: "?", unsupported: true }); continue; } // softly - flagged at emission if reachable
      fields.push({ name: member.key.name, optional: !!member.optional, type: t });
    }
    if (ok && hasField) model.types.push({ name, kind: 'object', fields });
  }

  // ---- annotation closure -------------------------------------------------
  // Valdi codegen requires every type referenced by the emitted .d.ts to be
  // defined + annotated in that same file; a dangling reference makes the
  // upstream compiler emit EMPTY outputs silently (drafted upstream issue).
  // Close the contract here, at the source of truth:
  //   1. only types REACHABLE from the plugin surface (method params/returns,
  //      listener event payloads, transitively through named type fields and
  //      alias targets) are kept - dead declarations are dropped silently;
  //   2. a reachable reference to an ambient DOM/platform global (which can
  //      never exist in a native contract) collapses to a primitive with a
  //      type-collapsed warning naming the original - never left dangling;
  //   3. anything else still unresolved is a real contract type we refuse to
  //      guess - the blocking unresolved-types flag fires for hand work.

  // ambient browser/lib.d.ts globals - well-known names that no Capacitor
  // contract ever defines itself (observed dangling from @capacitor/keyboard
  // via @capacitor/core: RequestInit, PropertyDescriptor, WebView, Console)
  const AMBIENT_DOM_TYPES = new Set([
    'RequestInit', 'PropertyDescriptor', 'Console', 'WebView', 'Window', 'Document', 'ServiceWorkerRegistration',
    'HTMLElement', 'HTMLInputElement', 'HTMLCanvasElement', 'HTMLVideoElement', 'HTMLImageElement',
    'Element', 'Node', 'NodeList', 'Event', 'CustomEvent', 'EventTarget', 'EventListener',
    'EventListenerObject', 'MessageEvent', 'ProgressEvent', 'ErrorEvent', 'KeyboardEvent',
    'TouchEvent', 'PointerEvent', 'WheelEvent', 'InputEvent', 'FocusEvent', 'ClipboardEvent',
    'FileReader', 'File', 'Blob', 'Headers', 'Request', 'Response', 'AbortController', 'AbortSignal',
    'URL', 'URLSearchParams', 'FormData', 'DOMRect', 'Navigator', 'Storage', 'Screen', 'History',
    'Location', 'ResizeObserver', 'IntersectionObserver', 'MutationObserver', 'PerformanceObserver',
    'WebGLRenderingContext', 'CanvasRenderingContext2D', 'ImageData', 'MediaStream', 'AudioContext',
    'Geolocation', 'PositionOptions', 'WebSocket', 'Worker', 'SharedWorker', 'XMLHttpRequest',
    'Crypto', 'SubtleCrypto', 'BufferSource', 'Credential', 'CredentialsContainer',
  ]);

  const typeRefs = (raw) => [...new Set(
    String(raw || '').replace(/[|[]?;()]/g, ' ').split(/[\s,<>&{}:]+/).filter((w) => /^[A-Z]/.test(w))
  )];

  // 1) reachability from the plugin surface
  const typeByName = new Map(model.types.map((t) => [t.name, t]));
  const reachable = new Set();
  const visitRef = (name) => {
    if (reachable.has(name)) return;
    const t = typeByName.get(name);
    if (!t) return; // not defined in the loaded sources - resolver pass decides
    reachable.add(name);
    if (t.kind === 'alias' && t.alias) typeRefs(t.alias).forEach(visitRef);
    for (const f of t.fields || []) typeRefs(f.type).forEach(visitRef);
  };
  model.methods.forEach((m) => {
    m.params.forEach((p) => typeRefs(p.type).forEach(visitRef));
    typeRefs(m.returns).forEach(visitRef);
  });
  model.events.forEach((e) => typeRefs(e.payload).forEach(visitRef));

  // dead declarations (multi-file pulls, unused exports) are not part of the
  // contract - dropped silently, exactly like a never-referenced local
  model.types = model.types.filter((t) => reachable.has(t.name));

  // 2) + 3) resolve every reference sitting on a reachable position
  // (function-type aliases are NOT value types - keeping them out of
  // `defined` preserves the callback-aliases flag for their use sites)
  const defined = new Set([...model.types.filter((t) => !(t.kind === 'alias' && t.payloadType)).map((t) => t.name), 'string', 'number', 'boolean', 'void', 'any', 'unknown', 'null', 'undefined', 'object', 'Object']);
  const usedAliases = new Set();
  const collapsed = [];
  const unresolved = [];
  const closeRefs = (raw, where) => {
    let out = String(raw || '');
    for (const ref of typeRefs(out)) {
      // qualified refs (Enum.Member) resolve through their base name
      const base = ref.split('.')[0];
      if (defined.has(ref) || defined.has(base)) continue;
      if (functionAliases.has(ref)) { usedAliases.add(ref); continue; }
      // TS utility generics: Record<K, V> is a dictionary - codegen has no
      // map type; collapse to any (NSDictionary / skipped in bridges)
      if (/^Record$/.test(ref)) {
        // generic form first, then bare Record (typeToString drops generics)
        const rewritten = out.replace(/\bRecord\s*<[^>]*>/g, 'any').replace(/\bRecord\b/g, 'any');
        if (rewritten !== out) {
          out = rewritten;
          collapsed.push({ ref: 'Record<...>', where });
          continue;
        }
      }
      if (AMBIENT_DOM_TYPES.has(ref)) {
        // (?! ?:) keeps property KEY positions (`RequestInit:`) intact
        const rewritten = out.replace(new RegExp(`\\b${ref}\\b(?!\\s*[?:])`, 'g'), 'string');
        if (rewritten !== out) {
          out = rewritten;
          collapsed.push({ ref, where });
          continue;
        }
      }
      unresolved.push(base);
    }
    return out;
  };
  model.methods.forEach((m) => {
    m.params.forEach((p) => { p.type = closeRefs(p.type, `${m.name}(${p.name})`); });
    m.returns = closeRefs(m.returns, m.name);
  });
  model.events.forEach((e) => { e.payload = closeRefs(e.payload, `event:${e.name}`); });
  model.types.forEach((t) => {
    if (t.kind === 'alias' && t.alias) t.alias = closeRefs(t.alias, t.name);
    for (const f of t.fields || []) f.type = closeRefs(f.type, `${t.name}.${f.name}`);
  });

  if (usedAliases.size) {
    flags.add('callback-aliases', 'blocking', `Function-typed aliases (${[...usedAliases].join(', ')}) used as callback params. Capacitor watch/callback methods must convert to the verified pattern: @ExportProxy listener + setListener, with start/stop returning a CallbackID.`);
  }
  const seenCollapsed = new Set();
  for (const { ref, where } of collapsed) {
    const key = `${where}:${ref}`;
    if (seenCollapsed.has(key)) continue;
    seenCollapsed.add(key);
    flags.add(`type-collapsed:${where}`, 'warning', `Type "${ref}" (${where}) is an ambient DOM/platform type with no native counterpart - collapsed to string; review if this position needs real structure.`);
  }
  const uniqUnresolved = [...new Set(unresolved)];
  if (uniqUnresolved.length) {
    flags.add('unresolved-types', 'blocking', `Type(s) referenced by the plugin surface but not defined in the loaded contract sources: ${uniqUnresolved.join(', ')}. Valdi codegen enforces annotation closure - inline these or define + @ExportModel them locally.`);
  }
  return model;
}

export function findDefinitionsFile(pluginDir) {
  const candidates = ['src/definitions.ts', 'dist/esm/definitions.d.ts', 'definitions.ts'];
  for (const c of candidates) {
    const p = path.join(pluginDir, c);
    if (fs.existsSync(p)) return p;
  }
  const fallback = ['definitions.ts', 'index.ts'].map((f) => path.join(pluginDir, 'src', f)).find((p) => fs.existsSync(p));
  return fallback || null;
}
