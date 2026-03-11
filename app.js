(function () {
  const cfg = window.EMAILJS_CONFIG || {
    publicKey: 'W-3rUaqJdvEjPE1J0',
    serviceId: 'service_5phpu0d',
    templateId: 'template_06gymkw'
  };

  function safeInit() {
    if (!window.emailjs || !cfg.publicKey) return false;
    try {
      window.emailjs.init({ publicKey: cfg.publicKey });
      return true;
    } catch (e) {
      return false;
    }
  }

  async function sendSimpleReservation(params) {
    if (!safeInit() || !cfg.serviceId || !cfg.templateId) return false;
    try {
      await window.emailjs.send(cfg.serviceId, cfg.templateId, params);
      return true;
    } catch (e) {
      return false;
    }
  }

  window.TaxiLiveEmail = {
    sendSimpleReservation
  };
})();
