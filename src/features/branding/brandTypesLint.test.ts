import { ESLint } from 'eslint';

const HEX = '#' + 'fff';
const ADD = '#' + 'add';
const RGB = 'rgb' + '(0,0,0)';
const HSL = 'hsl' + '(10, 50%, 50%)';
const OKLCH = 'oklch' + '(0.5 0.1 200)';
const RED = 'red';
const TOMATO = 'tomato';
const IMPORTS = `import Box from '@mui/material/Box';
import { styled } from '@mui/material/styles';\nimport type { SxProps } from '@mui/material/styles';\n`;

describe('type-aware colour lint', { timeout: 60_000 }, () => {
  let eslint: ESLint;
  beforeAll(() => {
    eslint = new ESLint({ overrideConfigFile: 'eslint.types.config.js' });
  });

  async function colours(body: string, filePath = 'src/features/branding/Logo.tsx') {
    const [result] = await eslint.lintText(IMPORTS + body, { filePath });
    expect(result.messages.filter((m) => m.fatal)).toEqual([]);
    return result.messages.filter((m) => m.ruleId === 'local/no-style-colour');
  }
  const sx = (value: string) => `export const A = () => <Box sx={${value}} />;`;
  const typedSx = (value: string) => `const s: SxProps = ${value}; export default s;`;

  describe('flags colours in style positions', () => {
    const cases: Record<string, string> = {
      'sx hex': typedSx(`{ color: '${HEX}' }`),
      'sx key that only the typing allows': typedSx(`{ accent: '${RGB}' }`),
      'sx nested selector with unknown key': typedSx(`{ '&:hover': { accent: '${RGB}' } }`),
      'sx nested selector': typedSx(`{ '&:hover': { bgcolor: '${HEX}' } }`),
      'sx hsl': typedSx(`{ color: '${HSL}' }`),
      'sx oklch': typedSx(`{ color: '${OKLCH}' }`),
      'sx named colour': typedSx(`{ bgcolor: '${TOMATO}' }`),
      'sx responsive': typedSx(`{ color: { xs: '${HEX}', md: '${RED}' } }`),
      'sx function': typedSx(`(theme) => ({ color: '${HEX}', m: theme.spacing(1) })`),
      'sx array': `declare const cond: boolean; const s: SxProps = [{ color: '${HEX}' }, cond && { color: '${RED}' }]; export default s;`,
      'sx border shorthand in template': typedSx('{ border: `1px solid ' + HEX + '` }'),
      'JSX sx prop': sx(`{ color: '${HEX}' }`),
      'JSX sx function': sx(`(theme) => ({ color: '${HEX}', m: theme.spacing(1) })`),
      'JSX sx array': sx(`[{ color: '${HEX}' }, false && { color: '${RED}' }]`),
      'styled object': `export const S = styled('div')({ color: '${HEX}' });`,
      'styled template': "export const S = styled('div')`color: " + HEX + ';`;',
      'styled template with border':
        "export const S = styled('div')`border: 1px solid " + HEX + ';`;',
      'SVG fill': `export const A = () => <svg><path fill="${HEX}" /></svg>;`,
      'SVG stop-color': `export const A = () => <svg><stop stop-color="${RED}" /></svg>;`,
      CSSProperties: `import type { CSSProperties } from 'react'; export const s: CSSProperties = { outlineColor: '${HEX}' };`,
    };
    it.each(Object.entries(cases))('%s', async (_name, code) => {
      expect(await colours(code)).not.toHaveLength(0);
    });
  });

  describe('leaves other strings alone', () => {
    const cases: Record<string, string> = {
      'order id': `export const a = 'Order #1234';`,
      'hashtag in a sentence': `export const a = 'Loving it ${ADD}';`,
      'short hex in a sentence': `export const a = 'Hi ${ADD}, ok';`,
      'plain object field': `export const a = { tag: '${ADD}' };`,
      'plain string variable': `export const note: string = '${RED}';`,
      'theme value': `declare const theme: { palette: { primary: { main: string } } }; export const a = theme.palette.primary.main;`,
      'theme path in sx': typedSx(`{ color: 'primary.main' }`),
      'theme white in sx': typedSx(`{ color: 'common.white' }`),
      'inherit in sx': typedSx(`{ color: 'inherit' }`),
      'transparent in sx': typedSx(`{ bgcolor: 'transparent' }`),
      'currentColor in styled': "export const S = styled('div')`color: currentColor;`;",
      'non-colour in sx': typedSx(`{ display: 'flex', p: 2 }`),
    };
    it.each(Object.entries(cases))('%s', async (_name, code) => {
      expect(await colours(code)).toHaveLength(0);
    });
  });

  it('does not flag a style-looking colour in src/brand', async () => {
    expect(await colours(typedSx(`{ color: '${HEX}' }`), 'src/brand/brand.ts')).toHaveLength(0);
  });

  it('lets eslint-disable-next-line keep a flagged id', async () => {
    const rule = 'local/no-style-colour';
    const code = `// eslint-disable-next-line ${rule} -- real id\nconst s: SxProps = { color: '${HEX}' }; export default s;`;
    expect(await colours(code)).toHaveLength(0);
  });
});
