(function () {
  'use strict';

  document.querySelectorAll('form[data-contact-form]').forEach(function (form) {
    var preference = form.elements.namedItem('preferred_contact');
    var contact = form.elements.namedItem('contact_handle');
    var field = form.querySelector('[data-contact-details]');
    var label = form.querySelector('[data-contact-label]');
    var hint = form.querySelector('[data-contact-hint]');
    if (!preference || !contact || !field || !label || !hint) return;

    function updateContact() {
      var method = preference.value;
      var needsContact = method !== 'Email';
      field.hidden = !needsContact;
      contact.disabled = !needsContact;
      contact.required = needsContact;
      contact.type = method === 'WhatsApp' ? 'tel' : 'text';
      contact.setAttribute('autocomplete', method === 'WhatsApp' ? 'tel' : 'off');
      contact.setCustomValidity('');

      if (method === 'WhatsApp') {
        label.textContent = 'WhatsApp number (required)';
        contact.placeholder = '+354 1234567';
        hint.textContent = 'Include your country code so Arnar can reach you on WhatsApp.';
      } else {
        label.textContent = method + ' username (required)';
        contact.placeholder = 'Your ' + method + ' username';
        hint.textContent = 'Enter the exact username where you can receive a message about your application.';
      }
    }

    function validateContact() {
      var method = preference.value;
      var value = contact.value.trim();
      var error = '';
      if (method !== 'Email') {
        if (!value) {
          error = 'Please enter your ' + method + ' contact details.';
        } else if (method === 'WhatsApp' && !/^\+[0-9 ()-]+$/.test(value)) {
          error = 'Enter your WhatsApp number starting with + and your country code.';
        } else if (method === 'WhatsApp' && !/^[1-9]\d{6,14}$/.test(value.replace(/\D/g, ''))) {
          error = 'Enter a complete international phone number, including the country code.';
        }
      }
      contact.setCustomValidity(error);
    }

    preference.addEventListener('change', updateContact);
    contact.addEventListener('input', validateContact);
    form.addEventListener('submit', function (event) {
      validateContact();
      if (!form.checkValidity()) {
        event.preventDefault();
        form.reportValidity();
      }
    });
    window.addEventListener('pageshow', updateContact);
    updateContact();
  });
})();
