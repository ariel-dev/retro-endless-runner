// Show landscape warning as inline text under the Start Game button if in portrait mode on a phone
function checkLandscapeWarning() {
  const warning = document.getElementById('landscapeWarning');
  if (!warning) return;
  const isPortrait = window.matchMedia('(orientation: portrait)').matches;
  const isMobile = window.innerWidth < 900;
  warning.style.display = (isPortrait && isMobile) ? 'block' : 'none';
}
window.addEventListener('resize', checkLandscapeWarning);
window.addEventListener('orientationchange', checkLandscapeWarning);
document.addEventListener('DOMContentLoaded', checkLandscapeWarning);
