// A chapter's videos, as a stack (lib/chapterVideos.js).
//
// A chapter put together from more than one course has more than one video.
// They aren't laid out one under another: the one you're watching is in
// front, playing, and the others stand behind it like cards — each showing
// its name on the edge that sticks out. Press one and the two change places:
// they draw apart side by side, and come back together the other way round.
//
// Only the video in front is a player (components/ChapterVideo.jsx, one at a
// time: no two films talking at once, and no second YouTube frame loaded for
// a card nobody is watching). Each remembers where you left off on its own
// (lib/videoSpots.js is by video), so coming back to one picks it up there.
// Which one is in front is remembered per chapter on this device.
//
// With one video this is that one player and nothing else, exactly as a
// chapter's video has always looked — plus, under it, the strip to add
// another.
//
// The rest of the page reaches in through the ref:
//   seekTo(seconds, videoId)  a line's own moment — its video comes to the
//                             front first, if it isn't there
//   getCurrentTime()          where the video in front is
//   frontId()                 which video that is ("link this line here")
//   openAdd('upload' | 'url') the add strip, from the phone's ⋯ sheet
import React, {
  forwardRef, useEffect, useImperativeHandle, useRef, useState,
} from 'react';
import ChapterVideo from './ChapterVideo';
import {
  frontFor, keepFront, videoLabel, videoPoster, videoSource,
} from '../lib/chapterVideos';

// How long the two cards take to change places (styles.css: cv-to-front,
// cv-to-back). No time at all for someone who has asked for less motion.
const SWAP_MS = 620;
const calm = () => {
  try { return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false; } catch { return false; }
};
// As many cards as are drawn behind the one in front; with more videos than
// that, every one is also listed by name above the stack.
const BEHIND_MAX = 3;

