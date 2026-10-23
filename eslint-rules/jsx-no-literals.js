/**
 * local/jsx-no-literals (CON-0004 R-05): Sichtbare Texte gehören nach src/app/texts.ts.
 * Meldet JSX-Text, String-Ausdrücke als Kinder und String-Werte in Props – außer in Props,
 * die keinen sichtbaren Text tragen (className, type, role, id, htmlFor, name, accept,
 * inputMode, autoComplete, aria-level, data-*). react/jsx-no-literals kann diese Props nicht
 * einzeln ausnehmen.
 */

const ALLOWED_PROPS = new Set([
  'className',
  'type',
  'role',
  'id',
  'htmlFor',
  'name',
  'accept',
  'inputMode',
  'autoComplete',
  'aria-level',
]);

function isStringLiteral(node) {
  return (
    (node.type === 'Literal' && typeof node.value === 'string') ||
    (node.type === 'TemplateLiteral' && node.expressions.length === 0)
  );
}

function attributeName(node) {
  return node.name.type === 'JSXNamespacedName'
    ? `${node.name.namespace.name}:${node.name.name.name}`
    : node.name.name;
}

function isAllowedProp(name) {
  return ALLOWED_PROPS.has(name) || name.startsWith('data-');
}

export default {
  meta: {
    type: 'problem',
    docs: { description: 'Verbietet Textliterale in JSX; Texte kommen aus src/app/texts.ts' },
    schema: [],
    messages: {
      text: 'Textliteral in JSX: {{text}} – Text nach src/app/texts.ts verschieben.',
      prop: 'Textliteral in Prop "{{name}}" – Text nach src/app/texts.ts verschieben.',
    },
  },
  create(context) {
    return {
      JSXText(node) {
        const text = node.value.trim();
        if (text !== '') {
          context.report({ node, messageId: 'text', data: { text: JSON.stringify(text) } });
        }
      },
      JSXExpressionContainer(node) {
        if (node.parent.type === 'JSXAttribute' || !isStringLiteral(node.expression)) return;
        context.report({
          node,
          messageId: 'text',
          data: { text: context.sourceCode.getText(node) },
        });
      },
      JSXAttribute(node) {
        const name = attributeName(node);
        if (isAllowedProp(name) || node.value === null) return;
        const value =
          node.value.type === 'JSXExpressionContainer' ? node.value.expression : node.value;
        if (isStringLiteral(value)) {
          context.report({ node, messageId: 'prop', data: { name } });
        }
      },
    };
  },
};
