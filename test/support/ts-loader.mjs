// ESM loader hook: rewrite .js imports to .ts when the .js file doesn't exist
// but a .ts file does. This bridges the gap between source-level .js extension
// imports and the actual .ts files on disk.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const renderPiTuiShim = `
function wrapText(text, width) {
  if (!width || width <= 0) return [text];
  const lines = [];
  for (const rawLine of String(text).split("\\n")) {
    if (rawLine.length === 0) {
      lines.push("");
      continue;
    }
    for (let i = 0; i < rawLine.length; i += width) {
      lines.push(rawLine.slice(i, i + width));
    }
  }
  return lines;
}

export function visibleWidth(text) {
  return String(text).length;
}

export class Text {
  constructor(text) {
    this.text = text;
  }

  render(width) {
    return wrapText(this.text, width);
  }
}

export class Spacer {
  constructor(lines = 1) {
    this.lines = lines;
  }

  render() {
    return Array.from({ length: this.lines }, () => "");
  }
}

export class Markdown {
  constructor(text) {
    this.text = text;
  }

  render(width) {
    return wrapText(this.text, width);
  }
}

export class Container {
  constructor() {
    this.children = [];
  }

  addChild(child) {
    this.children.push(child);
  }

  render(width) {
    return this.children.flatMap((child) => child.render(width));
  }
}

export class Box {
  constructor() {
    this.children = [];
  }
  addChild(child) {
    this.children.push(child);
  }
  render(width) {
    return this.children.flatMap((child) => child.render(width));
  }
}

export const Key = {
  ctrl: (k) => k,
  alt: (k) => k,
  shift: (k) => k,
  ctrlAlt: (k) => k,
  ctrlShift: (k) => k,
};

export function isKeyRelease() { return false; }
export function matchesKey() { return false; }
export function fuzzyFilter(items, query, text = (item) => String(item)) {
  const needle = String(query).toLowerCase();
  return items.filter((item) => text(item).toLowerCase().includes(needle));
}

export class Input {
  constructor() { this.focused = false; this.value = ""; }
  getText() { return this.value; }
  setText(value) { this.value = String(value); }
  handleInput() {}
}

export function truncateToWidth(text, width) {
  return String(text).slice(0, width);
}

export function wrapTextWithAnsi(text, width) {
  return wrapText(text, width);
}
`;

function asDataModule(source) {
  return `data:text/javascript,${encodeURIComponent(source)}`;
}

const agentCoreShim = `
export class AgentToolResult {}
export class Agent {}
`;

const aiShim = `
export class StringEnum {}
export function streamSimple() { return { async *[Symbol.asyncIterator]() {} }; }
export function completeSimple() { return Promise.resolve({}); }
`;

export function resolve(specifier, context, nextResolve) {
  if (specifier === "@earendil-works/pi-tui") {
    return { url: asDataModule(renderPiTuiShim), shortCircuit: true };
  }

  if (specifier === "@earendil-works/pi-agent-core") {
    return { url: asDataModule(agentCoreShim), shortCircuit: true };
  }

  if (specifier.startsWith("@earendil-works/pi-ai")) {
    return { url: asDataModule(aiShim), shortCircuit: true };
  }

  if (specifier === "@earendil-works/pi-coding-agent") {
    const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const shimFile = path.join(rootDir, "test/fixtures/pi-coding-agent-shim/index.js");
    if (fs.existsSync(shimFile)) {
      return { url: new URL(`file://${process.platform === "win32" ? "/" : ""}${shimFile.replace(/\\/g, "/")}`).href, shortCircuit: true };
    }
  }

  if (!specifier.startsWith(".") || !specifier.endsWith(".js")) {
    return nextResolve(specifier, context);
  }

  const parentDir = context.parentURL
    ? path.dirname(fileURLToPath(context.parentURL))
    : process.cwd();
  const jsPath = path.resolve(parentDir, specifier);
  const tsPath = jsPath.replace(/\.js$/, ".ts");

  if (!fs.existsSync(jsPath) && fs.existsSync(tsPath)) {
    return nextResolve(specifier.replace(/\.js$/, ".ts"), context);
  }

  return nextResolve(specifier, context);
}
