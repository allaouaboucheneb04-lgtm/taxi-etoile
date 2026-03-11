(function(){
  function setupAdminSidebar(){
    const toggle = document.getElementById('adminSidebarToggle');
    const sidebar = document.getElementById('adminSidebarPanel');
    const backdrop = document.getElementById('adminSidebarBackdrop');
    if(!toggle || !sidebar || !backdrop) return;

    const MOBILE_BREAKPOINT = 1100;

    function openSidebar(){
      document.body.classList.add('admin-sidebar-open');
      toggle.setAttribute('aria-expanded','true');
    }
    function closeSidebar(){
      document.body.classList.remove('admin-sidebar-open');
      toggle.setAttribute('aria-expanded','false');
    }
    function toggleSidebar(){
      if(window.innerWidth > MOBILE_BREAKPOINT) return;
      if(document.body.classList.contains('admin-sidebar-open')) closeSidebar();
      else openSidebar();
    }

    toggle.addEventListener('click', toggleSidebar);
    backdrop.addEventListener('click', closeSidebar);
    sidebar.querySelectorAll('a').forEach(a => a.addEventListener('click', closeSidebar));
    document.addEventListener('keydown', (e)=>{ if(e.key === 'Escape') closeSidebar(); });
    window.addEventListener('resize', ()=>{ if(window.innerWidth > MOBILE_BREAKPOINT) closeSidebar(); });
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupAdminSidebar);
  else setupAdminSidebar();
})();
