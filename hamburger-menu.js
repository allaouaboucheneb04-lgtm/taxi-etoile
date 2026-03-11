
(function(){
  const header = document.querySelector('header.hero:not(.admin-hero)');
  const nav = header ? header.querySelector('nav.menu') : null;
  if(!header || !nav) return;

  nav.classList.add('mobile-ready');
  nav.setAttribute('id','siteMenu');
  nav.setAttribute('aria-label','Menu principal');

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'menu-toggle';
  toggle.setAttribute('aria-expanded','false');
  toggle.setAttribute('aria-controls','siteMenu');
  toggle.innerHTML = '<i class="fa fa-bars"></i><span>Menu</span>';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'menu-close-label';
  closeBtn.setAttribute('aria-label','Fermer le menu');
  closeBtn.innerHTML = '<i class="fa fa-times"></i>';
  nav.prepend(closeBtn);

  const backdrop = document.createElement('div');
  backdrop.className = 'menu-backdrop';
  document.body.appendChild(backdrop);

  const themeSelector = header.querySelector('.theme-btn');
  if(themeSelector){
    header.insertBefore(toggle, themeSelector);
  } else {
    header.insertBefore(toggle, nav);
  }

  function openMenu(){
    document.body.classList.add('menu-open');
    toggle.setAttribute('aria-expanded','true');
  }
  function closeMenu(){
    document.body.classList.remove('menu-open');
    toggle.setAttribute('aria-expanded','false');
  }
  function toggleMenu(){
    if(document.body.classList.contains('menu-open')) closeMenu(); else openMenu();
  }

  toggle.addEventListener('click', toggleMenu);
  closeBtn.addEventListener('click', closeMenu);
  backdrop.addEventListener('click', closeMenu);
  nav.querySelectorAll('a').forEach(a => a.addEventListener('click', closeMenu));
  window.addEventListener('resize', () => { if(window.innerWidth > 860) closeMenu(); });
  document.addEventListener('keydown', (e) => { if(e.key === 'Escape') closeMenu(); });
})();
