// Applies the saved theme before first paint to avoid a light/dark flash.
try {
  var t = localStorage.getItem('nilusdo.theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch (e) {}
