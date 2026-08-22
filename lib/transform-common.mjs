// Shared ritual-call rewriting primitives.
// Strategy: find a call site, walk parentheses to its true end, wrap or
// rewrite. Bodies are otherwise preserved verbatim - we rewrite ritual
// lines, not logic.

// Find every occurrence of `marker(` in `line` and return [{start, end, inner}]
// where start/end bracket the full call including parens.
export function findCalls(line, marker) {
  const calls = [];
  let idx = 0;
  while (true) {
    const at = line.indexOf(marker + '(', idx);
    if (at === -1) break;
    const open = at + marker.length;
    let depth = 0;
    let end = -1;
    for (let i = open; i < line.length; i++) {
      if (line[i] === '(') depth++;
      else if (line[i] === ')') {
        depth--;
        if (depth === 0) { end = i + 1; break; }
      }
    }
    if (end === -1) break;
    calls.push({ start: at, end, inner: line.slice(open + 1, end - 1) });
    idx = end;
  }
  return calls;
}

export function replaceCalls(line, marker, rewrite) {
  // Apply rewrites right-to-left so indices stay valid.
  const calls = findCalls(line, marker);
  let out = line;
  for (let i = calls.length - 1; i >= 0; i--) {
    const c = calls[i];
    const replacement = rewrite(c.inner);
    if (replacement === null) continue;
    out = out.slice(0, c.start) + replacement + out.slice(c.end);
  }
  return out;
}

// Multiline, string- and comment-aware variant. findCalls walks parens
// blindly, so an unbalanced paren inside a string literal or comment within
// a lambda body (`"(255, 255, 255)"`, `// (see docs`) corrupts the depth and
// the whole scan silently stops after the first clean call - observed on
// status-bar's five identical executeOnMainThread sites (1 of 5 found).
export function findCallsBalanced(text, marker) {
  const calls = [];
  let idx = 0;
  while (true) {
    const at = text.indexOf(marker + '(', idx);
    if (at === -1) break;
    const open = at + marker.length;
    let depth = 0;
    let end = -1;
    let inStr = null;
    for (let i = open; i < text.length; i++) {
      const c = text[i];
      if (inStr) {
        if (c === '\\') { i++; continue; }
        if (c === inStr) inStr = null;
        continue;
      }
      if (c === '"' || c === "'") { inStr = c; continue; }
      if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
      if (c === '/' && text[i + 1] === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i++; continue; }
      if (c === '(') depth++;
      else if (c === ')') {
        depth--;
        if (depth === 0) { end = i + 1; break; }
      }
    }
    if (end === -1) break;
    calls.push({ start: at, end, inner: text.slice(open + 1, end - 1) });
    idx = end;
  }
  return calls;
}

export function replaceCallsBalanced(text, marker, rewrite) {
  const calls = findCallsBalanced(text, marker);
  let out = text;
  for (let i = calls.length - 1; i >= 0; i--) {
    const c = calls[i];
    const replacement = rewrite(c.inner);
    if (replacement === null) continue;
    out = out.slice(0, c.start) + replacement + out.slice(c.end);
  }
  return out;
}

// Net brace delta of a line, ignoring braces inside string literals,
// interpolations, and comments. Blind counting breaks span trackers: one
// `{` inside a string in a method body leaves the depth positive after the
// method closes and everything after it gets treated as inside the span
// (observed: splash-screen's private helpers skipped by the surgery).
export function netBraces(line) {
  let delta = 0;
  let inStr = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === '/' && line[i + 1] === '/') break;
    if (c === '{') delta++;
    else if (c === '}') delta--;
  }
  return delta;
}

// Split "event: 'name', listener: ..." or "'name', expr" style args.
export function splitArgs(inner) {
  const args = [];
  let cur = '';
  let depth = 0;
  let inString = null;
  for (const c of inner) {
    if (inString) { cur += c; if (c === inString) inString = null; continue; }
    if (c === "'" || c === '"') { inString = c; cur += c; }
    else if (c === '(' || c === '{' || c === '[' || c === '<') { depth++; cur += c; }
    else if (c === ')' || c === '}' || c === ']' || c === '>') { depth--; cur += c; }
    else if (c === ',' && depth === 0) { args.push(cur.trim()); cur = ''; }
    else cur += c;
  }
  if (cur.trim()) args.push(cur.trim());
  return args;
}

export function banner(title) {
  const bar = '='.repeat(Math.max(0, 72 - title.length - 2));
  return `// ${title} ${bar}`;
}

// Net PAREN delta of a line, string/comment-aware (chain statement grouping:
// a dropped `x.something` prefix line leaves an orphaned `.sink(...)` tail
// unless the drop consumes until parens balance).
export function netParens(line) {
  let delta = 0;
  let inStr = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === '/' && line[i + 1] === '/') break;
    if (c === '(') delta++;
    else if (c === ')') delta--;
  }
  return delta;
}
