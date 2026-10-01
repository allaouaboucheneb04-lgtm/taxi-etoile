(function(){
  // Charge automatiquement le thème moderne sur toutes les pages publiques
  if(!document.querySelector('link[href="public-refresh.css"]')){
    const css=document.createElement('link');
    css.rel='stylesheet'; css.href='public-refresh.css';
    document.head.appendChild(css);
  }

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

  const ctaBar = header.querySelector('.hero-cta');
  if(ctaBar) header.insertBefore(toggle, ctaBar); else header.insertBefore(toggle, nav);

  function openMenu(){document.body.classList.add('menu-open');toggle.setAttribute('aria-expanded','true')}
  function closeMenu(){document.body.classList.remove('menu-open');toggle.setAttribute('aria-expanded','false')}
  toggle.addEventListener('click',()=>document.body.classList.contains('menu-open')?closeMenu():openMenu());
  closeBtn.addEventListener('click',closeMenu);backdrop.addEventListener('click',closeMenu);
  nav.querySelectorAll('a').forEach(a=>a.addEventListener('click',closeMenu));
  window.addEventListener('resize',()=>{if(window.innerWidth>900)closeMenu()});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMenu()});

  // Footer commun, pour éviter des pages qui se terminent brutalement
  if(!document.querySelector('.public-footer') && !document.querySelector('.pro-footer')){
    const footer=document.createElement('footer');
    footer.className='public-footer';
    footer.innerHTML='<div class="public-footer-inner"><div class="public-footer-brand"><img src="logo-taxi-live.png" alt="Taxi Live"><div><strong>Taxi Live Sorel-Tracy</strong><p>Votre transport, simplement.</p></div></div><div><strong>Navigation</strong><a href="services.html">Services</a><a href="a-propos.html">À propos</a><a href="contact.html">Contact</a><a href="faq.html">FAQ</a></div><div><strong>Nous joindre</strong><a class="site-call-link" href="tel:+15148674616">514 867-4616</a><span>Service 24/7</span></div></div><div class="public-footer-bottom">© '+new Date().getFullYear()+' Taxi Live Sorel-Tracy · <a href="politique-confidentialite.html">Confidentialité</a> · <a href="conditions.html">Conditions</a></div>';
    document.body.appendChild(footer);
  }
})();
