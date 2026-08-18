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
