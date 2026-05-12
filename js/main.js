/**
 * PhantomByte Funnels — Form Handler + GA Events
 * Handles: validation, loading/error states, MailerLite API POST, analytics
 */
(function () {
  'use strict';

  // ─── GA Helper ───────────────────────────────────────────
  function gaEvent(action, category, label, value) {
    if (typeof gtag === 'function') {
      var params = { event_category: category || 'funnel' };
      if (label) params.event_label = label;
      if (value !== undefined) params.value = value;
      gtag('event', action, params);
    }
  }

  // ─── MailerLite Proxy POST ──────────────────────────────
  var PROXY_URL = 'https://mailerlite-proxy-1091380733401.us-east1.run.app/api/subscribe';

  function submitToMailerLite(form, onSuccess, onError) {
    var fd = new FormData(form);
    var json = { group: form.getAttribute('data-funnel') };
    fd.forEach(function (v, k) {
      if (k === '_gotcha') return;
      json[k] = v;
    });

    fetch(PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(json)
    })
      .then(function (res) {
        if (!res.ok) throw new Error('Server returned ' + res.status);
        return res.json().catch(function () { return {}; });
      })
      .then(function (result) {
        onSuccess(result);
      })
      .catch(function (err) {
        onError(err.message || 'Something went wrong. Please try again.');
      });
  }

  // ─── UI State Helpers ────────────────────────────────────
  function setLoading(form, btn) {
    var orig = btn.textContent;
    btn.setAttribute('data-orig-text', orig);
    btn.textContent = 'Submitting...';
    btn.disabled = true;
    btn.style.opacity = '0.7';
    btn.style.cursor = 'wait';

    // hide any previous messages
    var msgs = form.querySelectorAll('.form-message');
    for (var i = 0; i < msgs.length; i++) msgs[i].style.display = 'none';
  }

  function resetButton(btn) {
    var orig = btn.getAttribute('data-orig-text');
    btn.textContent = orig || btn.textContent;
    btn.disabled = false;
    btn.style.opacity = '1';
    btn.style.cursor = 'pointer';
  }

  function showMessage(form, type, text) {
    var el = form.querySelector('.form-message.' + type);
    if (!el) return;
    el.textContent = text;
    el.style.display = 'block';
  }

  function clearMessages(form) {
    var msgs = form.querySelectorAll('.form-message');
    for (var i = 0; i < msgs.length; i++) {
      msgs[i].textContent = '';
      msgs[i].style.display = 'none';
    }
  }

  // ─── Validation ──────────────────────────────────────────
  function validateEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function validateForm(form) {
    clearMessages(form);
    var fields = form.querySelectorAll('[required]');
    var firstInvalid = null;
    var errors = [];

    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      if (f.type === 'hidden' || f.style.display === 'none') continue;

      var val = f.value.trim();

      if (!val) {
        errors.push((f.getAttribute('data-label') || f.name || 'Field') + ' is required.');
        if (!firstInvalid) firstInvalid = f;
        f.style.borderColor = 'var(--red, #ff4444)';
      } else if (f.type === 'email' && !validateEmail(val)) {
        errors.push('Please enter a valid email address.');
        if (!firstInvalid) firstInvalid = f;
        f.style.borderColor = 'var(--red, #ff4444)';
      } else {
        f.style.borderColor = '';
      }
    }

    if (errors.length) {
      showMessage(form, 'error', errors[0]);
      if (firstInvalid) firstInvalid.focus();
      gaEvent('form_validation_error', 'funnel', form.getAttribute('data-funnel') || 'unknown', errors[0]);
    }

    return errors.length === 0;
  }

  // ─── Redirect ────────────────────────────────────────────
  function doRedirect(form, email) {
    var redirectInput = form.querySelector('input[name="redirect"]');
    var redirectUrl = redirectInput ? redirectInput.value : null;

    // Build query params from form data
    var params = new URLSearchParams();
    var data = new FormData(form);
    data.forEach(function (v, k) {
      if (k !== '_gotcha') params.append(k, v);
    });

    if (!redirectUrl) {
      // fallback: redirect to generic thanks
      redirectUrl = 'thanks.html';
    }

    var sep = redirectUrl.indexOf('?') > -1 ? '&' : '?';
    window.location.href = redirectUrl + sep + params.toString();
  }

  // ─── Init single funnel form ─────────────────────────────
  function initFunnelForm(formSelector) {
    var form = document.querySelector(formSelector);
    if (!form) return;

    var btn = form.querySelector('button[type="submit"], input[type="submit"]');
    if (!btn) return;

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      // GA: form start
      var funnel = form.getAttribute('data-funnel') || 'unknown';
      gaEvent('form_submit_attempt', 'funnel', funnel);

      if (!validateForm(form)) return;

      setLoading(form, btn);

      submitToMailerLite(
        form,
        function (result) {
          // Success — disable button for 5s to prevent double-submit / rate limiting
          btn.disabled = true;
          btn.style.opacity = '0.7';
          btn.style.cursor = 'not-allowed';
          showMessage(form, 'success', '✓ You\'re in! Redirecting...');
          gaEvent('form_submit_success', 'funnel', funnel);

          var emailField = form.querySelector('input[type="email"]');
          var email = emailField ? emailField.value : '';

          // Re-enable after 5 seconds (rate limit guard)
          setTimeout(function () {
            resetButton(btn);
          }, 5000);

          // Brief delay so user sees success message
          setTimeout(function () {
            doRedirect(form, email);
          }, 800);
        },
        function (errMsg) {
          // Error
          resetButton(btn);
          showMessage(form, 'error', errMsg);
          gaEvent('form_submit_error', 'funnel', funnel, errMsg);
        }
      );
    });

    // Reset field borders on input
    var inputs = form.querySelectorAll('input, textarea, select');
    for (var i = 0; i < inputs.length; i++) {
      inputs[i].addEventListener('input', function () {
        this.style.borderColor = '';
      });
    }

    console.log('PhantomByte: form initialized — ' + funnel);
  }

  // ─── Page Load GA Events ─────────────────────────────────
  function trackPageView() {
    var page = document.body.getAttribute('data-page') || document.title;
    gaEvent('page_view', 'funnel', page);

    // If there's a time-on-page tracker, start it
    var startTime = Date.now();
    window.addEventListener('beforeunload', function () {
      var elapsed = Math.round((Date.now() - startTime) / 1000);
      gaEvent('time_on_page', 'funnel', page, elapsed);
    });
  }

  // ─── Auto-init all forms ─────────────────────────────────
  function initAll() {
    // Track page view
    trackPageView();

    // Init all funnel forms
    initFunnelForm('#funnel-form-playbook');
    initFunnelForm('#funnel-form-flowchart');
    initFunnelForm('#funnel-form-challenge');
    initFunnelForm('#funnel-form-audit');
    initFunnelForm('#contact-form');

    // CTA click tracking
    var ctaButtons = document.querySelectorAll('.cta-btn, .btn-primary, .btn-secondary');
    for (var i = 0; i < ctaButtons.length; i++) {
      (function (el) {
        el.addEventListener('click', function () {
          var label = el.textContent.trim().substring(0, 50);
          gaEvent('cta_click', 'funnel', label);
        });
      })(ctaButtons[i]);
    }

    // Cross-sell click tracking
    var crossSellLinks = document.querySelectorAll('[data-ga-action]');
    for (var j = 0; j < crossSellLinks.length; j++) {
      (function (el) {
        el.addEventListener('click', function () {
          var action = el.getAttribute('data-ga-action') || 'cross_sell_click';
          var label = el.getAttribute('data-ga-label') || el.textContent.trim().substring(0, 50);
          gaEvent(action, 'funnel', label);
        });
      })(crossSellLinks[j]);
    }
  }

  // ─── DOM Ready ───────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }
})();
