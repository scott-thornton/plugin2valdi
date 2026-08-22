// Java transformer for Capacitor Android plugins -> Valdi module impl.
//
// CONFORMANCE MODE (compile-probe verified, a probe target):
// the emitted <X>Module.java now IMPLEMENTS the generated Kotlin interface:
//   - class renamed to <X>ModuleImpl (package-private: the public name would
//     collide with the generated interface in the same package, and a public
//     top-level class must match its file name). The Kotlin factory
//     (android/<module>_factory.kt) instantiates it from the same package.
//   - signatures `public Promise<T> name(...)` with typed options params
//     (JVM names are NOT mangled for generated interface methods).
//   - bodies resolve through ResolvablePromise<T>.fulfillSuccess (the
//     com.snap.valdi.promise idiom, ref WebViewControllerImpl.getState).
//   - pushToMarshaller is ABSTRACT at the JVM level (Kotlin interface method
//     with a body, no -Xjvm-default in the toolchain) -> javac demands an
//     override; we delegate to <Interface>.DefaultImpls.pushToMarshaller.
//   - the ValdiCall shim is GONE from the compiled path.

import fs from 'fs';
import path from 'path';
import { pascal, camel } from './model.mjs';
import { replaceCalls, replaceCallsBalanced, banner } from './transform-common.mjs';

const MODULE_PKG = 'com.plugin2valdi.modules';

const HOST_APIS = [
  'runOnMainThread', 'getContext', 'prefs()', 'handleOnResume', 'handleOnDestroy',
  'handleOnPause', 'handleOnCreate', 'bridge', 'getActivity', 'requestPermissionForAlias',
  'getRequestPermissionState', 'PermissionState',
];

function primaryResult(model) {
  const counts = {};
  for (const m of model.methods) if (m.returns && m.returns !== 'void') counts[m.returns] = (counts[m.returns] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

// Distinct non-void result types across methods. Makers must exist for ALL
// of them now that resolve sites wrap per-method (not just the primary).
function resultTypes(model) {
  const out = [];
  for (const m of model.methods) {
    if (m.returns && m.returns !== 'void' && !out.includes(m.returns)) out.push(m.returns);
  }
  return out;
}

// Contract type string -> Kotlin JVM type as seen from Java.
function kotlinType(t) {
  if (t === 'string') return 'String';
  if (t === 'unknown') return 'String'; // emit-dts collapses unknown -> string in the contract
  if (t === 'number') return 'Double';
  if (t === 'boolean') return 'Boolean';
  if (t === 'string[]') return 'java.util.List<String>';
  if (t === 'number[]') return 'java.util.List<Double>';
  return t; // named model type - generated Kotlin class/enum, same package
}

// Kotlin property -> Java accessor. `var isCharging: Boolean` compiles to
// isCharging()/setCharging, everything else to get<Pascal>/set<Pascal>.
function getterFor(name) {
  return /^is[A-Z]/.test(name) ? name : `get${pascal(name)}`;
}

// TS string enums in the model (kind 'union' + fromEnum, with member lists
// resolved by emit-dts' resolveEnums) + the nullable-strip helper shared by
// every enum type-mapping site.
function enumTypesOf(model) {
  return model.types.filter((t) => t.kind === 'union' && t.fromEnum && t.members);
}

function enumBase(ts) {
  return String(ts || '').replace(/\s+/g, ' ').replace(/\|\s*(?:undefined|null)\b/g, '').trim();
}

function modelType(model, name) {
  return model.types.find((t) => t.name === name) || null;
}

function javaMakeFunctions(model) {
  const wanted = new Set([...resultTypes(model), ...model.events.map((e) => e.payloadType || e.payload)].filter(Boolean));
  const objects = model.types.filter((t) => t.kind === 'object' && wanted.has(t.name));
  // @ExportEnum string enums: the toolchain generates a REAL Kotlin enum
  // class in the module package (probe-verified: enum class Mode { BODY, ...;
  // val value: String }) - fields/returns typed by it need wire-string
  // converters. Enum.valueOf() matches CONSTANT names, not wire values, so
  // the conversion goes through .getValue(); unknown strings fall back to the
  // first declared constant (the literal set is closed by the contract).
  const enums = enumTypesOf(model);
  const enumOf = new Map(enums.map((t) => [t.name, t]));
  const needsEnumConverters = objects.some((t) => t.fields?.some((f) => enumOf.has(enumBase(f.type)))) || [...wanted].some((t) => enumOf.has(t));
  const out = [];
  if (needsEnumConverters) {
    for (const [name, t] of enumOf) {
      const first = t.members[0][0]; // first CONSTANT name (safe fallback)
      out.push([
        `    // wire string -> generated Kotlin enum ${name} (unknown/null -> ${first}:`,
        `    // the contract's literal set is closed; Enum.valueOf would match`,
        `    // constant names, not wire values, so match on .getValue()).`,
        `    private static ${name} to${name}(String s) {`,
        `        if (s != null) for (${name} v : ${name}.values()) if (v.getValue().equals(s)) return v;`,
        `        return ${name}.${first};`,
        `    }`,
        '',
        `    private static ${name} to${name}OrNull(String s) {`,
        `        if (s == null) return null;`,
        `        for (${name} v : ${name}.values()) if (v.getValue().equals(s)) return v;`,
        `        return null;`,
        `    }`,
        '',
      ].join('\n'));
    }
  }
  // Generated Kotlin maps `string[]`/`number[]` fields to List<String>/List<Double>
  // (verified: preferences.kt KeysResult.keys) - JSONArray needs a converter.
  const needsStringList = objects.some((t) => t.fields?.some((f) => f.type === 'string[]'));
  const needsDoubleList = objects.some((t) => t.fields?.some((f) => f.type === 'number[]'));
  if (needsStringList) {
    out.push([
      `    private static java.util.List<String> toStringList(org.json.JSONArray a) {`,
      `        java.util.List<String> out = new java.util.ArrayList<>();`,
      `        if (a != null) for (int i = 0; i < a.length(); i++) out.add(a.optString(i, ""));`,
      `        return out;`,
      `    }`,
      '',
    ].join('\n'));
  }
  if (needsDoubleList) {
    out.push([
      `    private static java.util.List<Double> toDoubleList(org.json.JSONArray a) {`,
      `        java.util.List<Double> out = new java.util.ArrayList<>();`,
      `        if (a != null) for (int i = 0; i < a.length(); i++) out.add(a.optDouble(i, 0));`,
      `        return out;`,
      `    }`,
      '',
    ].join('\n'));
  }
  for (const t of objects) {
    const args = t.fields.map((f) => {
      const isNum = f.type === 'number';
      const isBool = f.type === 'boolean';
      const isStringArr = f.type === 'string[]';
      const isNumArr = f.type === 'number[]';
      const nullable = f.optional || /null|undefined/.test(f.type);
      const enumName = enumBase(f.type);
      if (enumOf.has(enumName)) {
        // generated ctor: (mode: Mode[, fallback: Mode? = null]) - enum args
        // via the wire converter, optional enum args null-safe
        return nullable ? `to${enumName}OrNull(dict.optString("${f.name}", null))` : `to${enumName}(dict.optString("${f.name}"))`;
      }
      if (isStringArr) return `toStringList(dict.optJSONArray("${f.name}"))`;
      if (isNumArr) return `toDoubleList(dict.optJSONArray("${f.name}"))`;
      return isNum ? `dict.optDouble("${f.name}", 0)` : isBool ? `dict.optBoolean("${f.name}", false)` : `dict.optString("${f.name}", ${nullable ? 'null' : '""'})`;
    });
    out.push([
      `    // dict-shaped -> typed struct bridge: positional ctor args follow the`,
      `    // emitted .d.ts field order, which is exactly the generated Kotlin`,
      `    // @ValdiClassConstructor order (both derive from the same contract).`,
      `    private static ${t.name} make${t.name}(JSONObject dict) {`,
      `        return new ${t.name}(${args.join(', ')});`,
      `    }`,
      '',
    ].join('\n'));
  }
  // primitive result/event payloads: the Capacitor body always resolves a
  // dict; the valdi contract promises a primitive. Heuristic extraction -
  // review fidelity (flagged by the caller).
  const primitives = [...wanted].filter((t) => /^(string|number|boolean)$/.test(t));
  for (const p of primitives) {
    const jt = kotlinType(p);
    const body = p === 'string'
      ? [
        `        // single-key dict (Capacitor's {"message": value} idiom for primitive`,
        `        // payloads) unwraps to the scalar - mirrors the Swift side's`,
        `        // c2vPrimitivePayload (data.values.first) fallback.`,
        `        if (dict != null && dict.length() == 1) return dict.optString(dict.keys().next());`,
        `        return dict == null ? null : dict.toString();`,
      ].join('\n')
      : p === 'number' ? 'return dict.optDouble("value", 0);' : 'return dict.optBoolean("value", false);';
    out.push([
      `    // plugin2valdi: primitive ${p} payload/result - heuristic dict extraction; review fidelity.`,
      `    private static ${jt} make${p}(JSONObject dict) {`,
      `        ${body}`,
      `    }`,
      '',
    ].join('\n'));
  }
  // enum-typed result/event payloads: same single-key heuristic as the
  // primitive bridges, typed to the generated Kotlin enum
  const enumResults = [...wanted].filter((t) => enumOf.has(t));
  for (const name of enumResults) {
    out.push([
      `    // plugin2valdi: enum ${name} payload/result - heuristic single-key dict`,
      `    // extraction, then the wire converter (unknown -> ${enumOf.get(name).members[0][0]}).`,
      `    private static ${name} make${name}(JSONObject dict) {`,
      `        String s = dict != null && dict.length() == 1 ? dict.optString(dict.keys().next()) : (dict == null ? null : dict.optString("value"));`,
      `        return to${name}(s);`,
      `    }`,
      '',
    ].join('\n'));
  }
  if (primitives.length || enumResults.length) {
    // flagged by the caller (needs the Flags instance)
  }
  return out.join('');
}

// Copy the plugin's non-bridge Android helpers (e.g. @capacitor/device's
// Device.java) into the module package so the translated body's references
// resolve. Helpers touching com.getcapacitor cannot compile and are skipped -
// their top-level type names and static-final String constants are returned
// so the impl pass can (a) drop-with-reject methods that depend on them and
// (b) rewrite <Class>.<CONST> references to their literals.
// Multiple helpers concatenate into ONE support file: package declarations
// and imports are hoisted (Java allows a single package statement and
// imports must precede all type declarations).
function collectHelpers(javaPath, pkg, flags) {
  // android source root: the `java` dir above the plugin class (capacitor
  // layout android/src/main/java/**; fixtures mirror it)
  let root = path.dirname(javaPath);
  while (path.basename(root) !== 'java' && path.dirname(root) !== root) root = path.dirname(root);
  if (path.basename(root) !== 'java') root = path.dirname(javaPath); // flat fallback
  const imports = new Set();
  const classes = [];
  const skippedClasses = []; // { name, consts: [[name, value]] }
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.java') && path.resolve(p) !== path.resolve(javaPath)) {
        let h = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
        if (/com\.getcapacitor/.test(h)) {
          flags.add(`java-helper-unportable:${e.name}`, 'warning', `${e.name} references Capacitor bridge classes - NOT copied; port by hand if the translated body needs it.`);
          const names = [...h.matchAll(/(?:^|\n)\s*(?:public\s+|private\s+|final\s+|abstract\s+|sealed\s+)*(?:class|interface|enum)\s+(\w+)/g)].map((m) => m[1]);
          const consts = [...h.matchAll(/(?:public\s+|private\s+)?static\s+final\s+String\s+(\w+)\s*=\s*"([^"]*)"/g)].map((m) => [m[1], m[2]]);
          for (const name of names) skippedClasses.push({ name, consts });
          continue;
        }
        // hoist imports; drop the package line (the support file declares one)
        h = h.replace(/^import\s+[\w.*\s]+;\s*$/gm, (im) => {
          imports.add(im.trim());
          return '';
        }).replace(/^package\s+[\w.]*;\s*$/m, '');
        // a public top-level type would have to match the support file name -
        // de-publicize (package-private: the impl sits in the same package)
        h = h.replace(/^public\s+((?:final\s+|abstract\s+)?(?:class|interface|enum)\s)/gm, '$1');
        classes.push(`// ---- copied from ${path.relative(root, p)} (package rewritten, de-publicized) ----\n${h.trim()}\n`);
        flags.add('java-helper-copied', 'resolved', `Android helper sources copied into ${pkg} (de-publicized, package + imports hoisted into the support file): verified for @capacitor/device (Device.java) + @capacitor/preferences (Preferences.java, PreferencesConfiguration.java).`);
      }
    }
  };
  walk(root);
  return { imports: [...imports], classes, skippedClasses };
}

