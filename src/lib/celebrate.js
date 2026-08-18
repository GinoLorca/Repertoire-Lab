import confetti from 'canvas-confetti';

// Chess.com-checkmate-style celebration: confetti bursts from both bottom
// corners of the board, angled inward, plus a delayed center pop.
// `boardEl` anchors the bursts to the board; falls back to the viewport.
// intensity: 1 = full (perfect line), 0.4 = light (perfect drill rep).
// canvas-confetti builds its canvas and starts a worker on the very first
// burst, which costs enough to be seen as a delay. Doing it early — when a
// session opens — means the burst itself is immediate when it matters.
let warmed = false;
export function warmUpConfetti() {
  if (warmed) return;
  warmed = true;
  try {
    // One real particle, one tick, off the bottom of the screen: asking for
    // zero particles is a no-op, so nothing would get built and the first true
    // burst would still pay for the canvas and the worker.
    confetti({
      particleCount: 1,
      ticks: 1,
      startVelocity: 0,
      gravity: 0,
      scalar: 0.01,
      origin: { x: 0.5, y: 2 },
    });
  } catch { /* best effort */ }
}

export function celebrate(boardEl, intensity = 1) {
  let left = { x: 0.25, y: 0.85 };
  let right = { x: 0.75, y: 0.85 };
  let center = { x: 0.5, y: 0.55 };
  const rect = boardEl?.getBoundingClientRect();
  if (rect && rect.width > 0) {
    const vx = (px) => Math.min(1, Math.max(0, px / window.innerWidth));
    const vy = (py) => Math.min(1, Math.max(0, py / window.innerHeight));
    left = { x: vx(rect.left + rect.width * 0.1), y: vy(rect.top + rect.height * 0.9) };
    right = { x: vx(rect.left + rect.width * 0.9), y: vy(rect.top + rect.height * 0.9) };
    center = { x: vx(rect.left + rect.width * 0.5), y: vy(rect.top + rect.height * 0.45) };
  }

  // Short and quick: the card with the next step appears immediately now, and a
  // celebration still hanging in the air over it reads as lag.
  const defaults = {
    ticks: 110,
    gravity: 1.5,
    decay: 0.89,
    startVelocity: 46,
    zIndex: 200,
    colors: ['#3b9cff', '#2ecc71', '#e8b339', '#e9ecf2', '#ff7eb6', '#9b6bff'],
  };
  const n = (base) => Math.max(8, Math.floor(base * intensity));

  confetti({ ...defaults, particleCount: n(70), spread: 60, angle: 55, origin: left });
  confetti({ ...defaults, particleCount: n(70), spread: 60, angle: 125, origin: right });
  // All three at once. The centre pop used to follow the corners by a beat,
  // which read as a second, late celebration rather than one.
  if (intensity >= 1) {
    confetti({
      ...defaults,
      particleCount: n(50),
      spread: 100,
      startVelocity: 30,
      scalar: 0.9,
      origin: center,
    });
  }
}
