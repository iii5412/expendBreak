import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * A control that shows only an icon has no name for a screen reader unless it
 * carries `aria-label`, `aria-labelledby` or `title`. eslint-plugin-jsx-a11y
 * cannot see this because it assumes any custom component (an icon) may render
 * text, so this test inspects the JSX itself.
 */
const root = path.resolve(__dirname, '..');

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [full] : [];
  });
}

const NAME_ATTRIBUTES = new Set(['aria-label', 'aria-labelledby', 'title']);
const CONTROL_TAGS = new Set(['button', 'a']);

function hasNameAttribute(attributes: ts.JsxAttributes) {
  return attributes.properties.some(property => (
    ts.isJsxSpreadAttribute(property) // {...props} may carry a name
    || (ts.isJsxAttribute(property) && NAME_ATTRIBUTES.has(property.name.getText()))
  ));
}

/** True when nothing inside the element can contribute readable text: only icons / svg / empty. */
function isIconOnly(element: ts.JsxElement) {
  let sawIcon = false;
  const visit = (node: ts.Node): boolean => {
    if (ts.isJsxText(node)) return node.getText().trim() === '';
    if (ts.isJsxExpression(node)) return !node.expression; // {value} may print text
    if (ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText();
      if (/^[A-Z]/.test(tag) || tag === 'svg') {
        sawIcon = true;
        return true;
      }
      return false; // another element (img, input...) is judged separately
    }
    if (ts.isJsxElement(node)) {
      const tag = node.openingElement.tagName.getText();
      if (tag === 'span' && node.openingElement.attributes.properties.some(property => ts.isJsxAttribute(property) && property.name.getText() === 'className' && /sr-only/.test(property.getText()))) {
        return false; // visually hidden text names the control
      }
      return node.children.every(visit) && (/^[a-z]+$/.test(tag) && ['span', 'div', 'svg'].includes(tag));
    }
    return false;
  };
  return element.children.length > 0 && element.children.every(visit) && sawIcon;
}

function findUnnamedIconControls(file: string) {
  const text = readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const problems: string[] = [];
  const walk = (node: ts.Node) => {
    if (ts.isJsxElement(node) && CONTROL_TAGS.has(node.openingElement.tagName.getText())) {
      if (!hasNameAttribute(node.openingElement.attributes) && isIconOnly(node)) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart());
        problems.push(`${path.relative(root, file)}:${line + 1}`);
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(source);
  return problems;
}

describe('accessible names', () => {
  it('gives every icon-only button and link an accessible name', () => {
    const problems = tsxFiles(root).flatMap(findUnnamedIconControls);
    expect(problems).toEqual([]);
  });

  it('recognises an unnamed icon button (the check itself works)', () => {
    const source = ts.createSourceFile('x.tsx', '<button onClick={f}><X className="a" /></button>', ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const element = (source.statements[0] as ts.ExpressionStatement).expression as ts.JsxElement;
    expect(isIconOnly(element)).toBe(true);
    expect(hasNameAttribute(element.openingElement.attributes)).toBe(false);
  });
});
