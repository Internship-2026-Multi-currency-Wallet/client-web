import { ESLint } from 'eslint';

const HEX = '#' + '4F46E5';
const SHORT_HEX = '#' + 'fff';
const NAMES = [
  ['Demo', 'Wallet'].join(' '),
  ['KVITKA', 'BANK'].join(' '),
  ['Wis\u0142a', 'Transfer'].join(' '),
  ['wisla', 'transfer'].join(' '),
];

describe('brand lint guard', { timeout: 30_000 }, () => {
  let eslint: ESLint;
  beforeAll(() => {
    eslint = new ESLint();
  });

  async function violations(code: string, filePath: string) {
    const [result] = await eslint.lintText(code, { filePath });
    return result.messages.filter((m) => m.ruleId === 'no-restricted-syntax');
  }

  const COMPONENT = 'src/features/x/Comp.tsx';

  describe('hex colours', () => {
    const cases: Record<string, string> = {
      'string literal': `const a = '${HEX}';`,
      'whole 8-digit hex': `const a = '${HEX}FF';`,
      'short hex in a style key': `const a = { background: '${SHORT_HEX}' };`,
      'quoted style key': `const a = { 'border-color': '${SHORT_HEX}' };`,
      'CSS text': `const a = 'color: ${SHORT_HEX}';`,
      'CSS shadow': `const a = 'box-shadow: 0 0 4px ${SHORT_HEX}';`,
      'CSS border shorthand': `const a = '1px solid ${SHORT_HEX}';`,
      gradient: `const a = 'linear-gradient(to right, ${HEX}, ${SHORT_HEX})';`,
      'template literal': `const a = \`color: ${'$'}{b} ${HEX}\`;`,
      'whole short hex': `const a = '${SHORT_HEX}';`,
      'whole 4-digit hex with spaces': `const a = ' ${SHORT_HEX}f ';`,
      'short hex in template element': `const a = \`${SHORT_HEX}\`;`,
      'short hex in JSX text': `export const A = () => <p>${SHORT_HEX}</p>;`,
      'JSX text': `export const A = () => <p>${HEX}</p>;`,
      'JSX attribute': `export const A = () => <b color="${SHORT_HEX}" />;`,
      'sx object value': `export const A = () => <b sx={{ color: '${HEX}' }} />;`,
    };
    it.each(Object.entries(cases))('flags hex in %s', async (_name, code) => {
      expect(await violations(code, COMPONENT)).not.toHaveLength(0);
    });
  });

  it.each([
    ['style key', `const a = { background: '${SHORT_HEX}' };`],
    ['JSX attribute', `export const A = () => <b color="${SHORT_HEX}" />;`],
  ])('reports a short hex in a %s exactly once', async (_name, code) => {
    expect(await violations(code, COMPONENT)).toHaveLength(1);
  });

  describe('product names', () => {
    it.each(NAMES)('flags "%s" in string, template and JSX text', async (name) => {
      for (const code of [
        `const a = '${name}';`,
        `const a = \`hi ${name}\`;`,
        `export const A = () => <p>${name}</p>;`,
      ]) {
        expect(await violations(code, COMPONENT), code).not.toHaveLength(0);
      }
    });
  });

  it('does not flag the same code inside src/brand', async () => {
    const code = `export const a = '${HEX}'; export const b = '${NAMES[0]}';`;
    expect(await violations(code, 'src/brand/brand.ts')).toHaveLength(0);
  });

  it('does not flag harmless strings', async () => {
    const code = `const a = ['kvitka', 'wisla-uat', '#section', 'Wallet', 1, true, null]; const b = brand.siteName;`;
    expect(await violations(code, COMPONENT)).toHaveLength(0);
  });

  it('does not flag hashtags and ids that look like short hex', async () => {
    const code = `const a = ['Hi #add', 'Order #1234', 'Hi #bad, #cafe!', 'Note: order #1234']; export const B = () => <p>Loving it #feed</p>;`;
    expect(await violations(code, COMPONENT)).toHaveLength(0);
  });

  it('lets an eslint-disable comment keep a short-hex id', async () => {
    const id = '#' + 'add';
    const rule = 'no-restricted-syntax';
    const code = `// eslint-disable-next-line ${rule} -- real id\nconst a = '${id}';`;
    expect(await violations(code, COMPONENT)).toHaveLength(0);
  });
});
