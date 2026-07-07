/**
 * Nika Arts Studio — Page Loader
 * Injects and controls the full-screen loading animation.
 * Shows on every page load, disappears smoothly once content is ready.
 */

(function () {
  'use strict';

  // ── 1. Build the loader HTML ─────────────────────────────────────────────
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

  // ── 2. Inject exactly once ───────────────────────────────────────────────
  function injectLoader() {
    // Guard: never inject twice
    if (document.getElementById('nika-loader')) return;
    document.body.insertAdjacentHTML('afterbegin', LOADER_HTML);
  }

  if (document.body) {
    // Script is in <body> — body exists, inject now
    injectLoader();
  } else {
    // Script is in <head> — wait for body
    document.addEventListener('DOMContentLoaded', injectLoader);
  }

  // ── 3. Dismiss the loader smoothly ──────────────────────────────────────
  let dismissed = false;
  function dismissLoader() {
    if (dismissed) return;
    dismissed = true;
    // Remove ALL instances defensively (handles any edge-case duplicates)
    document.querySelectorAll('#nika-loader').forEach(function (loader) {
      loader.classList.add('loader-hidden');
      loader.addEventListener('transitionend', function () { loader.remove(); }, { once: true });
      // Fallback removal if transitionend never fires (e.g. CSS not loaded)
      setTimeout(function () { if (loader.parentNode) loader.remove(); }, 1000);
    });
  }

  // ── 4. Swap the loader logo when the real logo URL is available ──────────
  const _originalApply = window.applySiteAssets;
  window.applySiteAssets = function (content) {
    const logoUrl = content && content.assets && content.assets.logoImage;
    if (logoUrl) {
      const loaderImg = document.getElementById('loader-logo-img');
      if (loaderImg) loaderImg.src = logoUrl;
    }
    if (typeof _originalApply === 'function') {
      _originalApply.call(this, content);
    }
  };

  // ── 5. Trigger dismiss once the page + API content are loaded ────────────
  window.addEventListener('load', function () {
    // Short grace window for API-driven pages to finish populating content
    setTimeout(dismissLoader, 600);
  });

  // Safety net: always dismiss after 5 s even on slow APIs / errors
  setTimeout(dismissLoader, 5000);

})();
