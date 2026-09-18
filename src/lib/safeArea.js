// How much of the window the system is sitting on top of.
//
// `viewport-fit=cover` hands the app the whole screen, including the strip an
// iPad's menu bar occupies and the one iOS keeps for the status bar. CSS
// handles most of it by padding things away from the edges (see --safe-top and
// friends in styles.css), but a board sized in JavaScript has to know too:
// window.innerHeight counts space the app can't actually use, so a board that
// fills it ends up underneath the menu bar.
//
// Read from the custom property rather than env() directly — a custom property
// holding an env() resolves to pixels, and reading one costs nothing. Anywhere
// without insets it's 0 and every caller is left exactly as it was.
function inset(name) {
  if (typeof document === 'undefined') return 0;
  const px = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue(name),
  );
  return Number.isFinite(px) ? px : 0;
}

export const topInset = () => inset('--safe-top');
export const bottomInset = () => inset('--safe-bottom');
export const leftInset = () => inset('--safe-left');
export const rightInset = () => inset('--safe-right');
