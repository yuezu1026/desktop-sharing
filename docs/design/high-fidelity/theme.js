/** 亮/暗主题切换。各高保真页共用。 */
(function () {
  var storageKey = "rd-hf-theme";
  var root = document.documentElement;

  function applyTheme(theme) {
    if (theme === "dark") {
      root.setAttribute("data-theme", "dark");
    } else {
      root.removeAttribute("data-theme");
      theme = "light";
    }
    try {
      localStorage.setItem(storageKey, theme);
    } catch (_error) {}
    document.querySelectorAll("[data-theme-label]").forEach(function (node) {
      node.textContent = theme === "dark" ? "亮色" : "暗色";
    });
  }

  function currentTheme() {
    return root.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }

  var saved = null;
  try {
    saved = localStorage.getItem(storageKey);
  } catch (_error) {}
  applyTheme(saved === "dark" ? "dark" : "light");

  document.addEventListener("click", function (event) {
    var target = event.target;
    if (!(target instanceof Element)) return;
    var button = target.closest("[data-theme-toggle]");
    if (!button) return;
    applyTheme(currentTheme() === "dark" ? "light" : "dark");
  });
})();
