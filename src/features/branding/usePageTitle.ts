import { useEffect } from 'react';
import { brand } from '../../brand/brand';

/** Sets the browser tab title to `<title> · <site name>`. Call it before any early return. */
export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} · ${brand.siteName}`;
  }, [title]);
}
