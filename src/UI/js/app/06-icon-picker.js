(function BootstrapIconPickerModule() {
  'use strict';

  const Picker = {};
  let IconCache = null;
  let IconLoadPromise = null;

  function normalizeIconName(value) {
    const trimmed = String(value == null ? '' : value).trim().toLowerCase();
    return trimmed.replace(/^bi-/, '');
  }

  function uniqueSorted(values) {
    return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
  }

  function extractIconsFromCSSRuleList(ruleList) {
    const out = [];
    for (const rule of ruleList || []) {
      const selector = rule && rule.selectorText ? String(rule.selectorText) : '';
      const match = /\.bi-([a-z0-9-]+)::before/i.exec(selector);
      if (match) out.push(match[1]);
    }
    return out;
  }

  function extractIconsFromLoadedStylesheets() {
    const icons = [];
    for (const sheet of Array.from(document.styleSheets || [])) {
      const href = sheet && sheet.href ? String(sheet.href) : '';
      if (!href || !/bootstrap-icons\.css/i.test(href)) continue;
      try {
        icons.push(...extractIconsFromCSSRuleList(sheet.cssRules));
      } catch {
        // Accessing cssRules can throw for some stylesheets; ignore and continue.
      }
    }
    return uniqueSorted(icons);
  }

  async function extractIconsByFetch() {
    try {
      const cssURL = new URL('./vendors/bootstrap-icons/font/bootstrap-icons.css', window.location.href);
      const response = await fetch(String(cssURL));
      if (!response.ok) return [];
      const text = await response.text();
      const matches = text.match(/\.bi-([a-z0-9-]+)::before\s*\{/gi) || [];
      const out = matches
        .map((m) => /\.bi-([a-z0-9-]+)::before/i.exec(m))
        .filter(Boolean)
        .map((m) => m[1]);
      return uniqueSorted(out);
    } catch {
      return [];
    }
  }

  Picker.getIcons = async function getIcons() {
    if (Array.isArray(IconCache) && IconCache.length) return IconCache;
    if (IconLoadPromise) return IconLoadPromise;
    IconLoadPromise = (async () => {
      let icons = extractIconsFromLoadedStylesheets();
      if (!icons.length) icons = await extractIconsByFetch();
      if (!icons.length) {
        // Minimal fallback so the picker remains functional.
        icons = [
          'flag',
          'star',
          'bookmark',
          'check-circle',
          'exclamation-triangle',
          'x-circle',
          'person',
          'chat-left-text',
          'clock',
          'bell',
        ];
      }
      IconCache = uniqueSorted(icons);
      return IconCache;
    })();
    return IconLoadPromise;
  };

  Picker.createMarkup = function createMarkup(options = {}) {
    const inputId = String(options.inputId || 'ICON_PICKER_INPUT');
    const previewId = String(options.previewId || 'ICON_PICKER_PREVIEW');
    const panelId = String(options.panelId || 'ICON_PICKER_PANEL');
    const searchId = String(options.searchId || 'ICON_PICKER_SEARCH');
    const listId = String(options.listId || 'ICON_PICKER_LIST');
    const value = normalizeIconName(options.value || 'flag') || 'flag';

    return `
      <div class="st-icon-picker" id="${inputId}_ROOT">
        <div class="st-icon-picker-trigger">
          <span class="sf-flag-preview"><i class="bi bi-${value}" id="${previewId}"></i></span>
          <input
            type="text"
            class="form-control"
            id="${inputId}"
            value="${value}"
            placeholder="Selected icon"
            autocomplete="off"
            spellcheck="false"
          />
        </div>
        <div class="st-icon-picker-panel" id="${panelId}">
          <div class="st-icon-picker-search-wrap">
            <i class="bi bi-search"></i>
            <input type="text" class="form-control" id="${searchId}" placeholder="Search bootstrap icons" />
          </div>
          <div class="st-icon-picker-list" id="${listId}"></div>
        </div>
      </div>`;
  };

  Picker.mount = async function mount(options = {}) {
    const input = document.getElementById(options.inputId);
    const preview = document.getElementById(options.previewId);
    const panel = document.getElementById(options.panelId);
    const search = document.getElementById(options.searchId);
    const list = document.getElementById(options.listId);
    const root = input ? input.closest('.st-icon-picker') : null;
    if (!input || !preview || !panel || !search || !list || !root) return;

    const allIcons = await Picker.getIcons();

    function setValue(rawName, emit = true) {
      const name = normalizeIconName(rawName) || 'flag';
      input.value = name;
      preview.className = `bi bi-${name}`;
      if (emit && typeof options.onChange === 'function') {
        options.onChange(name);
      }
    }

    function renderList(filterText = '') {
      const q = normalizeIconName(filterText);
      const filtered = q
        ? allIcons.filter((name) => name.includes(q))
        : allIcons;
      list.innerHTML = filtered
        .map(
          (name) => `
          <button type="button" class="st-icon-item" data-icon="${name}" title="${name}">
            <i class="bi bi-${name}"></i>
            <span>${name}</span>
          </button>`
        )
        .join('');
      if (!filtered.length) {
        list.innerHTML = '<div class="st-icon-empty">No matching icons</div>';
      }
    }

    setValue(input.value, false);
    renderList('');

    input.addEventListener('input', () => {
      const name = normalizeIconName(input.value);
      preview.className = `bi bi-${name || 'flag'}`;
      renderList(input.value);
      if (typeof options.onChange === 'function') options.onChange(name);
    });

    search.addEventListener('input', () => renderList(search.value));

    list.addEventListener('click', (event) => {
      const target = event.target.closest('.st-icon-item');
      if (!target) return;
      event.preventDefault();
      setValue(target.getAttribute('data-icon'));
      search.focus();
      search.select();
    });

    // Keep the search list always available and focusable.
    search.addEventListener('focus', () => {
      renderList(search.value);
    });
  };

  window.ShowTrakIconPicker = Picker;
})();