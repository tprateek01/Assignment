(function(){
    var KEY = 'scribble-theme', root = document.documentElement;
    function saved(){try{var v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : null}catch(e){return null}}
    function systemDark(){return !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches)}
    function current(){return saved() || (systemDark() ? 'dark' : 'light')}
    function apply(t){root.setAttribute('data-theme', t); root.style.colorScheme = t}
    apply(current());                                   // runs in <head>, so the page never flashes the wrong theme
  
    var css = document.createElement('style');
    css.textContent = '.themeBtn{font:inherit;font-weight:600;font-size:.9rem;line-height:1;cursor:pointer;border-radius:10px;padding:10px 14px;min-height:44px;' +
      'border:1px solid var(--rule,#ccd);background:var(--field,var(--card,#fff));color:var(--ink,#14214f);display:inline-flex;align-items:center;gap:6px;white-space:nowrap}' +
      '.themeBtn:focus-visible{outline:3px solid var(--hi,#ffe45e);outline-offset:2px}';
    document.head.appendChild(css);
  
    function label(b){var d = current() === 'dark'; b.textContent = d ? '☀️ Light' : '🌙 Dark'; b.setAttribute('aria-label', d ? 'Switch to light theme' : 'Switch to dark theme')}
    var btns = [];
    function make(){
      var b = document.createElement('button'); b.type = 'button'; b.className = 'themeBtn'; label(b);
      b.onclick = function(){var t = current() === 'dark' ? 'light' : 'dark'; try{localStorage.setItem(KEY, t)}catch(e){} apply(t); btns.forEach(label)};
      btns.push(b); return b;
    }
    function mount(){
      var slots = document.querySelectorAll('[data-theme-slot]');
      if(!slots.length){var f = document.createElement('div'); f.setAttribute('data-theme-slot', ''); f.style.cssText = 'position:fixed;top:max(10px,env(safe-area-inset-top,0px));right:12px;z-index:60'; document.body.appendChild(f); slots = [f]}
      Array.prototype.forEach.call(slots, function(s){s.appendChild(make())});
    }
    if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
  })();