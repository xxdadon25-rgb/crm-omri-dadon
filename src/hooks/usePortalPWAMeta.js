import { useEffect } from 'react';

function getOrCreate(selector, tag, attrs = {}) {
  let el = document.querySelector(selector);
  let created = false;
  if (!el) {
    el = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    document.head.appendChild(el);
    created = true;
  }
  return { el, created };
}

export function usePortalPWAMeta() {
  useEffect(() => {
    const portalUrl = `${window.location.origin}/portal/login`;

    // ── existing tags (swap value, restore on unmount) ────────────────────
    const manifest  = document.querySelector('link[rel="manifest"]');
    const appleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    const appleIcon  = document.querySelector('link[rel="apple-touch-icon"]');

    const origManifest  = manifest?.getAttribute('href');
    const origTitle     = appleTitle?.getAttribute('content');
    const origIcon      = appleIcon?.getAttribute('href');

    manifest?.setAttribute('href', '/portal-manifest.json');
    appleTitle?.setAttribute('content', 'פורטל לקוחות');
    appleIcon?.setAttribute('href', '/icons/portal-icon.svg');

    // ── canonical + og:url (create if absent, remove on unmount if created) ─
    const { el: canonical, created: canonicalCreated } = getOrCreate(
      'link[rel="canonical"]', 'link', { rel: 'canonical' }
    );
    const origCanonical = canonicalCreated ? null : canonical.getAttribute('href');
    canonical.setAttribute('href', portalUrl);

    const { el: ogUrl, created: ogUrlCreated } = getOrCreate(
      'meta[property="og:url"]', 'meta', { property: 'og:url' }
    );
    const origOgUrl = ogUrlCreated ? null : ogUrl.getAttribute('content');
    ogUrl.setAttribute('content', portalUrl);

    return () => {
      if (origManifest  != null) manifest?.setAttribute('href', origManifest);
      if (origTitle     != null) appleTitle?.setAttribute('content', origTitle);
      if (origIcon      != null) appleIcon?.setAttribute('href', origIcon);

      if (canonicalCreated) canonical.remove();
      else if (origCanonical != null) canonical.setAttribute('href', origCanonical);

      if (ogUrlCreated) ogUrl.remove();
      else if (origOgUrl != null) ogUrl.setAttribute('content', origOgUrl);
    };
  }, []);
}
