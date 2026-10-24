import React from 'react';
import { useStore } from '../store';
import {
  PROFILES, PROFILE_ORDER, SEQUENCE, SEQUENCE_NAMES, STRATEGIC, nextProfile, profileOf,
} from '../lib/arrowProfiles';

// "· Arrows: Sequential ●●●●…" at the end of a board's drawing hint: which
// arrow colour profile is on (lib/arrowProfiles.js), and a tap goes to the
// next one — as in Chess Arcade. All three texts sit stacked in one cell with
// only the active one showing, so the label is always as wide as the widest
// and switching never re-wraps the line under your finger.

const Dot = ({ color }) => <span className="pen-dot" style={{ background: color }} />;

function Text({ id }) {
  const head = <>Arrows: <span className="arrow-profile-name">{PROFILES[id].label}</span></>;
  if (id === 'sequential') {
    return <>{head} {SEQUENCE.slice(0, 4).map((c) => <Dot key={c} color={c} />)}…</>;
  }
  if (id === 'strategic') {
    return (
      <>
        {head} <Dot color={STRATEGIC.w} />W <Dot color={STRATEGIC.b} />B <Dot color={STRATEGIC.wx} /><Dot color={STRATEGIC.bx} />x
      </>
    );
  }
  return head;
}

export const profileTitle = (id) => {
  if (id === 'sequential') {
    return `Arrow colours follow the order you draw them on a position: ${SEQUENCE_NAMES.map((n, i) => `${i + 1} ${n}`).join(', ')}, then green again. A highlight takes the colour of the arrow before it.`;
  }
  if (id === 'strategic') {
    return 'Arrow colours follow the side: White green, Black blue; a White capture red, a Black capture yellow. A highlight takes the colour of the arrow before it.';
  }
  return 'Arrows use your pen colour.';
};

export default function ArrowProfileLabel() {
  const { state, dispatch } = useStore();
  const id = profileOf(state.settings);
  const next = nextProfile(id);
  return (
    <button
      type="button"
      className={`arrow-profile${id === 'default' ? ' is-default' : ''}`}
      title={`${profileTitle(id)} Tap for ${PROFILES[next].label}.`}
      aria-label={`Arrow colours: ${PROFILES[id].label}. Switch to ${PROFILES[next].label}`}
      // No focus left behind: the board's own keys (←, →, the pen keys)
      // keep going to the board.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => dispatch({ type: 'setSettings', settings: { arrowProfile: next } })}
    >
      {PROFILE_ORDER.map((p) => (
        <span key={p} className={`arrow-profile-pv${p === id ? ' on' : ''}`} aria-hidden={p !== id}>
          <span aria-hidden="true">· </span><Text id={p} />
        </span>
      ))}
    </button>
  );
}
