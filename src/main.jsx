import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import '@/styles/heillo.css'

// In standalone PWA mode, continuously remove any Base44 editor badges injected by the platform
if (window.matchMedia('(display-mode: standalone)').matches) {
  const BADGE_SELECTORS = [
    '[data-base44-badge]',
    '[class*="base44-badge"]',
    '[id*="base44-badge"]',
    '[class*="edit-with-base44"]',
    '[id*="edit-with-base44"]',
    '[class*="b44-badge"]',
    '[class*="builder-badge"]',
    '[class*="preview-badge"]',
    '[class*="editor-badge"]',
    '[class*="floating-badge"]',
  ].join(',');

  const removeBadges = () => {
    document.querySelectorAll(BADGE_SELECTORS).forEach(el => el.remove());
  };

  // Run once immediately and then watch for dynamically injected elements
  removeBadges();
  const observer = new MutationObserver(removeBadges);
  observer.observe(document.body, { childList: true, subtree: true });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)