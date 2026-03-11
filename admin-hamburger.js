
(function(){
  function initAdminHamburger(){
    const body = document.body;
    const shell = document.querySelector('.admin-shell');
    const sidebar = document.querySelector('.admin-sidebar');
    const topbar = document.querySelector('.admin-shell-topbar');
    if(!shell || !sidebar || !topbar) return;

    if(!document.querySelector('.admin-sidebar-overlay')){
      const overlay = document.createElement('div');
      overlay.className = 'admin-sidebar-overlay';
      overlay.addEventListener('click', ()=> body.classList.remove('admin-sidebar-open'));
      document.body.appendChild(overlay);
    }

    if(!document.getElementById('adminMenuToggle')){
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'adminMenuToggle';
      btn.className = 'admin-menu-toggle';
      btn.innerHTML = '<i class="fa fa-bars"></i><span>Menu</span>';
      btn.addEventListener('click', ()=> body.classList.toggle('admin-sidebar-open'));
      const actions = topbar.querySelector('.admin-topbar-actions');
      if(actions) topbar.insertBefore(btn, actions);
      else topbar.appendChild(btn);
    }

    let footer = sidebar.querySelector('.admin-sidebar-footer');
    if(!footer){
      footer = document.createElement('div');
      footer.className = 'admin-sidebar-footer';
      sidebar.appendChild(footer);
    }

    const notifyBtn = document.getElementById('enableAdminNotificationsBtn');
    if(notifyBtn){
      notifyBtn.classList.add('sidebar-action-btn','notify');
      notifyBtn.innerHTML = '<i class="fa fa-bell"></i><span>Notifications admin</span>';
      footer.appendChild(notifyBtn);
    }

    const logoutBtn = document.getElementById('logoutBtn');
    if(logoutBtn){
      logoutBtn.classList.add('sidebar-action-btn','logout');
      logoutBtn.innerHTML = '<i class="fa fa-right-from-bracket"></i><span>Déconnexion</span>';
      footer.appendChild(logoutBtn);
    }

    sidebar.querySelectorAll('a').forEach(link=>{
      link.addEventListener('click', ()=> body.classList.remove('admin-sidebar-open'));
    });

    window.addEventListener('resize', ()=>{
      if(window.innerWidth > 980) body.classList.remove('admin-sidebar-open');
    });
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initAdminHamburger);
  else initAdminHamburger();
})();
