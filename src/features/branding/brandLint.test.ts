import { ESLint } from 'eslint';

const HEX = '#' + '4F46E5';
const SHORT_HEX = '#' + 'fff';
const NAMES = [
  ['Demo', 'Wallet'].join(' '),
  ['KVITKA', 'BANK'].join(' '),
  ['Wis\u0142a', 'Transfer'].join(' '),
  ['wisla', 'transfer'].join(' '),
];

describe('brand lint guard', () => {
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
      'short hex': `const a = '${SHORT_HEX}';`,
      'template literal': `const a = \`x ${'$'}{b} ${HEX}\`;`,
      'JSX text': `export const A = () => <p>${HEX}</p>;`,
      'JSX attribute': `export const A = () => <b color="${SHORT_HEX}" />;`,
      'sx object value': `export const A = () => <b sx={{ color: '${HEX}' }} />;`,
    };
    it.each(Object.entries(cases))('flags hex in %s', async (_name, code) => {
      expect(await violations(code, COMPONENT)).not.toHaveLength(0);
    });
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
});
