/* resolve the saved theme before first paint - a classic script in <head> */
(function () {
  var p = 'system';
  try { p = localStorage.getItem('pv-theme') || 'system'; } catch (e) {}
  var light = p === 'light' || (p !== 'dark' && matchMedia('(prefers-color-scheme: light)').matches);
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
})();
