import { useEffect } from 'react';

export function usePortalManifest() {
  useEffect(() => {
    const link = document.querySelector('link[rel="manifest"]');
    if (!link) return;
    const original = link.getAttribute('href');
    link.setAttribute('href', '/portal-manifest.json');
    return () => {
      link.setAttribute('href', original);
    };
  }, []);
}