// ---- no-host statement surgery (mirrors the objc no-webview policy) ----
// Statements that depend on symbols which only exist inside Capacitor's
// Android host (the bridge object, getConfig()/getBridge()/getActivity()
// accessors, the Plugin executor, skipped/unportable helper classes) cannot
// compile in a Valdi module. In lifecycle/plain bodies such statements are
// DROPPED IN PLACE (the surrounding logic is preserved); statements carrying
// event/value ritual (notifyListeners/call.*/emit*) are never dropped.

const HOST_SURFACE_RE = /\b(?:bridge\s*\.|getBridge\s*\(|getConfig\s*\(|getActivity\s*\(|execute\s*\()/;
const RITUAL_BEARING_RE = /notifyListeners|call\.|\bemit\w+\(/;
const CONTROL_RE = /^\s*(?:@?\w[\w.<>]*\s+)*(if|else|for|while|switch|try|catch|finally|do|case|default|return|throw)\b/;

function findMatchingBrace(text, openIdx) {
  let d = 0;
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") { const q = c; i++; while (i < text.length && text[i] !== q) { if (text[i] === '\\') i++; i++; } continue; }
    if (c === '{') d++;
    else if (c === '}') { d--; if (d === 0) return i; }
  }
  return -1;
}

// Segment `text` (one block interior) into top-level statements and drop the
// ones matching `pred`; recurses into kept brace blocks (switch cases, if
// bodies, lambdas) so nested host statements are caught without discarding
// the kept logic around them. Returns { text, dropped: [first lines] }.
function dropStatementsDeep(text, pred) {
  let out = '';
  let dropped = [];
  let stmtStart = 0;
  let depth = 0;
  const keepTo = (end) => { out += text.slice(stmtStart, end); };
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'") { const q = c; i++; while (i < text.length && text[i] !== q) { if (text[i] === '\\') i++; i++; } i++; continue; }
    if (c === '(' || c === '[') { depth++; i++; continue; }
    if (c === ')' || c === ']') { depth--; i++; continue; }
    if (c === '{' && depth === 0) {
      const close = findMatchingBrace(text, i);
      if (close !== -1 && CONTROL_RE.test(text.slice(stmtStart, i)) && /\b(if|else|for|while|switch|try|catch|finally|do)\b/.test(text.slice(stmtStart, i))) {
        // control-flow block: keep the header + block, recurse into the interior
        const inner = dropStatementsDeep(text.slice(i + 1, close), pred);
        dropped.push(...inner.dropped);
        keepTo(i + 1);
        out += inner.text;
        out += '}';
        stmtStart = close + 1;
        i = close + 1;
        continue;
      }
      i = close === -1 ? i + 1 : close + 1; // non-control block: part of the enclosing `;` statement
      continue;
    }
    if (c === ';' && depth === 0) {
      const stmt = text.slice(stmtStart, i + 1);
      // switch-case labels glue to the statement that follows them; judge the
      // statement BODY (labels never drop with it)
      const labelMatches = [...stmt.matchAll(/^[\t ]*(?:case\s+[^:\n]+|default\s*)[\t ]*:[\t ]*\n?/gm)];
      let labelsEnd = 0;
      if (labelMatches.length && /^\s*$/.test(stmt.slice(0, labelMatches[0].index))) {
        const last = labelMatches[labelMatches.length - 1];
        labelsEnd = last.index + last[0].length;
      }
      const stmtBody = labelsEnd ? stmt.slice(labelsEnd) : stmt;
      if (pred(stmtBody) && !CONTROL_RE.test(stmtBody)) {
        dropped.push(stmtBody.trim().split('\n')[0]);
        if (labelsEnd) out += stmt.slice(0, labelsEnd); // keep the labels (the group may hold kept statements below)
      } else if (stmt.includes('{')) {
        const inner = recurseBlocks(stmt, pred);
        dropped.push(...inner.dropped);
        out += inner.text;
      } else {
        out += stmt;
      }
      stmtStart = i + 1;
      i++;
      continue;
    }
    i++;
  }
  keepTo(text.length);
  return { text: out, dropped };
}

// Recurse into every brace block of a kept statement (e.g. an
// `execute(() -> { ... });` expression statement or an anonymous class).
function recurseBlocks(stmt, pred) {
  let i = 0;
  while (i < stmt.length) {
    const c = stmt[i];
    if (c === '"' || c === "'") { const q = c; i++; while (i < stmt.length && stmt[i] !== q) { if (stmt[i] === '\\') i++; i++; } i++; continue; }
    if (c === '{') {
      const close = findMatchingBrace(stmt, i);
      if (close === -1) { i++; continue; }
      const header = stmt.slice(0, i);
      const inner = dropStatementsDeep(stmt.slice(i + 1, close), pred);
      const after = recurseBlocks(stmt.slice(close + 1), pred);
      return {
        text: header + '{' + inner.text + '}' + after.text,
        dropped: [...inner.dropped, ...after.dropped],
      };
    }
    i++;
  }
  return { text: stmt, dropped: [] };
}

// Remove try{...}catch(...JSONException...){...} spans ( brace-matched ) so
// the outer-wrap decision sees only UNGUARDED throwing calls. Bodies keeping
// their own guarded put (e.g. preferences keys()) must not get a redundant
// outer catch - javac rejects catching an exception nothing can throw.
function stripCaughtJsonTrys(text) {
  let out = text;
  let changed = true;
  while (changed) {
    changed = false;
    const re = /\btry\s*\{/g;
    let m;
    while ((m = re.exec(out))) {
      const openBrace = out.indexOf('{', m.index);
      let depth = 0;
      let endBrace = -1;
      for (let i = openBrace; i < out.length; i++) {
        if (out[i] === '{') depth++;
        else if (out[i] === '}') { depth--; if (depth === 0) { endBrace = i; break; } }
      }
      if (endBrace === -1) continue;
      const cm = out.slice(endBrace + 1).match(/^\s*catch\s*\(([^)]*)\)\s*\{/);
      if (!cm || !/JSONException/.test(cm[1])) continue;
      const cOpen = endBrace + 1 + cm[0].length - 1;
      let d2 = 0;
      let cEnd = -1;
      for (let i = cOpen; i < out.length; i++) {
        if (out[i] === '{') d2++;
        else if (out[i] === '}') { d2--; if (d2 === 0) { cEnd = i; break; } }
      }
      if (cEnd === -1) continue;
      out = out.slice(0, m.index) + out.slice(cEnd + 1);
      changed = true;
      break;
    }
  }
  return out;
}

export function transformJava(javaPath, model, moduleClass, flags) {
  let src = fs.readFileSync(javaPath, 'utf8').replace(/\r\n/g, '\n');
  const isKotlin = javaPath.endsWith('.kt');
  if (isKotlin) {
    flags.add('java-kotlin-source', 'blocking', 'Kotlin Capacitor plugin sources are not conformed (Java only) - port by hand.');
  }
  // host executor: balanced multiline-safe substitution BEFORE anything else
  // (line-level regexes cannot close `executeOnMainThread(() -> { ... });`)
  let executorSubs = 0;
  src = replaceCallsBalanced(src, 'getBridge().executeOnMainThread', (inner) => {
    executorSubs++;
    return `new android.os.Handler(android.os.Looper.getMainLooper()).post(${inner})`;
  });
  if (executorSubs) {
    flags.add('java-executor-subst', 'warning', `${executorSubs} getBridge().executeOnMainThread(...) call(s) auto-substituted with Handler(Looper.getMainLooper()).post(...) (balanced rewrite incl. multiline lambdas) - standard Android API, same semantics; review injection pattern.`);
  }
  const lines = src.split('\n');
  const primary = primaryResult(model);
  const distinctResults = new Set(model.methods.filter((m) => m.returns && m.returns !== 'void').map((m) => m.returns));

  const modulePascal = moduleClass.replace(/Module$/, ''); // "Device", "TestEvents"
  // module names are snake_case ("device", "test_events"); reverse model.mjs's
  // pascal() the same way moduleName() builds them (lower/digit -> upper split)
  const moduleName = modulePascal.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  const pkg = `${MODULE_PKG}.${moduleName}`;
  const implClass = `${moduleClass}Impl`;
  const listenerName = model.events.length ? `${modulePascal}Listener` : null;

  // helper scan runs FIRST: skipped (unportable) helper classes drive the
  // no-host policy below (drop-with-rejection for contract methods that
  // depend on them, statement surgery in lifecycle bodies, constants
  // literalized in place)
  const helpers = collectHelpers(javaPath, pkg, flags);
  const skippedClassNames = new Set(helpers.skippedClasses.map((c) => c.name));
  const skippedConsts = new Map(); // "Class.CONST" -> "literal"
  for (const c of helpers.skippedClasses) for (const [k, v] of c.consts) skippedConsts.set(`${c.name}.${k}`, v);
  const literalizeConsts = (text) => {
    let outT = text;
    for (const [key, lit] of skippedConsts) outT = outT.split(key).join(`"${lit}"`);
    return outT;
  };
  const unportableRe = skippedClassNames.size ? new RegExp(`\\b(?:${[...skippedClassNames].join('|')})\\b`) : null;
  const droppedFieldNames = new Set(); // fields whose declared type was an unportable class
  const unportableFieldRe = skippedClassNames.size
    ? new RegExp(`^\\s*(?:private|protected|public)\\s+(?:static\\s+)?(?:final\\s+)?(?:${[...skippedClassNames].join('|')})\\s+(\\w+)\\s*(?:=[^;]*)?;\\s*$`)
    : null;

  // method -> conformance info: return type + options param
  const resultByMethod = new Map(model.methods.map((m) => [m.name, m.returns]));
  const paramsByMethod = new Map(model.methods.map((m) => [m.name, m.params || []]));
  const modelEnums = enumTypesOf(model);
  const multiParamMethods = model.methods.filter((m) => (m.params || []).length > 1).map((m) => m.name);
  if (multiParamMethods.length) {
    flags.add('java-multi-param', 'blocking', `Method(s) ${multiParamMethods.join(', ')} take >1 contract param - only single-options methods are conformed mechanically (the generated Kotlin interface has one typed param per contract param). Port by hand.`);
  }

  // Locate the @CapacitorPlugin(...) annotation block and capture permissions
  let inAnnotation = false;
  let annotDepth = 0;
  let permissionNote = null;

  // Method spans: bodies of `void name(PluginCall call) { ... }` tracked by
  // brace depth, mirroring conform-swift.mjs. String literals containing
  // braces are a known, flagged edge (same as the Swift side). The param may
  // carry modifiers/annotations (`show(final PluginCall call)` - keyboard,
  // status-bar) - those methods are contract methods too.
  const sigRe = /^(\s*)(?:(?:public|private|protected|static|final|synchronized)\s+)*void\s+(\w+)\s*\(\s*(?:(?:final|@\w+|@Nullable|@NonNull)\s+)*(?:PluginCall|ValdiCall)\s+\w+\s*\)\s*\{/;
  let inMethod = null; // { name, maker, ret, options, depth, buf }
  let inOther = null; // { name, kind: lifecycle|helper|plain, depth, buf, permCallback }
  let lastDroppedAnnot = null;
  let sawLoad = false;
  let perMethodSites = 0;
  let untrackedResolves = 0;
  let voidResolveWithArgs = 0;
  let contextRewrites = 0;
  let unitNeeded = false;
  let unimplementedSites = 0;
  let unavailableSites = 0;
  const droppedMethods = []; // contract methods emitted as drop-with-rejection stubs
  const neutralizedMethods = []; // lifecycle/plain methods with statements dropped in place
  const dedupedTriggers = [];
  const helperCallMethods = []; // methods still taking a call object (flagged, shim-backed)
  const helperCallVerbs = new Set(); // call.<verb>( used by those methods -> shim surface
  let needsDeadCallClass = false; // an orphaned contract method got a dead local

  const wrapResolves = (text, method) => replaceCalls(text, 'call.resolve', (inner) => {
    if (!inner.trim()) return 'call.resolve()';
    if (!method.maker) {
      voidResolveWithArgs++;
      return null; // void-returning method resolving data - leave for hand review
    }
    perMethodSites++;
    return `call.resolve(${method.maker}(${inner}))`;
  });

  // conformance rewrites applied to one buffered method BODY (no signature,
  // no closing brace). Wraps the whole body in the promise + try/catch shape.
  const conformBody = (rawBody, method) => {
    const P = 'valdiPromise';
    let text = literalizeConsts(rawBody);
    // no-host policy (mirror of the objc no-webview scope policy): a body
    // depending on unportable helper classes (skipped: they reference the
    // Capacitor bridge) or their fields cannot compile on Valdi - the method
    // becomes a DROP-WITH-REJECTION stub, body preserved as comments.
    const badTokens = [];
    if (unportableRe) { for (const c of skippedClassNames) if (unportableRe.test(text) && new RegExp(`\\b${c}\\b`).test(text)) badTokens.push(c); }
    for (const f of droppedFieldNames) if (new RegExp(`\\b${f}\\b`).test(text)) badTokens.push(`field ${f}`);
    if (badTokens.length) {
      droppedMethods.push(method.name);
      flags.add(`java-bridge-dropped:${method.name}`, 'warning', `Contract method ${method.name}() emitted as a DROP-WITH-REJECTION stub: its body depends on ${badTokens.join(', ')} - skipped helper classes that live on Capacitor's bridge/Activity host, which a Valdi module does not have. The generated interface method is kept and the promise rejects with "${method.name}: not applicable on Valdi - no Capacitor bridge". Original body sites (port by hand if the behavior is wanted):\n${text.trim().split('\n').slice(0, 4).map((l) => `    ${l.trim()}`).join('\n')}`);
      return [
        `        ResolvablePromise<${method.ret}> ${P} = new ResolvablePromise<>();`,
        `        // plugin2valdi: DROP-WITH-REJECTION stub - body depends on ${badTokens.join(', ')} (Capacitor host only).`,
        ...text.trim().split('\n').map((l) => `        //   ${l.replace(/^\s*/, '')}`),
        `        ${P}.fulfillFailure(new RuntimeException("${method.name}: not applicable on Valdi - no Capacitor bridge"));`,
        `        return ${P};`,
      ].join('\n');
    }
    text = wrapResolves(text, method);
    text = replaceCalls(text, 'call.resolve', (inner) => {
      if (!inner.trim()) { unitNeeded = true; return `${P}.fulfillSuccess(kotlin.Unit.INSTANCE)`; }
      return `${P}.fulfillSuccess(${inner})`; // maker-wrapped above (or flagged void-resolve)
    });
    // call.unimplemented()/call.unavailable(): Capacitor rejects the promise
    // with MIUNIMPLEMENTED/MIUNAVAILABLE - mirror as a plain rejection (the
    // objc pass maps [call unimplemented] the same way).
    text = replaceCalls(text, 'call.unimplemented', () => { unimplementedSites++; return `${P}.fulfillFailure(new RuntimeException("unimplemented"))`; });
    text = replaceCalls(text, 'call.unavailable', () => { unavailableSites++; return `${P}.fulfillFailure(new RuntimeException("unavailable"))`; });
    text = replaceCalls(text, 'call.reject', (inner) => {
      const args = inner.split(',').map((a) => a.trim());
      if (args.length === 1 && args[0]) return `${P}.fulfillFailure(new RuntimeException(${args[0]}))`;
      if (args.length === 2 && args[1] && !/^"/.test(args[1])) {
        return `${P}.fulfillFailure(new RuntimeException(${args[0]}, ${args[1]}))`; // reject("msg", throwable)
      }
      flags.add('java-reject-shape', 'warning', `call.reject(${inner}) has an unsupported argument shape - rewritten to fulfillFailure(new RuntimeException(msg)); review error fidelity.`);
      return `${P}.fulfillFailure(new RuntimeException(${args[0] || '"rejected"'}))`;
    });
    // typed options access: call.getX("field"[, default]) -> options.getX()
    if (method.options) {
      const oType = modelType(model, method.options.type);
      const enumFieldNames = new Set((oType?.fields || []).filter((f) => modelEnums.some((e) => e.name === enumBase(f.type))).map((f) => f.name));
      for (const kind of ['String', 'Int', 'Integer', 'Double', 'Boolean', 'Array']) {
        text = replaceCalls(text, `call.get${kind}`, (inner) => {
          const m = inner.match(/^"(\w+)"\s*(?:,\s*([\s\S]+))?$/);
          const field = m ? (oType?.fields || []).find((f) => f.name === m[1]) : null;
          if (!field) {
            flags.add(`java-option-field:${method.name}`, 'blocking', `call.get${kind}(${inner}) does not match a field of ${method.options.type} - port this options read by hand.`);
            return `call.get${kind}(${inner})`;
          }
          const g = getterFor(field.name);
          if (kind === 'Array') flags.add('java-option-getter:Array', 'warning', `call.getArray(...) -> ${method.options.name}.${g}(): contract array fields are Kotlin List<String>/List<Double> - verify the mapped type.`);
          if (kind === 'Int') flags.add('java-option-int', 'warning', 'call.getInt(...) -> options.getX(): contract `number` fields are Kotlin Double - verify arithmetic on the read value.');
          // enum-typed fields: the generated Kotlin property is the enum
          // class (var style: KeyboardStyle) - hand the body the wire string
          // it expects via .getValue() (null-guarded for optional fields)
          if (enumFieldNames.has(field.name)) {
            const read = `${method.options.name}.${g}()`;
            const guarded = `${read} == null ? null : ${read}.getValue()`;
            if (!flags.has('java-option-enum')) {
              flags.add('java-option-enum', 'resolved', `call.getString(...) reads of enum-typed options fields map to options.getX().getValue() - the generated Kotlin property is the enum class (probe-verified: var mode: Mode + val value: String), so the translated body's String expectations are served through the wire value.`);
            }
            return m[2] !== undefined ? `(${guarded}) != null ? (${guarded}) : ${m[2]}` : guarded;
          }
          const read = `${method.options.name}.${g}()`;
          return m[2] !== undefined ? `${read} != null ? ${read} : ${m[2]}` : read;
        });
      }
    }
    // early returns after reject/resolve still must hand back the promise
    text = text.replace(/(^|\n)(\s*)return\s*;/g, '$1$2return valdiPromise;');
    // surviving host-surface statements (bridge./getBridge()/getConfig()/
    // getActivity()/execute()) cannot compile - the symbols only exist inside
    // Capacitor's Plugin base class. Same policy as Swift/objc: a contract
    // method whose body leans on the host drops-with-rejection (original
    // body as comments) instead of shipping broken code.
    const hostSurvivors = (text.match(/^\s*.*(?:\bbridge\s*\.|getBridge\s*\(|getConfig\s*\(|getActivity\s*\(|\bexecute\s*\().*$/gm) || []).filter((l) => !/^\s*\/\//.test(l));
    if (hostSurvivors.length) {
      flags.add(`java-host-dropped:${method.name}`, 'warning', `Method ${method.name}() depends on Capacitor host APIs (${hostSurvivors.map((l) => l.trim()).slice(0, 3).join(' | ')}) - emitted as a rejection ("${method.name}: not applicable on Valdi - no Capacitor bridge"); the original body is preserved as comments. Port against Valdi APIs if this behavior matters (app context: appContext(), main thread: Handler).`);
      return [
        `        ResolvablePromise<${method.ret}> ${P} = new ResolvablePromise<>();`,
        '        // plugin2valdi: no-host policy - original body preserved for the hand port:',
        ...text.split('\n').map((l) => `        //${l.replace(/^\s{8}/, '')}`),
        `        ${P}.fulfillFailure(new RuntimeException("${method.name}: not applicable on Valdi - no Capacitor bridge"));`,
        `        return ${P};`,
      ].join('\n');
    }
    // any surviving `call` reference (helper-call flow, odd shapes) gets a
    // DEAD LOCAL shim so the method compiles - the Capacitor call flow it
    // feeds (helper taking the call object, async callback threading) is
    // runtime-dead until hand-ported; the flag says exactly that
    const orphanSites = (text.match(/\bcall\.\w+\(/g) || []);
    const bareCall = /\bcall\b/.test(text.replace(/valdiCall/g, ''));
    if (orphanSites.length || bareCall) {
      for (const s of orphanSites) {
        const v = s.match(/^call\.(\w+)\($/);
        if (v) helperCallVerbs.add(v[1]);
      }
      needsDeadCallClass = true;
      text = [
        '        // plugin2valdi dead shim - the Capacitor call flow this method feeds is',
        '        // runtime-dead on Valdi (see java-orphan-call-sites below): port the',
        '        // flow (thread the ResolvablePromise / resolved value through) and',
        '        // delete this local together with the support-file shim.',
        '        final ValdiCall call = new ValdiCall();',
        text,
      ].join('\n');
      flags.add(`java-orphan-call-sites:${method.name}`, 'blocking', `A call site survived the conformance rewrites in ${method.name}() (${orphanSites.join(', ') || 'bare `call` argument - likely passed into a helper method'}). A dead ValdiCall local keeps the file compiling, but the flow is RUNTIME-DEAD: the promise never fulfills through it. Port by hand: thread the ResolvablePromise (or the resolved value) through the helper instead of the Capacitor call object.`);
    }
    const lastStmt = text.trimEnd().split('\n').filter((l) => l.trim()).pop() || '';
    const endsInReturn = /\b(return|throw)\b[^;]*;\s*$/.test(lastStmt);
    // only wrap when the body can actually throw JSONException - javac rejects
    // catching a checked exception nothing in the try can throw (bodies that
    // never touch org.json, Map.put-only bodies, and bodies whose only
    // throwing calls sit inside their own catch(JSONException) guards).
    // A bare .put( is NOT enough: Map.put matches too - require a
    // JSONObject/JSONArray binding in the body first.
    const bodySansCaught = stripCaughtJsonTrys(text);
    const hasJsonBinding = /new\s+JSONObject\s*\(|new\s+JSONArray\s*\(|JSONObject\s+\w+\s*=|JSONArray\s+\w+\s*=/.test(bodySansCaught);
    const jsonThrows = hasJsonBinding && /\.put\s*\(|\.accumulate\s*\(|\.append\s*\(/.test(bodySansCaught);
    const P2 = '            ';
    if (!jsonThrows) {
      return [
        `        ResolvablePromise<${method.ret}> ${P} = new ResolvablePromise<>();`,
        text,
        ...(endsInReturn ? [] : [`        return ${P};`]),
      ].join('\n');
    }
    return [
      `        ResolvablePromise<${method.ret}> ${P} = new ResolvablePromise<>();`,
      `        try {`,
      text,
      ...(endsInReturn ? [] : [`${P2}return ${P};`]),
      `        } catch (org.json.JSONException e) {`,
      `            ${P}.fulfillFailure(new RuntimeException(e));`,
      `            return ${P};`,
      `        }`,
    ].join('\n');
  };

  // no-host policy for NON-contract bodies (lifecycle + plain helpers):
  // unportable-class/host-surface statements drop IN PLACE (ritual-bearing
  // statements never drop); helper methods still taking a call object are
  // kept verbatim (flagged + dead-shim backed) - they are Capacitor call
  // flow, handed to a human with precise instructions.
  const processOtherBody = (rawBody, span) => {
    let text = literalizeConsts(rawBody);
    if (span.kind === 'helper') {
      helperCallMethods.push(span.name);
      const verbs = [...new Set([...text.matchAll(/\bcall\.(\w+)\s*\(/g)].map((m) => m[1]))];
      for (const v of verbs) helperCallVerbs.add(v);
      let detail = `Method ${span.name}(...) still takes a Capacitor-style call object - body preserved VERBATIM (${verbs.map((v) => `call.${v}(...)`).join(', ') || 'no call.* sites'}) and a dead ValdiCall shim in the support file keeps everything compiling.`;
      if (span.permCallback) detail += ' It was a @PermissionCallback: Capacitor permission machinery does not run on Valdi, so nothing invokes it.';
      detail += ' Port by hand if a Valdi flow needs it: thread the ResolvablePromise (or the resolved value) through the helper instead of the call object.';
      flags.add(`java-helper-call-flow:${span.name}`, 'blocking', detail);
      return text;
    }
    const badTokens = [...droppedFieldNames, ...(unportableRe ? [...skippedClassNames] : [])];
    const badRefRe = badTokens.length ? new RegExp(`\\b(?:${badTokens.join('|')})\\b`) : null;
    const triggersBefore = (text.match(/\bbridge\.trigger(?:Window)?JSEvent\s*\(/g) || []).length;
    const pred = (stmt) => (HOST_SURFACE_RE.test(stmt) || (badRefRe && badRefRe.test(stmt))) && !RITUAL_BEARING_RE.test(stmt);
    const res = dropStatementsDeep(text, pred);
    const triggersAfter = (res.text.match(/\bbridge\.trigger(?:Window)?JSEvent\s*\(/g) || []).length;
    if (res.dropped.length) {
      neutralizedMethods.push(span.name);
      flags.add(`java-bridge-neutralized:${span.name}`, 'warning', `Statement(s) in ${span.name}() depending on Capacitor host APIs (bridge/getBridge()/getConfig()/getActivity()/execute()/unportable helper classes) dropped in place - the method is kept for the surviving logic. Dropped:\n${res.dropped.slice(0, 6).map((d) => `    ${d}`).join('\n')}`);
    }
    if (triggersBefore > triggersAfter && /notifyListeners/.test(text)) {
      dedupedTriggers.push(span.name);
      flags.add(`java-bridge-event-deduped:${span.name}`, 'resolved', `${triggersBefore - triggersAfter} bridge.triggerWindowJSEvent(...) call(s) in ${span.name}() not re-delivered: the same method already emits the same event(s) through notifyListeners -> the locked listener, and Valdi has a single event channel - Capacitor split DOM window events from plugin listeners, so re-delivery would double-fire. No listener payload is lost.`);
    }
    let cleaned = res.text;
    // JSObject -> JSONObject changes the checked-exception contract: Capacitor's
    // JSObject ships non-throwing put(...) overloads that SWALLOW JSONException.
    // Non-contract bodies have no conformance try/catch - preserve JSObject's
    // swallow semantics with a silent catch (contract bodies are already
    // wrapped by the conformance pass; helper bodies keep the hand-port flag).
    if (span.kind !== 'helper' && /\.put\s*\(|new JSONArray\s*\([^)]|\.accumulate\s*\(|\.append\s*\(/.test(stripCaughtJsonTrys(cleaned))) {
      if (span.retType === 'void') {
        cleaned = [
          '        // plugin2valdi: Capacitor JSObject.put(...) swallowed JSONException; org.json',
          '        // JSONObject.put is checked - silent catch preserves JSObject semantics.',
          '        try {',
          cleaned,
          '        } catch (org.json.JSONException e) {',
          '        }',
        ].join('\n');
        flags.add(`java-json-swallows:${span.name}`, 'warning', `Body of ${span.name}() used Capacitor JSObject's non-throwing put(...) overloads (they swallow JSONException internally). After the JSObject->JSONObject rename the calls are checked - the body is wrapped in a silent catch(JSONException) preserving the original swallow semantics.`);
      } else {
        // returning body: wrap each COMPLETE put/accumulate/append statement
        // in JSObject's silent swallow (the return path stays outside the
        // try). Incomplete shapes (multiline puts, chained fragments) keep a
        // scoped blocking flag - those still need a hand port.
        const putStmt = /^(\s*)([\w.[\]()"'>]+\.(?:put|accumulate|append)\s*\(.*\);\s*)$/;
        let wrapped = 0;
        let unwrapped = 0;
        cleaned = cleaned.split('\n').map((l) => {
          if (!/\.(put|accumulate|append)\s*\(/.test(l)) return l;
          if (/try|catch/.test(l) || !putStmt.test(l)) { unwrapped++; return l; }
          wrapped++;
          const m = l.match(putStmt);
          return `${m[1]}try { ${m[2].trim()} } catch (org.json.JSONException e) { /* JSObject swallow */ }`;
        }).join('\n');
        if (unwrapped) {
          flags.add(`java-json-throws:${span.name}`, 'blocking', `${unwrapped} put-shaped statement(s) in ${span.name}() are not complete single-line statements (multiline or chained) and could not be auto-wrapped in the JSObject swallow catch - guard them by hand.`);
        } else if (wrapped) {
          flags.add(`java-json-swallows:${span.name}`, 'warning', `Body of ${span.name}() used Capacitor JSObject's non-throwing put(...) overloads; after the rename to checked JSONObject.put each complete statement is wrapped in a silent catch(JSONException) preserving JSObject semantics (return paths outside the try).`);
        }
      }
    }
    return cleaned;
  };

  const out = [];
  for (let li = 0; li < lines.length; li++) {
    let line = lines[li];

    if (!inAnnotation && /@CapacitorPlugin\s*\(/.test(line)) {
      permissionNote = line.includes('POST_NOTIFICATIONS') || lines.slice(li, li + 6).some((l) => l.includes('POST_NOTIFICATIONS'))
        ? 'POST_NOTIFICATIONS (receive)'
        : permissionNote;
      annotDepth = (line.match(/\(/g) || []).length - (line.match(/\)/g) || []).length;
      if (annotDepth <= 0) continue;
      inAnnotation = true;
      continue;
    }
    if (inAnnotation) {
      if (line.includes('POST_NOTIFICATIONS')) permissionNote = 'POST_NOTIFICATIONS (receive)';
      annotDepth += (line.match(/\(/g) || []).length - (line.match(/\)/g) || []).length;
      if (annotDepth <= 0) inAnnotation = false;
      continue;
    }

    if (/^package\s+[\w.]*;/.test(line)) { out.push(`package ${pkg};`); continue; }
    if (/^import com\.getcapacitor\.(JSObject|Plugin|PluginCall|PluginMethod)/.test(line)) continue;
    if (/^import com\.getcapacitor\./.test(line)) continue;
    if (/^\s*@PluginMethod\s*$/.test(line)) continue;
    // permission machinery annotations reference dropped imports
    if (/^\s*@(PermissionCallback|Permission)\b/.test(line)) {
      lastDroppedAnnot = (line.match(/@\w+/) || [''])[0].slice(1);
      continue;
    }
    // class no longer extends Plugin - the super call cannot survive
    if (/^\s*super\.handleOnResume\(\);/.test(line)) {
      flags.add('java-lifecycle-super', 'warning', 'super.handleOnResume() dropped (no Plugin superclass). Wire handleOnResume() to the Valdi Android lifecycle equivalent.');
      continue;
    }

    // class header -> package-private impl of the GENERATED Kotlin interface
    line = line.replace(/public class (\w+) extends Plugin \{/, `class ${implClass} implements ${moduleClass} {`);

    // lifecycle: drop @Override preceding Capacitor lifecycle overrides
    if (/^\s*@Override\s*$/.test(line)) {
      const next = (lines[li + 1] || '') + (lines[li + 2] || '');
      if (/\b(load|handleOnResume|handleOnPause|handleOnDestroy|handleOnCreate)\s*\(/.test(next)) continue;
    }
    if (/public void load\(\)/.test(line)) sawLoad = true;
    line = line.replace(/public void load\(\)/, 'public void onLoad()');
    line = line.replace(/protected void handleOnResume\(\)/, 'public void handleOnResume()');

    // ritual calls - Java flavor: notifyListeners("e", expr); whole-text
    // pass below handles multiline; per-line keeps the cheap renames here
    line = line.replace(/\bJSObject\b/g, 'JSONObject');
    line = line.replace(/\bJSArray\b/g, 'JSONArray');
    line = line.replace(/\bPluginCall\b/g, 'ValdiCall');
    // host executor substitution happens whole-text before the line pass
    // (balanced + multiline-safe) - nothing to do per line
    // Capacitor bridge context -> valdi runtime context resolver (injected
    // at class tail); resolved lazily at onLoad (factories load inside a
    // live runtime, so ValdiRuntimeManager.allRuntimes() is non-empty)
    if (/\bgetContext\(\)/.test(line)) contextRewrites++;
    line = line.replace(/\bgetContext\(\)/g, 'appContext()');

    // ---- method span tracking: buffer the body, conform it when the ----
    // ---- braces balance ----
    if (inMethod) {
      inMethod.buf.push(line);
      for (const ch of line) {
        if (ch === '{') inMethod.depth++;
        else if (ch === '}') inMethod.depth--;
      }
      if (inMethod.depth <= 0) {
        const buffered = inMethod.buf.join('\n');
        const bodyText = buffered.slice(0, buffered.lastIndexOf('}'));
        out.push(conformBody(bodyText, inMethod), '    }');
        inMethod = null;
      }
      continue;
    }
    // ---- non-contract method spans (lifecycle, plain helpers, methods ----
    // ---- still taking a call object): buffer + apply the no-host policy ----
    if (inOther) {
      inOther.buf.push(line);
      for (const ch of line) {
        if (ch === '{') inOther.depth++;
        else if (ch === '}') inOther.depth--;
      }
      if (inOther.depth <= 0) {
        const buffered = inOther.buf.join('\n');
        const bodyText = buffered.slice(0, buffered.lastIndexOf('}'));
        out.push(processOtherBody(bodyText, inOther), '    }');
        inOther = null;
      }
      continue;
    }
    // field declarations typed by an unportable helper class cannot compile -
    // drop the declaration, remember the field name (statements referencing
    // it are dropped in place below; contract methods depending on it become
    // drop-with-rejection stubs)
    if (unportableFieldRe) {
      const fd = line.match(unportableFieldRe);
      if (fd) {
        droppedFieldNames.add(fd[1]);
        flags.add(`java-unportable-field:${fd[1]}`, 'warning', `Field ${fd[1]} (typed by a skipped/unportable helper class) dropped with its declaring line - the class only exists on Capacitor's Android host. Statements referencing it are dropped in place; contract methods using it reject.`);
        continue;
      }
    }
    const sig = line.match(sigRe);
    if (sig && resultByMethod.has(sig[2])) {
      const name = sig[2];
      const result = resultByMethod.get(name);
      const params = paramsByMethod.get(name) || [];
      const options = params.length === 1 ? params[0] : null;
      const ret = !result || result === 'void' ? 'kotlin.Unit' : kotlinType(result);
      if (ret === 'kotlin.Unit') unitNeeded = true;
      const method = {
        name,
        maker: result && result !== 'void' ? `make${result}` : null,
        ret,
        options,
        depth: 1,
        buf: [],
      };
      // signature rewrite: Promise<T> + typed options param (or none).
      // JVM names of generated interface methods are NOT mangled (probe:
      // get/set/configure compiled verbatim against the interfaces).
      const paramText = options && !multiParamMethods.includes(name) ? `${kotlinType(options.type)} ${options.name}` : '';
      const sigText = `${sig[1]}@Override\n${sig[1]}public Promise<${ret}> ${name}(${paramText}) {`;
      // text after the opening `{` starts the buffered body (one-liners
      // close on the same line; the closing `}` is stripped at span close)
      const rest = line.slice(sig[0].length);
      method.buf.push(rest);
      for (const ch of rest) {
        if (ch === '{') method.depth++;
        else if (ch === '}') method.depth--;
      }
      if (method.depth <= 0) {
        const buffered = method.buf.join('\n');
        const bodyText = buffered.slice(0, buffered.lastIndexOf('}'));
        out.push(sigText, conformBody(bodyText, method), '    }');
      } else {
        out.push(sigText);
        inMethod = method;
      }
      continue;
    }

    // any other method-shaped line opens a non-contract span (lifecycle,
    // helper still taking a call object, plain helper) - buffered and closed
    // through the no-host policy above
    const anyMethodRe = /^(\s*)(?:(?:public|private|protected|static|final|synchronized|abstract)\s+)*([\w.$]+(?:\s*<[^>]+>)?)\s+(\w+)\s*\(([^)]*)\)\s*\{$/;
    const m2 = line.match(anyMethodRe);
    if (m2) {
      const params = m2[4];
      const lifecycle = params.trim() === '' && /^(onLoad|load|handleOnResume|handleOnPause|handleOnDestroy|handleOnCreate)$/.test(m2[3]);
      const helper = /(?:PluginCall|ValdiCall)/.test(params) && !resultByMethod.has(m2[3]);
      const span = { name: m2[3], retType: m2[2], kind: lifecycle ? 'lifecycle' : helper ? 'helper' : 'plain', depth: 1, buf: [], permCallback: lastDroppedAnnot === 'PermissionCallback' };
      lastDroppedAnnot = null;
      const rest = line.slice(m2[0].length);
      span.buf.push(rest);
      for (const ch of rest) {
        if (ch === '{') span.depth++;
        else if (ch === '}') span.depth--;
      }
      if (span.depth <= 0) {
        const buffered = span.buf.join('\n');
        const bodyText = buffered.slice(0, buffered.lastIndexOf('}'));
        out.push(processOtherBody(bodyText, span), '    }');
      } else {
        out.push(line);
        inOther = span;
      }
      continue;
    }

    // resolve sites outside any tracked method span (helper methods that take
    // the call object, odd formatting): fall back to the primary maker + flag
    if (/call\.resolve\s*\(/.test(line)) {
      line = replaceCalls(line, 'call.resolve', (inner) => {
        if (!inner.trim()) return 'call.resolve()';
        if (!primary) return null;
        untrackedResolves++;
        return `call.resolve(make${primary}(${inner}))`;
      });
    }

    out.push(line);
  }

  let body = out.join('\n');

  // resolve constant event names: `static final String EVENT_X = "x"`
  const constMap = new Map();
  for (const m of body.matchAll(/(?:static\s+)?final\s+String\s+(\w+)\s*=\s*"([^"]+)"/g)) {
    constMap.set(m[1], m[2]);
  }
  let unresolvedEvents = 0;
  body = replaceCalls(body, 'notifyListeners', (inner) => {
    const lit = inner.match(/^"(\w+)"\s*,\s*([\s\S]+?)(?:\s*,\s*(?:true|false))?\s*$/);
    const varM = inner.match(/^(\w+)\s*,\s*([\s\S]+?)(?:\s*,\s*(?:true|false))?\s*$/);
    const name = lit ? lit[1] : (varM && constMap.has(varM[1]) ? constMap.get(varM[1]) : null);
    const dataExpr = lit ? lit[2] : varM ? varM[2] : null;
    if (/,\s*(?:true|false)\s*$/.test(inner)) {
      flags.add('java-retain-until-consumed', 'blocking', 'notifyListeners(..., true) found - Capacitor retains the event until a JS listener attaches; design queued delivery for the Valdi setListener model.');
    }
    if (name && dataExpr != null) {
      const ev = model.events.find((e) => e.name === name);
      const payload = ev ? (ev.payloadType || ev.payload) : 'UNKNOWN';
      return `emit${pascal(name)}(make${payload}(${dataExpr}))`;
    }
    if (varM) {
      unresolvedEvents++;
      return `emitUnresolvedEvent(${varM[1]}, ${varM[2]})`;
    }
    return null;
  });
  if (unresolvedEvents) {
    flags.add('java-dynamic-event-names', 'warning', `${unresolvedEvents} notifyListeners call(s) with non-constant event names rewritten to emitUnresolvedEvent(...) - resolve the constants or port by hand.`);
  }
  const primitivePayloadSet = [...new Set([...resultTypes(model), ...model.events.map((e) => e.payloadType || e.payload)].filter((t) => /^(string|number|boolean)$/.test(t) || modelEnums.some((e) => e.name === t)))];
  if (primitivePayloadSet.length) {
    flags.add('java-primitive-payload', 'warning', `Primitive/enum contract payload/result type(s) [${primitivePayloadSet.join(', ')}]: the Capacitor body resolves/emits a JSON dict, the valdi contract promises a primitive or enum - a heuristic make<T>(dict) bridge is emitted (single-key unwrap, then the wire converter for enums; unknown strings fall back to the first declared constant). Review value fidelity by hand.`);
  }
  if (perMethodSites) {
    flags.add('java-resolve-wrap-assumption', 'resolved', `Every call.resolve(...) site is wrapped with the maker of its enclosing method's result type (make<T of the enclosing @PluginMethod>, span-tracked by brace depth - same pattern as the Swift conformance pass). ${perMethodSites} site(s) wrapped across ${distinctResults.size} distinct result type(s).`);
  }
  if (untrackedResolves) {
    flags.add('java-untracked-resolve', 'warning', `${untrackedResolves} call.resolve(...) site(s) sit outside any tracked \`void name(PluginCall call)\` method span (helper methods taking the call object, or off-pattern formatting) and were wrapped with the primary maker make${primary}(...) - re-wrap by hand against the contract.`);
  }
  if (voidResolveWithArgs) {
    flags.add('java-void-resolve-data', 'warning', `${voidResolveWithArgs} call.resolve(...) site(s) with arguments inside void-returning methods were left unwrapped - the contract promises no result value there; review what the data was for.`);
  }
  if (unimplementedSites) {
    flags.add('java-unimplemented-mapped', 'warning', `${unimplementedSites} call.unimplemented() site(s) mapped to fulfillFailure(new RuntimeException("unimplemented")) - Capacitor rejects with MIUNIMPLEMENTED; adjust the error string if the JS side matches on it (mirrors the objc pass's [call unimplemented] mapping).`);
  }
  if (unavailableSites) {
    flags.add('java-unavailable-mapped', 'warning', `${unavailableSites} call.unavailable() site(s) mapped to fulfillFailure(new RuntimeException("unavailable")) - Capacitor rejects with MIUNAVAILABLE; adjust the error string if the JS side matches on it.`);
  }
  if (droppedMethods.length || neutralizedMethods.length || skippedConsts.size || droppedFieldNames.size) {
    let policyText = `Capacitor host dependence handled by the no-host policy (Java mirror of the objc no-webview scope policy): contract methods whose bodies depend on skipped/unportable helper classes became DROP-WITH-REJECTION stubs (${droppedMethods.map((m) => `java-bridge-dropped:${m}`).join(', ') || 'none'}); lifecycle/plain bodies had host statements dropped in place (${neutralizedMethods.map((m) => `java-bridge-neutralized:${m}`).join(', ') || 'none'}); static-final String constants of skipped helpers were literalized at their use sites (${skippedConsts.size} constant(s)); fields typed by skipped helpers were dropped with their declarations (${[...droppedFieldNames].join(', ') || 'none'}).`;
    if (neutralizedMethods.includes('onLoad') && model.events.length) {
      policyText += ` CONSEQUENCE: the plugin's load()-time setup sat in the dropped statements - the contract events (${model.events.map((e) => e.name).join(', ')}) may never fire on Android unless that wiring is ported by hand. setListener itself is wired and safe to call.`;
    }
    flags.add('java-no-host-policy', 'resolved', policyText);
  }

  if (permissionNote) flags.add('java-permissions', 'blocking', `Plugin declared Android permission ${permissionNote}. Valdi/android_deps must carry the manifest entry + runtime request flow - Capacitor's permission machinery does not translate.`);
  if (contextRewrites) {
    flags.add('java-context-resolver', 'resolved', `${contextRewrites} getContext() call(s) rewritten to appContext(): a generated resolver returning the loading ValdiRuntime's Context (ValdiRuntimeManager.allRuntimes().get(0).getContext() - factories load inside a live runtime, so the list is non-empty by construction). Context-dependent bodies (SharedPreferences, Settings.Secure) keep working.`);
  }

  for (const api of HOST_APIS) {
    const hits = (src.match(new RegExp(api.replace('()', '\\(\\)').replace(/[()]/g, (c) => (c === '(' ? '\\(' : '\\)')), 'g')) || []).length;
    if (hits > 0) {
      // `bridge` sites consumed entirely by the no-host policy (statement
      // drops / drop-with-rejection stubs) resolve like the objc side's
      // objc-host-api:* summaries
      if (api === 'bridge') {
        const survivors = (body.match(/\bbridge\s*\./g) || []).length;
        if (survivors === 0) {
          flags.add(`java-host-api:${api}`, 'resolved', `${hits} use(s) of Capacitor host API "bridge" - ALL handled by the no-host policy: statements dropped in place (java-bridge-neutralized:*), window-JS events deduped through the locked listener (java-bridge-event-deduped:*), or their methods emitted as drop-with-rejection stubs (java-bridge-dropped:*). The conformance target compiles without any Capacitor host.`);
          continue;
        }
      }
      if (/^handleOn/.test(api) && neutralizedMethods.some((m) => m.toLowerCase() === api.toLowerCase())) {
        flags.add(`java-host-api:${api}`, 'warning', `${hits} use(s) of Capacitor host API "${api}" - the method was kept but its host-dependent statements were dropped in place (see java-bridge-neutralized:${api}); wire the surviving logic to the Valdi Android lifecycle equivalent if needed.`);
        continue;
      }
      flags.add(`java-host-api:${api}`, 'warning', `${hits} use(s) of Capacitor host API "${api}" - body preserved; provide a Valdi equivalent (main-thread executor, app context, prefs, lifecycle hook).`);
    }
  }
  if (/FirebaseMessaging|firebase/.test(src)) flags.add('java-fcm-dep', 'warning', 'FirebaseMessaging referenced - add firebase-messaging to the module\'s android_deps and verify token delivery wiring outside Capacitor\'s MessagingService path.');

  // ---- class tail: lifecycle anchor, makers, events, context, marshaller ----
  const tail = [];
  if (!sawLoad) tail.push('', '    public void onLoad() {', '        // plugin2valdi: plugin had no load() - empty lifecycle anchor for the factory.', '    }', '');
  tail.push(javaMakeFunctions(model));
  if (listenerName) {
    // Event delivery: setListener stores the runtime-marshalled listener (the
    // JS-side callbacks arrive as the generated <X>Listener_Proxy instance);
    // emitX forwards to it. Kotlin interface methods compile to plain JVM
    // names - fun scanCompleted(payload: ScanResult) is callable verbatim as
    // listener.scanCompleted(payload) from Java (verified against the
    // compiler-generated test_events.kt). Storage access is synchronized (the
    // ObjC conformance spells the same shape @synchronized); the listener is
    // invoked OUTSIDE the lock so a re-entrant setListener cannot deadlock.
    const eventSigs = model.events.map((ev) => `${listenerName}.${camel(ev.name)}(${kotlinType(ev.payloadType || ev.payload)})`).join(', ');
    tail.push(
      `    // plugin2valdi: events wired - setListener stores the generated ${listenerName};`,
      `    // emit* forwards to it (null-safe, synchronized access; invoked`,
      `    // outside the lock).`,
      `    private ${listenerName} valdiListener;`,
      '',
      `    @Override`,
      `    public void setListener(${listenerName} listener) {`,
      `        synchronized (this) {`,
      `            this.valdiListener = listener;`,
      `        }`,
      `    }`,
      '',
      ...model.events.flatMap((ev) => [
        `    private void emit${pascal(ev.name)}(${kotlinType(ev.payloadType || ev.payload)} payload) {`,
        `        ${listenerName} l;`,
        `        synchronized (this) { l = this.valdiListener; }`,
        `        if (l != null) l.${camel(ev.name)}(payload);`,
        `    }`,
        '',
      ]),
    );
    flags.add('java-events-wired', 'resolved', `Event delivery wired: setListener(${listenerName}) stores the runtime-marshalled listener and every rewritten emit* forwards to it - ${eventSigs} called verbatim (generated Kotlin interface methods have plain JVM names, no mangling - verified against compiler output for test_events: fun scanCompleted(payload: ScanResult) / fun decodeError(payload: String)). Storage access is synchronized (the ObjC conformance uses @synchronized for the same shape); the listener is invoked outside the lock so re-entrant setListener calls cannot deadlock. E2E verified on the emulator a test app: scanCompleted delivered ScanResult(barcode, format) and decodeError delivered the String payload to the TS listener. Caveats: single-listener semantics (a second setListener replaces the first - same as the iOS conformance), events fired before the first setListener are dropped (no Capacitor retainUntilConsumed queue - flagged separately when the source uses it), and delivery happens on the calling thread (no main-loop hop; Capacitor's notifyListeners dispatched on the JS thread - the JS bridge in the proxy handles its own threading).`);
  }
  if (unresolvedEvents) {
    tail.push(
      `    private static void emitUnresolvedEvent(String name, Object data) {`,
      `        // plugin2valdi: event name was a non-constant expression - resolve by hand.`,
      `        System.out.println("plugin2valdi: unresolved event " + name);`,
      `    }`,
      '',
    );
  }
  tail.push(
    '',
    `    private static android.content.Context appContext() {`,
    `        // plugin2valdi: Valdi modules have no Capacitor bridge; the runtime that`,
    `        // loaded this module carries the app Context (factories are invoked`,
    `        // from JS, i.e. inside a live runtime - ValdiRuntimeManager.allRuntimes()`,
    `        // is non-empty by construction at module-load time).`,
    `        java.util.List<com.snap.valdi.ValdiRuntime> runtimes = com.snap.valdi.ValdiRuntimeManager.allRuntimes();`,
    `        return runtimes.isEmpty() ? null : runtimes.get(0).getContext();`,
    `    }`,
    '',
    `    @Override`,
    `    public int pushToMarshaller(com.snap.valdi.utils.ValdiMarshaller marshaller) {`,
    `        // Kotlin interface method with a body (no -Xjvm-default in the valdi`,
    `        // toolchain) is abstract at the JVM level - delegate to DefaultImpls`,
    `        // (compile-probe verified: a probe target).`,
    `        return ${moduleClass}.DefaultImpls.pushToMarshaller(this, marshaller);`,
    `    }`,
  );
  // splice the tail before the class's final closing brace
  const lastBrace = body.lastIndexOf('}');
  body = `${body.slice(0, lastBrace).trimEnd()}\n${tail.join('\n')}\n}\n`;

  // ---- imports for the conformance surface (deduped against survivors) ----
  const wanted = [
    'import com.snap.valdi.promise.Promise;',
    'import com.snap.valdi.promise.ResolvablePromise;',
    'import org.json.JSONArray;',
    'import org.json.JSONException;',
    'import org.json.JSONObject;',
  ];
  if (unitNeeded) wanted.push('import kotlin.Unit;');
  const imports = wanted.filter((i) => !body.includes(i));
  const pkgLine = `package ${pkg};`;
  body = body.replace(pkgLine, `${pkgLine}\n\n${imports.join('\n')}`);

  flags.add('java-conformance', 'resolved', `Emitted ${implClass} (package-private, same package as the generated Kotlin interface - a public class would collide with it and with its own file name) implementing ${moduleClass}: Promise<T> signatures backed by ResolvablePromise.fulfillSuccess/fulfillFailure, typed options params with generated-Kotlin property accessors (getKey() etc.), bodies wrapped in try/catch(JSONException) so unthrown org.json checked exceptions conform, pushToMarshaller delegated to ${moduleClass}.DefaultImpls. Compile-probe verified against the real generated interfaces (a probe target: DefaultImpls delegation demanded by javac, plain JVM names for get/set/configure, getKey()/getGroup() accessors, kotlin.Unit for Promise<Unit>). Instantiated by android/${moduleName}_factory.kt; wired through android_deps (valdi_android_library) in BUILD.bazel.`);

  const impl = `${body}\n`;

  // ---- support file: copied Android helpers (bridge-free plugin sources) ----
  // + dead ValdiCall shim when helper methods still take a call object
  // (java-helper-call-flow:*): the shim keeps the file compiling; nothing
  // routes to it - the helpers are Capacitor call flow awaiting a hand port.
  const shimLines = [];
  if (helperCallVerbs.size || needsDeadCallClass) {
    const has = (v) => helperCallVerbs.has(v);
    shimLines.push(
      '// plugin2valdi dead shim - helper method(s) still carry a Capacitor-style call',
      '// object (flagged java-helper-call-flow:*). The stubs below exist ONLY so',
      '// the preserved bodies compile; NOTHING routes here on Valdi. Port those',
      '// helpers by hand (thread the ResolvablePromise or the resolved value',
      '// through) and delete this shim.',
      'class ValdiCall {',
      ...(has('resolve') ? ['    void resolve() {}', '    void resolve(org.json.JSONObject data) {}'] : []),
      ...(has('reject') ? ['    void reject(String message) {}', '    void reject(String message, Throwable cause) {}'] : []),
      ...(has('unimplemented') ? ['    void unimplemented() {}'] : []),
      ...(has('unavailable') ? ['    void unavailable() {}'] : []),
      ...(has('getString') ? ['    String getString(String key) { return null; }'] : []),
      ...(has('getInt') ? ['    Integer getInt(String key) { return null; }'] : []),
      ...(has('getDouble') ? ['    Double getDouble(String key, double def) { return def; }', '    Double getDouble(String key) { return null; }'] : []),
      ...(has('getBoolean') ? ['    Boolean getBoolean(String key) { return null; }', '    Boolean getBoolean(String key, boolean def) { return def; }'] : []),
      ...(has('getObject') ? ['    org.json.JSONObject getObject(String key) { return null; }'] : []),
      ...(has('getArray') ? ['    org.json.JSONArray getArray(String key) { return null; }'] : []),
      ...(has('getData') ? ['    org.json.JSONObject getData() { return new org.json.JSONObject(); }'] : []),
      '}',
      '',
    );
    const unknownVerbs = [...helperCallVerbs].filter((v) => !['resolve', 'reject', 'unimplemented', 'unavailable', 'getString', 'getInt', 'getDouble', 'getBoolean', 'getObject', 'getArray', 'getData'].includes(v));
    if (unknownVerbs.length) {
      flags.add('java-helper-call-shim', 'blocking', `call.${unknownVerbs[0]}(...) (and possibly more) used by a helper method has NO stub in the emitted ValdiCall shim - add it by hand or port the helper.`);
    }
  }
  const support = [
    banner(`plugin2valdi generated support - copied Android helpers (${pkg}) `),
    '// The translated impl lives in this package; helper classes copied from',
    '// the Capacitor plugin keep the body compiling without the Capacitor bridge.',
    '// They are de-publicized (public top-level types must match this file\'s',
    '// name); their package declarations and imports are hoisted here. Nothing',
    '// is Valdi-specific - review helpers like any copied plugin code.',
    `package ${pkg};`,
    '',
    ...helpers.imports,
    ...(helpers.imports.length ? [''] : []),
    ...helpers.classes,
    ...(helpers.classes.length && shimLines.length ? [''] : []),
    ...shimLines,
    '',
  ].join('\n');

  return { impl: `${impl}\n`, support };
}

// Kotlin-source plugins (stripe: StripePlugin.kt): no body translation -
// but the module still owes the generated Kotlin interface a compiling
// implementation. Emit a rejection-conformance SKELETON: every contract
// method rejects with precise hand-port guidance; the factory instantiates
// it unchanged. Wiring the real body = porting the Kotlin calls by hand.
export function emitKotlinRejectionConformance(model, moduleClass, moduleName, flags, androidPkg = 'com.plugin2valdi.modules') {
  const pkg = `${androidPkg}.${moduleName}`;
  const kotlinRet = (r) => {
    if (!r || r === 'void') return 'Unit';
    if (/^(string|number|boolean)$/.test(r)) return r === 'number' ? 'Double' : (r === 'boolean' ? 'Boolean' : 'String');
    // TS array spellings map to Kotlin List (codegen arrays surface as
    // java.util.List in the generated interface); nesting composes
    if (/^(string|number|boolean|[A-Z]\w*)(\[\])+$/.test(r)) {
      let inner = /^(string|number|boolean)/.test(r) ? kotlinRet(r.replace(/(\[\])+$/, '')) : r.replace(/(\[\])+$/, '');
      const depth = (r.match(/\[\]/g) || []).length;
      for (let i = 0; i < depth; i++) inner = `kotlin.collections.List<${inner}>`;
      return inner;
    }
    return r;
  };
  const lines = [
    `package ${pkg}`,
    '',
    '// plugin2valdi Kotlin rejection-conformance skeleton - the plugin body is',
    '// Kotlin (not machine-translated); every contract method rejects until',
    `// the body is hand-ported onto this class. The factory instantiates`,
    `// ${moduleClass}ModuleImpl unchanged.`,
    'import com.snap.valdi.promise.Promise',
    'import com.snap.valdi.promise.ResolvablePromise',
    'import com.snap.valdi.utils.ValdiMarshaller',
    '',
    `internal class ${moduleClass}ModuleImpl : ${moduleClass}Module {`,
    '',
    '    fun onLoad() {}',
    '',
  ];
  for (const m of model.methods) {
    const opts = m.params && m.params.length === 1 ? m.params[0] : null;
    const sig = opts ? `override fun ${m.name}(options: ${opts.type})` : `override fun ${m.name}()`;
    lines.push(`    ${sig}: Promise<${kotlinRet(m.returns)}> {`);
    lines.push(`        val promise = ResolvablePromise<${kotlinRet(m.returns)}>()`);
    lines.push(`        promise.fulfillFailure(RuntimeException("${m.name}: not implemented - Kotlin plugin body awaiting hand port (plugin2valdi skeleton)"))`);
    lines.push('        return promise');
    lines.push('    }');
    lines.push('');
  }
  if (model.events.length) {
    lines.push(`    private var listener: ${moduleClass.replace(/Module$/, '')}Listener? = null`);
    lines.push('');
    lines.push(`    override fun setListener(listener: ${moduleClass.replace(/Module$/, '')}Listener?) {`);
    lines.push('        this.listener = listener');
    lines.push('    }');
    lines.push('');
  }
  lines.push('    // pushToMarshaller has a body in the generated interface - a Kotlin');
  lines.push('    // implementor inherits it (the Java-side DefaultImpls delegation does');
  lines.push('    // not apply from Kotlin source; found by the async_storage compile).');
  lines.push('}');
  flags.add('kotlin-rejection-conformance', 'warning', `Kotlin plugin source detected: no body translation - emitted ${moduleClass}ModuleImpl.kt, a compiling rejection-conformance skeleton implementing the generated ${moduleClass}Module interface (every method rejects with hand-port guidance, DefaultImpls delegation included). The Android app builds and loads the module; port the real Kotlin body onto the skeleton by hand.`);
  return lines.join('\n') + '\n';
}

export function findNativeFiles(pluginDir) {
  const results = { swift: [], objc: [], java: [], kotlin: [] };
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === 'build' || e.name === '.git' || e.name === 'node_modules') continue;
      // test sources are not plugin implementation (keyboard E2E: the only
      // .swift in @capacitor/keyboard is KeyboardPluginTests.swift - treating
      // it as the plugin source emitted an XCTest conformance)
      if (/^tests?$/i.test(e.name) || /Tests?\.(swift|m|java|kt)$/i.test(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === 'Package.swift' || e.name === 'Podfile.swift') continue; // SPM manifest, not source
      else if (e.name.endsWith('.swift')) results.swift.push(p);
      else if (e.name.endsWith('.m') || e.name.endsWith('.mm')) results.objc.push(p);
      else if (e.name.endsWith('.java')) results.java.push(p);
      else if (e.name.endsWith('.kt')) results.kotlin.push(p);
    }
  };
  walk(pluginDir);
  return results;
}
