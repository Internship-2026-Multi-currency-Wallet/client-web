import { ESLintUtils } from '@typescript-eslint/utils';

const MESSAGE = 'Colours live only in src/brand/brand.ts; use the theme';

const NAMED = new Set(
  `aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood
  cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray
  darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen
  darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue
  firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew
  hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan
  lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray
  lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid
  mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream
  mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen
  paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown
  royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow
  springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen`.split(
    /\s+/,
  ),
);
const HEX = /(?:^|[\s:(,])#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b/i;
const FUNCTION = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;

// Theme paths ('common.white') stay one token; only space, comma, paren, colon, semicolon and slash split.
const isColour = (text) =>
  HEX.test(text) ||
  FUNCTION.test(text) ||
  text
    .toLowerCase()
    .split(/[\s,():;/]+/)
    .some((word) => NAMED.has(word));

const STYLE_TYPES = new Set([
  'SxProps',
  'SystemStyleObject',
  'SystemCssProperties',
  'CSSPseudoSelectorProps',
  'CSSSelectorObjectOrCssVariables',
  'CSSProperties',
  'CSSObject',
  'Interpolation',
  'ThemeOptions',
  'PaletteOptions',
  'PaletteColorOptions',
]);
const COLOUR_ATTRIBUTES = new Set(['fill', 'stroke', 'stop-color', 'stopColor', 'color']);
const STYLED_TAG = /^(?:styled|css|keyframes|createGlobalStyle)\b/;

export default {
  meta: { type: 'problem', schema: [], messages: { colour: MESSAGE } },
  create(context) {
    const services = ESLintUtils.getParserServices(context);
    const checker = services.program.getTypeChecker();
    const source = context.sourceCode;

    function isStyleType(type, seen = new Set()) {
      if (!type || seen.has(type)) return false;
      seen.add(type);
      if (STYLE_TYPES.has(type.aliasSymbol?.name) || STYLE_TYPES.has(type.getSymbol()?.name))
        return true;
      if (type.isUnionOrIntersection()) return type.types.some((t) => isStyleType(t, seen));
      if (checker.isArrayType(type) || checker.isTupleType(type)) {
        return checker.getTypeArguments(type).some((t) => isStyleType(t, seen));
      }
      return (
        type.getCallSignatures().some((s) => isStyleType(s.getReturnType(), seen)) ||
        [checker.getIndexTypeOfType(type, 0), checker.getIndexTypeOfType(type, 1)].some((t) =>
          isStyleType(t, seen),
        )
      );
    }

    const hasStyleType = (node) =>
      isStyleType(checker.getContextualType(services.esTreeNodeToTSNodeMap.get(node)));

    function inStyleCall(node) {
      for (let n = node.parent; n; n = n.parent) {
        if (n.type === 'TaggedTemplateExpression' && STYLED_TAG.test(source.getText(n.tag)))
          return true;
        if (
          n.type === 'CallExpression' &&
          n.callee.type === 'CallExpression' &&
          STYLED_TAG.test(source.getText(n.callee))
        ) {
          return true;
        }
      }
      return false;
    }

    const WRAPPERS = new Set([
      'LogicalExpression',
      'TSAsExpression',
      'TSNonNullExpression',
      'TSSatisfiesExpression',
    ]);

    function inColourAttribute(node) {
      let child = node.type === 'TemplateElement' ? node.parent : node;
      let parent = child.parent;
      while (
        WRAPPERS.has(parent.type) ||
        (parent.type === 'ConditionalExpression' && parent.test !== child)
      ) {
        child = parent;
        parent = parent.parent;
      }
      const attr = parent.type === 'JSXExpressionContainer' ? parent.parent : parent;
      return attr.type === 'JSXAttribute' && COLOUR_ATTRIBUTES.has(source.getText(attr.name));
    }

    function inStylePosition(node) {
      if (inColourAttribute(node) || (node.type !== 'TemplateElement' && hasStyleType(node)))
        return true;
      if (inStyleCall(node)) return true;
      for (
        let n = node.parent;
        n && !/Statement$|Declaration$|^Program$/.test(n.type);
        n = n.parent
      ) {
        if ((n.type === 'ObjectExpression' || n.type === 'ArrayExpression') && hasStyleType(n))
          return true;
      }
      return false;
    }

    function literalsExcludeWord(node, text) {
      const literals = [];
      const collect = (type) =>
        type.isUnion()
          ? type.types.forEach(collect)
          : type.isStringLiteral() && literals.push(type.value);
      const type = checker.getContextualType(services.esTreeNodeToTSNodeMap.get(node));
      if (type) collect(type);
      return literals.length > 0 && !literals.some((v) => v.toLowerCase() === text.toLowerCase());
    }

    const isComparison = ({ parent }) =>
      parent.type === 'TSLiteralType' ||
      (parent.type === 'BinaryExpression' && /^[!=]==?$/.test(parent.operator)) ||
      (parent.type === 'SwitchCase' && parent.test !== null);

    function check(node, text) {
      if (!isColour(text) || (node.type === 'Literal' && isComparison(node))) return;
      if (!inStylePosition(node)) return;
      const onlyNamed = !HEX.test(text) && !FUNCTION.test(text);
      if (
        onlyNamed &&
        node.type === 'Literal' &&
        NAMED.has(text.toLowerCase()) &&
        literalsExcludeWord(node, text)
      )
        return;
      context.report({ node, messageId: 'colour' });
    }

    return {
      Literal(node) {
        if (typeof node.value === 'string') check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.cooked ?? node.value.raw);
      },
    };
  },
};
