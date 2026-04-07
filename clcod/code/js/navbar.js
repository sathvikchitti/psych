/**
 * PsychSense — Navbar & Footer
 * Injects nav and footer, syncs active state with goTo(), mirrors auth badge.
 */

(function () {
  /* ── Pages that appear in the nav (in order) ── */
  const NAV_PAGES = [
    { id: 'landing',     label: 'Home' },
    { id: 'assessment',  label: 'Analysis' }, // Maps to assessment
    { id: 'results',     label: 'Results' }
  ];

  /* Which pages have been unlocked this session */
  const unlocked = new Set(['landing', 'user-info']);

  /* ── Build Navbar ── */
  function buildNavbar() {
    const nav = document.createElement('nav');
    nav.id = 'ps-navbar';

    // Brand
    const brand = document.createElement('span');
    brand.className = 'nav-brand';
    brand.innerHTML = '<span style="color:#06b6d4">Psych</span><span style="color:#8b5cf6">Sense</span>';
    brand.addEventListener('click', () => safeGoTo('landing'));

    // Links
    const ul = document.createElement('ul');
    ul.className = 'nav-links';

    NAV_PAGES.forEach(page => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.className = 'nav-link-btn';
      btn.dataset.page = page.id;
      btn.innerHTML = `<span class="link-label" style="font-weight:500;">${page.label}</span>`;
      btn.addEventListener('click', () => {
        if (page.id === 'assessment') {
          // Always gate — must be logged in
          if (typeof window.startAnalysisGated === 'function') window.startAnalysisGated();
          else if (typeof window.openAuthModal === 'function') window.openAuthModal();
        } else if (page.id === 'results') {
          // Open history modal
          if (typeof window.openResultsHistory === 'function') window.openResultsHistory();
        } else {
          safeGoTo(page.id);
        }
      });
      li.appendChild(btn);
      ul.appendChild(li);
    });

    // Right slot — will host the user badge / login btn
    const right = document.createElement('div');
    right.className = 'nav-right';
    right.id = 'nav-right-slot';

    nav.appendChild(brand);
    nav.appendChild(ul);
    nav.appendChild(right);
    document.body.insertBefore(nav, document.body.firstChild);
  }

  /* ── Build Footer ── */
  function buildFooter() {
    const footer = document.createElement('footer');
    footer.id = 'ps-footer';
    footer.innerHTML = `
      <div style="width:100%; display:flex; flex-direction:column;">
        <div style="display:flex; justify-content:space-between; align-items:center; padding: 14px 32px; border-bottom: 1px solid rgba(255,255,255,0.05);">
          <span style="font-family:'Space Grotesk',sans-serif; font-size:14px; font-weight:700; color:#06b6d4; letter-spacing:0.1em; text-transform:uppercase;">DEVELOPED BY TEAM G-1107</span>
          <span style="font-family:'Space Grotesk',sans-serif; font-size:14px; font-weight:700; color:#60a5fa; letter-spacing:0.1em; text-transform:uppercase;">PS NEURO</span>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; padding: 12px 32px; background: rgba(0,0,0,0.2);">
          <span style="font-family:'Space Grotesk',sans-serif; font-size:11px; color:#64748b; font-weight:600; letter-spacing:0.05em; text-transform:uppercase;">&copy; TEAM G-1107</span>
          <div style="display:flex; align-items:center; gap:20px;">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="width:8px; height:8px; border-radius:50%; background:#10b981; display:inline-block; box-shadow:0 0 8px #10b981;"></span>
              <span style="font-family:'Space Grotesk',sans-serif; font-size:11px; color:#64748b; font-weight:600; letter-spacing:0.05em; text-transform:uppercase;">SYSTEM OPERATIONAL</span>
            </div>
            <span style="font-family:'Space Grotesk',sans-serif; font-size:11px; color:#475569; font-weight:600; letter-spacing:0.05em; text-transform:uppercase;">MD-C3 REGISTERED</span>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(footer);
  }

  /* ── Sync active link & lock gated pages ── */
  function syncNav(pageId) {
    const links = document.querySelectorAll('#ps-navbar .nav-link-btn');
    links.forEach(btn => {
      const pg = btn.dataset.page;
      btn.classList.remove('active', 'locked');
      // Map assessment page to 'assessment' nav item for active highlight
      const effectivePage = pageId === 'user-info' ? 'assessment' : pageId;
      if (pg === pageId || pg === effectivePage) {
        btn.classList.add('active');
      }
      // 'assessment' and 'results' nav items are NEVER locked — they handle gating themselves
      // Only lock other nav items that are truly flow-gated
    });

    // Hide footer on analysis loading page
    const footer = document.getElementById('ps-footer');
    if (footer) {
      footer.style.display = pageId === 'analysis' ? 'none' : 'flex';
    }
  }

  /* ── Mirror auth controls into nav right slot ── */
  function mirrorAuthControls() {
    const slot = document.getElementById('nav-right-slot');
    if (!slot) return;

    // Move (clone) the top-controls children into the nav slot
    const topControls = document.getElementById('top-controls');
    if (topControls) {
      // Hide the original fixed top-controls — nav takes over
      topControls.style.display = 'none';

      // Clone badge container & login btn into nav
      const badge = document.getElementById('user-badge-container');
      const loginBtn = document.getElementById('login-signup-btn');

      if (badge) slot.appendChild(badge);
      if (loginBtn) slot.appendChild(loginBtn);
    }
  }

  /* ── Patch window.goTo to sync nav ── */
  function patchGoTo() {
    const _original = window.goTo;
    window.goTo = function (pageId) {
      // Unlock this page and all pages up to it
      const order = NAV_PAGES.map(p => p.id);
      const idx = order.indexOf(pageId);
      if (idx !== -1) {
        for (let i = 0; i <= idx; i++) unlocked.add(order[i]);
      }
      syncNav(pageId);
      if (typeof _original === 'function') _original(pageId);
    };
  }

  /* ── Safe navigation wrapper ── */
  function safeGoTo(pageId) {
    if (typeof window.goTo === 'function') window.goTo(pageId);
  }

  /* ── Icons (inline SVG) ── */
  function homeIcon() {
    return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`;
  }
  function userIcon() {
    return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
  }
  function clipboardIcon() {
    return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>`;
  }
  function questionIcon() {
    return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
  }
  function chartIcon() {
    return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`;
  }

  /* ── Init ── */
  function init() {
    buildNavbar();
    buildFooter();

    // Wait a tick for app.js to define goTo before patching
    setTimeout(() => {
      patchGoTo();
      mirrorAuthControls();

      // Detect current page from active class
      const activePage = document.querySelector('.page.active');
      if (activePage) {
        const id = activePage.id.replace('page-', '');
        syncNav(id);
      } else {
        syncNav('landing');
      }
    }, 50);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
