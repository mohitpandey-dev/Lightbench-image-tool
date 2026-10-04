/* Contact form: sends messages to the site owner's inbox via FormSubmit (no server needed).
   SETUP: put your real email below. The first message you send triggers a one-time
   activation email from FormSubmit; click the link in it, and every later message
   arrives in your inbox. */
(function () {
  var CONTACT_EMAIL = "mohitpandey0975@gmail.com";

  var loadedAt = Date.now();
  var lastSent = 0;
  var form = document.getElementById("contact-form");
  if (!form) return;
  var status = document.getElementById("contact-status");
  var btn = document.getElementById("contact-send");

  function show(msg, isError) {
    status.textContent = msg;
    status.classList.toggle("is-error", !!isError);
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    show("");
    var data = new FormData(form);
    if (data.get("_honey")) return; // bot trap
    if (Date.now() - loadedAt < 3000) { show("Please take a moment to check your message, then send it again.", true); return; } // bots submit instantly
    if (Date.now() - lastSent < 30000) { show("Please wait a little before sending another message.", true); return; }

    var name = (data.get("name") || "").trim();
    var email = (data.get("email") || "").trim();
    var message = (data.get("message") || "").trim();
    if (!name || !email || !message) {
      show("Please fill in your name, email and message.", true);
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      show("Please enter a valid email address.", true);
      return;
    }
    if (CONTACT_EMAIL.indexOf("YOUR_EMAIL") === 0) {
      show("The contact form is not set up yet.", true);
      return;
    }

    if (name.length > 120 || email.length > 200 || message.length > 5000) {
      show("That is too long. Keep your name under 120 characters and your message under 5000.", true);
      return;
    }
    lastSent = Date.now();
    var topic = data.get("topic") || "Other";
    btn.disabled = true;
    btn.textContent = "Sending...";

    fetch("https://formsubmit.co/ajax/" + encodeURIComponent(CONTACT_EMAIL), {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({
        name: name,
        email: email,
        topic: topic,
        message: message,
        _subject: "Lightbench: " + topic + " from " + name,
        _replyto: email,
        _template: "table",
        _captcha: "false"
      })
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (res.ok && String(res.j.success) === "true") {
          form.reset();
          show("Thank you. Your message has been sent and we will reply by email.");
        } else {
          throw new Error((res.j && res.j.message) || "Request failed");
        }
      })
      .catch(function () {
        show("Sorry, your message could not be sent. Please check your connection and try again.", true);
      })
      .then(function () {
        btn.disabled = false;
        btn.textContent = "Send message";
      });
  });
})();
