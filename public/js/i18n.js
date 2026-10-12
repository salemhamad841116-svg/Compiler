// ==============================================================================
// Dynamic i18n Localization Engine (Strict Zero-Arabic Source Code Compliance)
// Loads translation dictionaries dynamically at runtime from isolated JSON assets
// ==============================================================================

(function (window) {
  'use strict';

  class I18nEngine {
    constructor() {
      this.currentLang = 'en';
      this.allowedLangs = ['en', 'ar'];
      this.translations = {};
      this.callbacks = [];
      this.isLoaded = false;
    }

    /**
     * Initializes the localization engine with preferred language.
     * @param {Object} options
     * @param {string} [options.defaultLang='en']
     * @param {Array<string>} [options.allowedLangs=['en', 'ar']]
     * @param {Function} [options.onChange]
     * @returns {Promise<string>}
     */
    async init(options = {}) {
      const savedLang = localStorage.getItem('masruq_language');
      const defaultLang = options.defaultLang || savedLang || 'en';
      if (options.allowedLangs) this.allowedLangs = options.allowedLangs;
      if (options.onChange) this.callbacks.push(options.onChange);

      await this.setLanguage(defaultLang);
      return this.currentLang;
    }

    /**
     * Resolves dictionary object by dot-notation path.
     * @param {string} key
     * @param {string} [fallback='']
     * @returns {string}
     */
    t(key, fallbackOrVars = '', maybeVars) {
      if (!key) return typeof fallbackOrVars === 'string' ? fallbackOrVars : '';
      let fallback = '';
      let vars = null;
      if (typeof fallbackOrVars === 'object' && fallbackOrVars !== null) vars = fallbackOrVars;
      else fallback = fallbackOrVars || '';
      if (maybeVars && typeof maybeVars === 'object') vars = maybeVars;

      const lookup = (dict) => {
        let current = dict || {};
        for (const part of key.split('.')) {
          if (current && typeof current === 'object' && part in current) current = current[part];
          else return null;
        }
        return typeof current === 'string' ? current : null;
      };
      // Current language first, then English as a safety net, then the caller fallback, then the raw key.
      let out = lookup(this.translations[this.currentLang]);
      if (out === null) out = lookup(this.translations.en);
      if (out === null) out = fallback || key;
      if (vars) out = out.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
      return out;
    }

    /**
     * Fetches translation dictionary from isolated JSON assets or server API.
     * @param {string} lang
     * @returns {Promise<Object>}
     */
    async loadDictionary(lang) {
      if (this.translations[lang]) {
        return this.translations[lang];
      }

      // Try local isolated JSON file first, then fallback to API
      const candidates = [
        `/locales/${lang}.json`,
        `../locales/${lang}.json`,
        `./locales/${lang}.json`,
        `/api/locales/${lang}`,
      ];

      for (const url of candidates) {
        try {
          const res = await fetch(url);
          if (res.ok) {
            const data = await res.json();
            const dict = data.data || data;
            this.translations[lang] = dict;
            return dict;
          }
        } catch (_) {
          // Attempt next candidate
        }
      }

      console.warn(`[i18n] Failed to load locale dictionary for "${lang}". Falling back to empty object.`);
      this.translations[lang] = {};
      return {};
    }

    /**
     * Swaps the active language and re-translates DOM.
     * @param {string} lang
     * @returns {Promise<void>}
     */
    async setLanguage(lang) {
      const targetLang = this.allowedLangs.includes(lang) ? lang : 'en';
      await this.loadDictionary(targetLang);
      if (targetLang !== 'en') await this.loadDictionary('en');

      this.currentLang = targetLang;
      this.isLoaded = true;
      localStorage.setItem('masruq_language', targetLang);

      // Set DOM attributes and text direction
      document.documentElement.lang = targetLang;
      const isRtl = targetLang === 'ar';
      document.documentElement.dir = isRtl ? 'rtl' : 'ltr';

      if (isRtl) {
        document.body.classList.add('rtl-mode');
      } else {
        document.body.classList.remove('rtl-mode');
      }

      this.applyTranslations();

      for (const cb of this.callbacks) {
        try { cb(targetLang); } catch (e) { console.error('[i18n] Callback error:', e); }
      }
    }

    /**
     * Translates all elements marked with data-i18n attributes in the document.
     * @param {HTMLElement|Document} [root=document]
     */
    applyTranslations(root = document) {
      // 1. Text elements: data-i18n="key"
      const textElements = root.querySelectorAll('[data-i18n]');
      textElements.forEach((el) => {
        const key = el.getAttribute('data-i18n');
        const translated = this.t(key);
        if (translated && translated !== key) {
          el.textContent = translated;
        }
      });

      // 2. HTML elements: data-i18n-html="key"
      const htmlElements = root.querySelectorAll('[data-i18n-html]');
      htmlElements.forEach((el) => {
        const key = el.getAttribute('data-i18n-html');
        const translated = this.t(key);
        if (translated && translated !== key) {
          el.innerHTML = translated;
        }
      });

      // 3. Attributes: data-i18n-attr="placeholder:key,title:key2"
      const attrElements = root.querySelectorAll('[data-i18n-attr]');
      attrElements.forEach((el) => {
        const pairs = el.getAttribute('data-i18n-attr').split(',');
        pairs.forEach((pair) => {
          const [attr, key] = pair.split(':').map((s) => s.trim());
          if (attr && key) {
            const translated = this.t(key);
            if (translated && translated !== key) {
              el.setAttribute(attr, translated);
            }
          }
        });
      });
    }

    /**
     * Toggles between English and Arabic.
     * @returns {Promise<string>}
     */
    async toggleLanguage() {
      const nextLang = this.currentLang === 'en' ? 'ar' : 'en';
      await this.setLanguage(nextLang);
      return nextLang;
    }
  }

  window.i18n = new I18nEngine();
})(window);
