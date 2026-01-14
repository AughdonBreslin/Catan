// Renders per-player resource counts into the Colonist UI (content-script context)
(() => {
  if (window.__catanTrackerUiRendererLoaded) return;
  window.__catanTrackerUiRendererLoaded = true;

  const RESOURCE_ICON_SRC = {
    lumber: 'https://cdn.colonist.io/dist/assets/card_lumber.cf22f8083cf89c2a29e7.svg',
    brick: 'https://cdn.colonist.io/dist/assets/card_brick.5950ea07a7ea01bc54a5.svg',
    wool: 'https://cdn.colonist.io/dist/assets/card_wool.17a6dea8d559949f0ccc.svg',
    grain: 'https://cdn.colonist.io/dist/assets/card_grain.09c9d82146a64bce69b5.svg',
    ore: 'https://cdn.colonist.io/dist/assets/card_ore.117f64dab28e1c987958.svg',
  };

  const UNKNOWN_CARD_SRC = 'https://cdn.colonist.io/dist/assets/card_rescardback.03c18312a76028b0d9c9.svg';

  const BANK_CARD_ENUM_TO_RESOURCE = {
    1: 'lumber',
    2: 'brick',
    3: 'wool',
    4: 'grain',
    5: 'ore',
  };

  const RESOURCE_ORDER = ['lumber', 'brick', 'wool', 'grain', 'ore'];

  let renderPlayerPanelsScheduled = false;

  function mapDisplayNameToPlayerKey(displayName) {
    const trimmed = (displayName ?? '').trim();
    if (!trimmed) return '';
    if (trimmed.toLowerCase() === 'you') return 'PieEater';
    return trimmed;
  }

  function renderPlayerResourcePanels() {
    // Also patch Bank UI counts (if present) using our tracked Bank store.
    renderBankCountsIfMissing();

    const panels = document.querySelectorAll('[class*="playerInformation-"]');
    if (!panels || panels.length === 0) return;

    panels.forEach((panel) => {
      const usernameEl = panel.querySelector('[class*="username-"]');
      const headerContainer = usernameEl?.parentElement;
      if (!usernameEl || !headerContainer) return;

      // We want our injected UI to be one level up: inside informationWrapper, not inside the header container.
      const informationWrapper = panel.querySelector('[class*="informationWrapper-"]') || headerContainer.parentElement;
      if (!informationWrapper) return;

      // Make room for our extra UI by slightly shrinking the other info blocks.
      // We do this once per wrapper to avoid thrashing styles each render.
      if (informationWrapper.dataset.catanTrackerCompact !== '1') {
        informationWrapper.dataset.catanTrackerCompact = '1';

        // Many layouts are already flex; these small tweaks are low-risk.
        informationWrapper.style.gap = informationWrapper.style.gap || '4px';

        const siblingsToShrink = Array.from(informationWrapper.children).filter((el) => {
          if (!(el instanceof Element)) return false;
          if (el === headerContainer) return false;
          if (el.hasAttribute('data-catan-tracker') || el.querySelector('[data-catan-tracker]')) return false;
          return true;
        });

        siblingsToShrink.forEach((el) => {
          el.style.transform = 'scale(0.9)';
          el.style.transformOrigin = 'left center';
        });

        // Also allow the first container (the header/username block) to shrink.
        // This creates horizontal space for the injected resource columns.
        headerContainer.style.minWidth = '50px';
        headerContainer.style.flex = '0 1 120px';
        headerContainer.style.maxWidth = '120px';
        headerContainer.style.overflow = 'hidden';
        headerContainer.style.alignSelf = 'center';

        usernameEl.style.minWidth = '50px';
        usernameEl.style.overflow = 'hidden';
        usernameEl.style.textOverflow = 'ellipsis';
        usernameEl.style.whiteSpace = 'nowrap';
        usernameEl.style.fontSize = '12px';
        usernameEl.style.lineHeight = '1.1';
      }

      const displayName = usernameEl.textContent?.trim() ?? '';
      const playerKey = mapDisplayNameToPlayerKey(displayName);
      if (!playerKey) return;

      // Provided by content.js
      if (typeof window.ensurePlayerResources !== 'function' && typeof ensurePlayerResources !== 'function') {
        return;
      }

      // Prefer lexical/global binding if available; otherwise fall back to window.
      const ensureFn = typeof ensurePlayerResources === 'function' ? ensurePlayerResources : window.ensurePlayerResources;
      const store = ensureFn(playerKey);

      let resourcesDiv = informationWrapper.querySelector('[data-catan-tracker="resources"]');
      if (!resourcesDiv) {
        resourcesDiv = document.createElement('div');
        resourcesDiv.setAttribute('data-catan-tracker', 'resources');
        resourcesDiv.style.display = 'flex';
        resourcesDiv.style.flexDirection = 'column';
        resourcesDiv.style.alignItems = 'flex-start';
        resourcesDiv.style.gap = '2px';
        resourcesDiv.style.marginLeft = '6px';
        resourcesDiv.style.fontSize = '14px';
        resourcesDiv.style.lineHeight = '1.15';
        resourcesDiv.style.opacity = '0.95';
        resourcesDiv.style.paddingTop = '3px';
        resourcesDiv.style.paddingBottom = '3px';
        resourcesDiv.style.alignSelf = 'center';
        // Insert right after the header container so it stays near the username.
        informationWrapper.insertBefore(resourcesDiv, headerContainer.nextSibling);
      }

      let unknownDiv = informationWrapper.querySelector('[data-catan-tracker="unknown"]');
      if (!unknownDiv) {
        unknownDiv = document.createElement('div');
        unknownDiv.setAttribute('data-catan-tracker', 'unknown');
        unknownDiv.style.display = 'flex';
        unknownDiv.style.flexDirection = 'column';
        unknownDiv.style.alignItems = 'flex-start';
        unknownDiv.style.gap = '2px';
        unknownDiv.style.marginLeft = '6px';
        unknownDiv.style.fontSize = '14px';
        unknownDiv.style.lineHeight = '1.15';
        unknownDiv.style.opacity = '0.85';
        unknownDiv.style.paddingTop = '3px';
        unknownDiv.style.paddingBottom = '3px';
        unknownDiv.style.alignSelf = 'center';
        // Place unknown right after resources.
        informationWrapper.insertBefore(unknownDiv, resourcesDiv.nextSibling);
      }

      const ensureTextRow = (container, index) => {
        while (container.childElementCount <= index) {
          const row = document.createElement('div');
          row.style.whiteSpace = 'nowrap';
          container.appendChild(row);
        }
        return container.children[index];
      };

      const ensureResourceRow = (container, index, resourceKey) => {
        const row = /** @type {HTMLElement} */ (ensureTextRow(container, index));
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.gap = '4px';
        row.style.whiteSpace = 'nowrap';

        let img = row.querySelector('img[data-catan-tracker-icon="1"]');
        if (!img) {
          img = document.createElement('img');
          img.setAttribute('data-catan-tracker-icon', '1');
          img.setAttribute('draggable', 'false');
          img.style.width = '16px';
          img.style.height = '16px';
          img.style.objectFit = 'contain';
          row.appendChild(img);
        }

        let count = row.querySelector('span[data-catan-tracker-count="1"]');
        if (!count) {
          count = document.createElement('span');
          count.setAttribute('data-catan-tracker-count', '1');
          count.style.fontVariantNumeric = 'tabular-nums';
          row.appendChild(count);
        }

        img.alt = resourceKey;
        img.src = RESOURCE_ICON_SRC[resourceKey] || '';
        count.textContent = String(store?.[resourceKey] ?? 0);
      };

      // Keep DOM stable: exactly 5 resource rows.
      RESOURCE_ORDER.forEach((resourceKey, idx) => {
        ensureResourceRow(resourcesDiv, idx, resourceKey);
      });
      while (resourcesDiv.childElementCount > RESOURCE_ORDER.length) {
        resourcesDiv.removeChild(resourcesDiv.lastElementChild);
      }

      // Unknowns stay as compact text rows.
      const ensureUnknownRow = (container, index, sign, value) => {
        const row = /** @type {HTMLElement} */ (ensureTextRow(container, index));
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.gap = '4px';
        row.style.whiteSpace = 'nowrap';

        let img = row.querySelector('img[data-catan-tracker-unknown-icon="1"]');
        if (!img) {
          img = document.createElement('img');
          img.setAttribute('data-catan-tracker-unknown-icon', '1');
          img.setAttribute('draggable', 'false');
          img.style.width = '16px';
          img.style.height = '16px';
          img.style.objectFit = 'contain';
          row.appendChild(img);
        }

        let label = row.querySelector('span[data-catan-tracker-unknown-sign="1"]');
        if (!label) {
          label = document.createElement('span');
          label.setAttribute('data-catan-tracker-unknown-sign', '1');
          label.style.fontVariantNumeric = 'tabular-nums';
          label.style.minWidth = '10px';
          row.appendChild(label);
        }

        let count = row.querySelector('span[data-catan-tracker-unknown-count="1"]');
        if (!count) {
          count = document.createElement('span');
          count.setAttribute('data-catan-tracker-unknown-count', '1');
          count.style.fontVariantNumeric = 'tabular-nums';
          row.appendChild(count);
        }

        img.alt = 'resource card';
        img.src = UNKNOWN_CARD_SRC;
        label.textContent = sign;
        count.textContent = String(value ?? 0);
      };

      ensureUnknownRow(unknownDiv, 0, '+', store.UnknownStole ?? 0);
      ensureUnknownRow(unknownDiv, 1, '-', store.UnknownLost ?? 0);

      while (unknownDiv.childElementCount > 2) {
        unknownDiv.removeChild(unknownDiv.lastElementChild);
      }
    });
  }

  function renderBankCountsIfMissing() {
    // Provided by content.js
    if (typeof window.ensurePlayerResources !== 'function' && typeof ensurePlayerResources !== 'function') {
      return;
    }

    const ensureFn = typeof ensurePlayerResources === 'function' ? ensurePlayerResources : window.ensurePlayerResources;
    const bankStore = ensureFn('Bank');
    if (!bankStore) return;

    const cardRows = document.querySelectorAll('[class*="cardRow-"]');
    if (!cardRows || cardRows.length === 0) return;

    cardRows.forEach((row) => {
      // Avoid touching player panels / opponent panels.
      if (row.closest('[class*="playerInformation-"]')) return;

      // We only care about rows that actually contain the resource card enums.
      const hasAnyResource = row.querySelector('[data-card-enum="1"], [data-card-enum="2"], [data-card-enum="3"], [data-card-enum="4"], [data-card-enum="5"]');
      if (!hasAnyResource) return;

      Object.entries(BANK_CARD_ENUM_TO_RESOURCE).forEach(([enumStr, resourceKey]) => {
        const enumVal = Number(enumStr);
        if (Number.isNaN(enumVal)) return;

        // Find the stack container for this enum and target the top-most card container.
        const anyCard = row.querySelector(`[data-card-enum="${enumVal}"]`);
        if (!anyCard) return;

        const stack = anyCard.closest('[class*="cardStackContainer-"]');
        if (!stack) return;

        const candidates = stack.querySelectorAll(`[data-card-enum="${enumVal}"]`);
        if (!candidates || candidates.length === 0) return;
        const target = candidates[candidates.length - 1];

        // If Colonist already rendered a badge, leave it alone.
        const hasNativeBadge = !!target.querySelector('[class*="countBadge-"], [class*="count-"]');
        if (hasNativeBadge) return;

        let badge = target.querySelector('[data-catan-tracker="bank-count-badge"]');
        if (!badge) {
          target.style.position = target.style.position || 'relative';

          badge = document.createElement('div');
          badge.setAttribute('data-catan-tracker', 'bank-count-badge');
          badge.style.position = 'absolute';
          badge.style.right = '0px';
          badge.style.top = '0px';
          badge.style.transform = 'translate(30%, -30%)';
          badge.style.background = 'rgb(0, 114, 188)';
          badge.style.color = 'white';
          badge.style.borderRadius = '999px';
          badge.style.padding = '1px 5px';
          badge.style.fontSize = '12px';
          badge.style.lineHeight = '1.2';
          badge.style.fontVariantNumeric = 'tabular-nums';
          badge.style.pointerEvents = 'none';
          badge.style.boxShadow = '0 1px 2px rgba(0,0,0,0.35)';

          target.appendChild(badge);
        }

        badge.textContent = String(bankStore?.[resourceKey] ?? 0);
      });
    });
  }

  function scheduleRenderPlayerResourcePanels() {
    if (renderPlayerPanelsScheduled) return;
    renderPlayerPanelsScheduled = true;
    requestAnimationFrame(() => {
      renderPlayerPanelsScheduled = false;
      renderPlayerResourcePanels();
    });
  }

  // Expose hooks used by content.js
  window.scheduleRenderPlayerResourcePanels = scheduleRenderPlayerResourcePanels;
  window.renderPlayerResourcePanels = renderPlayerResourcePanels;
})();
