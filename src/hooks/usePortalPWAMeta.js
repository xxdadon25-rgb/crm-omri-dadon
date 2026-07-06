import { useEffect } from 'react';

export function usePortalPWAMeta() {
  useEffect(() => {
    const manifest = document.querySelector('link[rel="manifest"]');
    const appleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    const appleIcon = document.querySelector('link[rel="apple-touch-icon"]');

    const origManifest = manifest?.getAttribute('href');
    const origTitle = appleTitle?.getAttribute('content');
    const origIcon = appleIcon?.getAttribute('href');

    manifest?.setAttribute('href', '/portal-manifest.json');
    appleTitle?.setAttribute('content', 'פורטל לקוחות');
    appleIcon?.setAttribute('href', '/icons/portal-icon.svg');

    return () => {
      if (origManifest != null) manifest?.setAttribute('href', origManifest);
      if (origTitle != null) appleTitle?.setAttribute('content', origTitle);
      if (origIcon != null) appleIcon?.setAttribute('href', origIcon);
    };
  }, []);
}
