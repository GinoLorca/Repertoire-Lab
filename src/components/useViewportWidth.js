import { useEffect, useState } from 'react';

// Width of the page itself, updating on resize, for sizing chessboards.
// `clientWidth` rather than `innerWidth`: it leaves out the scrollbar, so a
// board sized from it can't push the page wider and start a feedback loop.
const pageWidth = () => document.documentElement.clientWidth || window.innerWidth;

export function useViewportWidth() {
  const [width, setWidth] = useState(pageWidth);
  useEffect(() => {
    const onResize = () => setWidth(pageWidth());
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);
  return width;
}

// Height of the page, the same way. A board that reads window.innerHeight
// while it renders keeps whatever it saw first: that value can briefly run
// hundreds of pixels tall while the page settles (a moment of sideways
// overflow zooms the view out), and nothing re-renders the board when it
// comes back. `clientHeight` is fixed by the viewport meta tag instead of
// the zoom, and this re-renders on resize.
const pageHeight = () => document.documentElement.clientHeight || window.innerHeight;

export function useViewportHeight() {
  const [height, setHeight] = useState(pageHeight);
  useEffect(() => {
    const onResize = () => setHeight(pageHeight());
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);
  return height;
}
