/* Apply before paint; appearance is shared by login and workspace pages. */
(() => {
  const key = 'paytrace.appearance.v1';
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  let saved;
  try { saved = localStorage.getItem(key); } catch {}
  let explicit = saved === 'light' || saved === 'dark';
  function apply(theme) {
    document.documentElement.dataset.theme = theme;
    document.querySelectorAll('[data-theme-toggle]').forEach(button => {
      button.textContent = theme === 'dark' ? '☾ Dark' : '☀ Light';
      button.setAttribute('aria-label', theme === 'dark' ? '切换为浅色主题' : '切换为深色主题');
      button.title = theme === 'dark' ? '切换为 Light' : '切换为 Dark';
    });
  }
  apply(explicit ? saved : system.matches ? 'dark' : 'light');
  system.addEventListener('change', event => { if (!explicit) apply(event.matches ? 'dark' : 'light'); });
  document.addEventListener('DOMContentLoaded', () => {
    apply(document.documentElement.dataset.theme);
    document.querySelectorAll('[data-theme-toggle]').forEach(button => button.addEventListener('click', () => {
      const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      explicit = true;
      try { localStorage.setItem(key, theme); } catch {}
      apply(theme);
    }));
  });
  window.addEventListener('storage', event => {
    if (event.key !== key && event.key !== null) return;
    explicit = event.newValue === 'light' || event.newValue === 'dark';
    apply(explicit ? event.newValue : system.matches ? 'dark' : 'light');
  });
})();
