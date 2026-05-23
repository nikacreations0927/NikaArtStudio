// public/js/site-assets.js

function applySiteAssets(content) {
  const assets = content?.assets || {};

  if (assets.logoImage) {
    document.querySelectorAll('.logo').forEach(logo => {
      logo.innerHTML = `
        <img src="${assets.logoImage}" alt="Nika Arts Studio" class="logo-image">
        <span class="sr-only">Nika Arts Studio</span>
      `;
    });
  }

  document.querySelectorAll('[data-site-asset]').forEach(element => {
    const key = element.dataset.siteAsset;
    const url = assets[key];
    if (!url) return;

    if (element.tagName === 'META') {
      element.setAttribute('content', url);
    } else {
      element.setAttribute('src', url);
    }
  });
}

async function loadSiteAssets() {
  try {
    const response = await fetch('/api/content');
    const data = await response.json();
    if (data.success && data.content) {
      applySiteAssets(data.content);
    }
  } catch (err) {
    console.warn('Could not load site assets.', err);
  }
}

window.applySiteAssets = applySiteAssets;
document.addEventListener('DOMContentLoaded', loadSiteAssets);
