/**
 * Nika Arts Studio — Page Loader
 * Injects and controls the full-screen loading animation.
 * Shows on every page load, disappears smoothly once content is ready.
 */

(function () {
  'use strict';

  // ── 1. Build the loader HTML and inject it immediately ──────────────────
  const LOADER_HTML = `
    <div id="nika-loader" role="status" aria-label="Loading Nika Arts Studio">
      <div class="loader-scene">
        <div class="loader-particles">
          <span class="loader-particle"></span>
          <span class="loader-particle"></span>
          <span class="loader-particle"></span>
          <span class="loader-particle"></span>
          <span class="loader-particle"></span>
          <span class="loader-particle"></span>
          <span class="loader-particle"></span>
          <span class="loader-particle"></span>
          <span class="loader-particle"></span>
          <span class="loader-particle"></span>
        </div>
        <div class="loader-glow"></div>
        <div class="loader-orbit"></div>
        <div class="loader-logo-wrap">
          <img
            id="loader-logo-img"
            src="/images/hero.jpg"
            alt="Nika Arts Studio"
          />
        </div>
      </div>
      <div class="loader-text">
        <span class="loader-brand">Nika Arts Studio</span>
        <span class="loader-tagline">Trust &amp; Creativity</span>
        <div class="loader-bar"></div>
      </div>
    </div>
  `;

  // Inject before <body> content renders
  document.addEventListener('DOMContentLoaded', () => {
    document.body.insertAdjacentHTML('afterbegin', LOADER_HTML);
  });

  // Also try to inject synchronously if body is already available
  if (document.body) {
    document.body.insertAdjacentHTML('afterbegin', LOADER_HTML);
  }

  // ── 2. Hide the loader smoothly ──────────────────────────────────────────
  let dismissed = false;
  function dismissLoader() {
    if (dismissed) return;
    dismissed = true;
    const loader = document.getElementById('nika-loader');
    if (!loader) return;
    // Small extra delay so the logo swap is not jarring
    setTimeout(() => {
      loader.classList.add('loader-hidden');
      // Remove from DOM after transition ends (keeps DOM clean)
      loader.addEventListener('transitionend', () => loader.remove(), { once: true });
    }, 300);
  }

  // ── 3. Swap the loader logo when the real logo URL is available ──────────
  // Hook into applySiteAssets so the loader img shows the branded logo
  const _originalApply = window.applySiteAssets;
  window.applySiteAssets = function (content) {
    const logoUrl = content?.assets?.logoImage;
    if (logoUrl) {
      const loaderImg = document.getElementById('loader-logo-img');
      if (loaderImg) {
        loaderImg.src = logoUrl;
      }
    }
    if (typeof _originalApply === 'function') {
      _originalApply.call(this, content);
    }
  };

  // ── 4. Trigger dismiss once the page + API content are done ──────────────
  window.addEventListener('load', () => {
    // Give API-driven pages a short grace window to populate content
    setTimeout(dismissLoader, 600);
  });

  // Safety net: always dismiss after 5 seconds (handles slow APIs / errors)
  setTimeout(dismissLoader, 5000);
})();
