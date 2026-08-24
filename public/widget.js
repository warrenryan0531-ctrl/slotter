/* Slotter embed widget.
 * Usage: <script src="https://YOUR-HOST/widget.js" data-tenant="SLUG" async></script>
 * Injects an auto-resizing iframe where the script tag sits.
 */
(function () {
  var script = document.currentScript;
  if (!script) return;
  var tenant = script.getAttribute("data-tenant");
  if (!tenant) return;
  var hub = new URL(script.src).origin;
  var iframe = document.createElement("iframe");
  iframe.src = hub + "/embed/" + encodeURIComponent(tenant);
  iframe.style.width = "100%";
  iframe.style.border = "0";
  iframe.style.minHeight = "480px";
  iframe.style.display = "block";
  iframe.setAttribute("title", "Book an appointment");
  iframe.setAttribute("loading", "lazy");
  script.parentNode.insertBefore(iframe, script);
  window.addEventListener("message", function (e) {
    // inbound origin check (resolution #11): only trust the hub
    if (e.origin !== hub) return;
    if (e.data && e.data.type === "slotter:resize" && typeof e.data.height === "number") {
      iframe.style.height = Math.max(320, Math.min(4000, e.data.height)) + "px";
    }
  });
})();
