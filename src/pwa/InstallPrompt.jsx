import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Download, X } from "lucide-react";

/**
 * PWA Install Prompt banner.
 * - Listens for the browser's `beforeinstallprompt` event (Android Chrome / desktop Chrome)
 * - Shows a dismissible banner at the bottom of the screen
 * - iOS/iPadOS users see a manual install hint instead
 */
export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showBanner, setShowBanner] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Already installed (running in standalone)
    if (window.matchMedia("(display-mode: standalone)").matches) return;

    // Already dismissed this session
    if (sessionStorage.getItem("pwa-install-dismissed")) return;

    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    setIsIOS(ios);

    if (ios) {
      // Show iOS hint after a short delay
      setTimeout(() => setShowBanner(true), 3000);
      return;
    }

    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowBanner(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") setShowBanner(false);
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    setShowBanner(false);
    sessionStorage.setItem("pwa-install-dismissed", "1");
  };

  if (!showBanner || dismissed) return null;

  return (
    <div
      dir="rtl"
      className="fixed bottom-4 right-4 left-4 z-50 bg-card border border-border rounded-2xl shadow-xl p-4 flex items-start gap-3 max-w-sm mx-auto"
    >
      {/* Icon */}
      <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center shrink-0 text-xl font-black">
        Q
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm">QuickStock ERP</p>
        {isIOS ? (
          <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
            להתקנה: לחץ על{" "}
            <span className="font-bold">שתף ⎦</span> ואז{" "}
            <span className="font-bold">הוסף למסך הבית</span>
          </p>
        ) : (
          <p className="text-xs text-muted-foreground mt-0.5">
            התקן את האפליקציה על המכשיר שלך
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 shrink-0">
        {!isIOS && (
          <Button size="sm" className="h-9 px-3 text-xs" onClick={handleInstall}>
            <Download className="w-3.5 h-3.5 ml-1" /> התקן
          </Button>
        )}
        <button
          onClick={handleDismiss}
          className="p-1.5 rounded-lg hover:bg-muted transition-colors"
          aria-label="סגור"
        >
          <X className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>
    </div>
  );
}