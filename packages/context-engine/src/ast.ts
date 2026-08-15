/**
 * TypeScript/TSX AST extraction (Phase 6, ADR-0004).
 *
 * Uses the TypeScript compiler API (already a platform dependency) to parse a
 * single source file into the structural facts the platform reasons about:
 * imports, exports, and top-level symbols (functions, React components, hooks,
 * classes, types, variables) with their signatures and locations.
 *
 * We deliberately extract *signatures*, not bodies — the Context Engine sends
 * bodies lazily and only when changed (token efficiency). Parsing is per-file
 * and content-addressed so results are cacheable (AST cache tier).
 */

import ts from 'typescript';
import type { SymbolInfo } from '@ai-review/core';

/** The structural facts extracted from one source file. */
export interface ExtractedFile {
  readonly imports: string[];
  readonly exports: string[];
  readonly symbols: SymbolInfo[];
}

/** A React component: PascalCase function/const returning JSX. A hook: `use*`. */
function classifyName(name: string, returnsJsx: boolean): SymbolInfo['kind'] {
  if (/^use[A-Z0-9]/.test(name)) return 'hook';
  if (returnsJsx || /^[A-Z]/.test(name)) return 'component';
  return 'function';
}

/** Heuristic: does this function body contain JSX? */
function bodyReturnsJsx(node: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/**
 * Parses one file's text. `changedLines` marks which new-file line numbers were
 * touched by the diff so each symbol can be flagged `changed` — the signal the
 * engine uses to send only what matters.
 */
export function extractFile(
  path: string,
  text: string,
  changedLines: ReadonlySet<number> = new Set(),
): ExtractedFile {
  const kind =
    path.endsWith('.tsx') || path.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);

  const imports: string[] = [];
  const exports: string[] = [];
  const symbols: SymbolInfo[] = [];

  const lineOf = (pos: number): number => sf.getLineAndCharacterOfPosition(pos).line + 1;

  const symbolSpansChange = (node: ts.Node): boolean => {
    const start = lineOf(node.getStart(sf));
    const end = lineOf(node.getEnd());
    for (let l = start; l <= end; l++) if (changedLines.has(l)) return true;
    return false;
  };

  const pushSymbol = (
    name: string,
    k: SymbolInfo['kind'],
    node: ts.Node,
    signature: string,
  ): void => {
    symbols.push({
      name,
      kind: k,
      location: { file: path, line: lineOf(node.getStart(sf)) },
      signature: signature.slice(0, 200),
      changed: changedLines.size === 0 ? false : symbolSpansChange(node),
    });
  };

  const isExported = (node: ts.Node): boolean =>
    ts.canHaveModifiers(node)
      ? (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      : false;

  const visit = (node: ts.Node): void => {
    // Imports.
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.push(node.moduleSpecifier.text);
    }

    // export { … } / export * from '…'
    if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        imports.push(node.moduleSpecifier.text);
      }
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const el of node.exportClause.elements) exports.push(el.name.text);
      }
    }

    // Function declarations.
    if (ts.isFunctionDeclaration(node) && node.name) {
      const name = node.name.text;
      const returnsJsx = node.body ? bodyReturnsJsx(node.body) : false;
      pushSymbol(name, classifyName(name, returnsJsx), node, signatureOf(node, sf));
      if (isExported(node)) exports.push(name);
    }

    // Class declarations.
    if (ts.isClassDeclaration(node) && node.name) {
      pushSymbol(node.name.text, 'class', node, `class ${node.name.text}`);
      if (isExported(node)) exports.push(node.name.text);
    }

    // Type aliases + interfaces.
    if (ts.isTypeAliasDeclaration(node)) {
      pushSymbol(node.name.text, 'type', node, `type ${node.name.text}`);
      if (isExported(node)) exports.push(node.name.text);
    }
    if (ts.isInterfaceDeclaration(node)) {
      pushSymbol(node.name.text, 'type', node, `interface ${node.name.text}`);
      if (isExported(node)) exports.push(node.name.text);
    }

    // Top-level variable declarations (const Foo = …), incl. arrow components/hooks.
    if (ts.isVariableStatement(node)) {
      const exported = isExported(node);
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue;
        const name = decl.name.text;
        const init = decl.initializer;
        const returnsJsx =
          init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))
            ? bodyReturnsJsx(init)
            : false;
        const k: SymbolInfo['kind'] =
          init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))
            ? classifyName(name, returnsJsx)
            : 'variable';
        pushSymbol(name, k, decl, `${name}`);
        if (exported) exports.push(name);
      }
    }

    if (ts.isExportAssignment(node)) exports.push('default');

    ts.forEachChild(node, visit);
  };

  visit(sf);
  return { imports: dedupe(imports), exports: dedupe(exports), symbols };
}

function signatureOf(node: ts.FunctionDeclaration, sf: ts.SourceFile): string {
  const name = node.name?.text ?? 'anonymous';
  const params = node.parameters.map((p) => p.getText(sf)).join(', ');
  return `function ${name}(${params})`;
}

function dedupe(items: readonly string[]): string[] {
  return [...new Set(items)];
}
