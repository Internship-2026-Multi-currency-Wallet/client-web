import { useEffect } from 'react';
import { brand } from '../../brand/brand';

export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} · ${brand.siteName}`;
  }, [title]);
}