const ChapterVideos = forwardRef(({
  chapterId, videos, onAdd, onReplace, onRemove, onCloud, onTitle, hideEmpty = false,
}, ref) => {
  const list = videos ?? [];
  const [frontId, setFrontId] = useState(() => frontFor(chapterId, list));
  // A line's moment asked for in a video that wasn't in front: it opens there.
  const [opening, setOpening] = useState(null); // { id, at }
  // The swap being played: which card is coming forward (and from how far
  // back), which has just gone back.
  const [swap, setSwap] = useState(null); // { to, from, was }
  // What a video was showing when it went to the back: its card's picture.
  const [stills, setStills] = useState({}); // { [videoId]: data URL }
  const swapTimer = useRef(0);
  const playerRef = useRef(null);
  const adderRef = useRef(null);
  const adderBox = useRef(null);

  // Another chapter: its own front.
  const chapterRef = useRef(chapterId);
  useEffect(() => {
    if (chapterRef.current === chapterId) return;
    chapterRef.current = chapterId;
    setFrontId(frontFor(chapterId, list));
    setOpening(null);
    setSwap(null);
    setStills({});
  }, [chapterId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => clearTimeout(swapTimer.current), []);

  // The one in front, as long as it's still one of the chapter's (it may
  // have been removed here, or on another device).
  const front = list.find((v) => v.id === frontId) ?? list[0] ?? null;
  const behind = front ? list.filter((v) => v.id !== front.id) : [];

  // (`isNew`: one just added, which this render's list doesn't have yet.)
  const bringFront = (id, at = null, isNew = false) => {
    if (!isNew && !list.some((v) => v.id === id)) return;
    setOpening(at != null ? { id, at } : null);
    if (front && id === front.id) return;
    keepFront(chapterId, id);
    clearTimeout(swapTimer.current);
    if (front) {
      // The frame it's on goes with it to the back.
      const still = playerRef.current?.snapshot?.() ?? null;
      if (still) setStills((s) => ({ ...s, [front.id]: still }));
    }
    if (front && !calm()) {
      // (Its place among the cards: 1 is right behind the front. One that
      // had no card — just added, or past the last drawn — comes from 1.)
      const was = Math.min(BEHIND_MAX, behind.findIndex((v) => v.id === id) + 1) || 1;
      setSwap({ to: id, from: front.id, was });
      swapTimer.current = setTimeout(() => setSwap(null), SWAP_MS + 80);
    } else {
      setSwap(null);
    }
    setFrontId(id);
  };

  useImperativeHandle(ref, () => ({
    seekTo(seconds, videoId = null) {
      const id = videoId ?? front?.id;
      if (!front || id === front.id) { playerRef.current?.seekTo(seconds); return; }
      bringFront(id, seconds);
    },
    getCurrentTime: () => playerRef.current?.getCurrentTime?.() ?? 0,
    frontId: () => front?.id ?? null,
    openAdd(which) {
      (list.length ? adderRef : playerRef).current?.openAdd(which);
      // (Under the stack, which on a phone may be a screen away.)
      requestAnimationFrame(() => adderBox.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' }));
    },
  })); // (afresh each time: it speaks for the videos as they are now)

  // No video yet: the one strip that adds the first, as ever.
  if (!front) {
    return (
      <div ref={adderBox}>
        <ChapterVideo ref={playerRef} video={null} onChange={(v) => v && onAdd(v)} onCloud={onCloud} hideEmpty={hideEmpty} />
      </div>
    );
  }

  const many = list.length > 1;
  const indexOf = (v) => list.findIndex((x) => x.id === v.id);
  const cards = behind.slice(0, BEHIND_MAX);
  const cardsBehind = many ? cards.map((v, i) => {
    const picture = stills[v.id] ?? videoPoster(v);
    const name = videoLabel(v, indexOf(v));
    return (
      <button
        key={v.id}
        type="button"
        className={`cv-back${swap?.from === v.id ? ' cv-just-back' : ''}${picture ? ' pictured' : ''}`}
        // (How far back it stands: 1 is right behind the one in front.)
        style={{ '--i': i + 1, zIndex: 4 - i }}
        title={`Bring “${name}” to the front (${videoSource(v)})`}
        aria-label={`Bring ${name} to the front`}
        onClick={() => bringFront(v.id)}
      >
        {picture && <span className="cv-back-poster" style={{ backgroundImage: `url("${picture}")` }} aria-hidden="true" />}
        <span className="cv-back-shade" aria-hidden="true" />
        <span className="cv-back-tab">
          <span className="cv-back-n">{indexOf(v) + 1}</span>
          <span className="cv-back-name">{name}</span>
          <span className="cv-back-swap" aria-hidden="true">⇄ swap</span>
        </span>
      </button>
    );
  }) : null;

  return (
    <div className={`cv-deck${many ? ' many' : ''}`}>
      {/* More videos than there are cards behind: every one by name, the one
          in front marked, any other a press away. (With fewer, the cards
          themselves are the names.) */}
      {behind.length > BEHIND_MAX && (
        <div className="cv-names" role="group" aria-label="This chapter’s videos">
          {list.map((v, i) => (
            <button
              key={v.id}
              type="button"
              aria-pressed={v.id === front.id}
              className={`small cv-name-tab${v.id === front.id ? ' on' : ''}`}
              title={v.id === front.id ? `${videoLabel(v, i)} — in front (${videoSource(v)})` : `Bring “${videoLabel(v, i)}” to the front (${videoSource(v)})`}
              onClick={() => bringFront(v.id)}
            >
              <span className="cv-back-n">{i + 1}</span>
              <span className="cv-back-name">{videoLabel(v, i)}</span>
            </button>
          ))}
        </div>
      )}
      <ChapterVideo
        // One player per video: its own spot, its own file, its own state.
        key={front.id}
        ref={playerRef}
        video={front}
        startAt={opening?.id === front.id ? opening.at : null}
        behind={cardsBehind}
        // (Room for the cards behind: one step per card.)
        stackClass={many ? `many layers-${cards.length}${swap?.to === front.id ? ` cv-swapping from-${swap.was}` : ''}` : ''}
        number={many ? indexOf(front) + 1 : null}
        label={many || front.title ? videoLabel(front, indexOf(front)) : null}
        onRename={(title) => onTitle(front.id, title)}
        removeText={many
          ? 'Remove this video from the chapter? Lines linked to a moment in it lose that link. The chapter’s other videos stay.'
          : null}
        // Replaced: the new one stays where the old one was — in front.
        onChange={(v) => {
          if (!v) { onRemove(front.id); return; }
          onReplace(front.id, v);
          keepFront(chapterId, v.id);
          setOpening(null);
          setSwap(null);
          setFrontId(v.id);
        }}
        onCloud={onCloud}
      />
      {/* Another video for this chapter: a second course's, a second part. */}
      <div ref={adderBox}>
        <ChapterVideo
          key="another"
          ref={adderRef}
          video={null}
          another
          hideEmpty={hideEmpty}
          // …and it comes to the front, to be seen (and named).
          onChange={(v) => { if (v) { onAdd(v); bringFront(v.id, null, true); } }}
          onCloud={onCloud}
        />
      </div>
    </div>
  );
});

export default ChapterVideos;
