import React, { useEffect, useMemo, useState } from 'react';
import { movetextToLines, validateLine, movesToMovetext } from '../lib/pgn';
import MoveText from './MoveText';
import ScoresheetPhoto from './ScoresheetPhoto';
import { EVENT_TYPES, RESULTS, categoryOptions, tidyEvent } from '../lib/games';
import { useBackGuard } from '../lib/backGuard';

const todayIso = () => new Date().toISOString().slice(0, 10);

// Pull what we can out of a pasted PGN's tag pairs, so a copied game fills the
// form in rather than making you retype it.
function readTags(text) {
  const tags = {};
  const re = /\[(\w+)\s+"([^"]*)"\]/g;
  let m = re.exec(text);
  while (m) {
    tags[m[1]] = m[2];
    m = re.exec(text);
  }
  return tags;
}

const guessEventType = (tags) => {
  const site = `${tags.Site ?? ''} ${tags.Event ?? ''}`.toLowerCase();
  if (site.includes('chess.com')) return 'chess.com';
  if (site.includes('lichess')) return 'lichess';
  return null;
};

// Type a game in by hand (an OTB scoresheet) or paste a PGN.
export default function GameEditor({ initial, state, player, onSave, onClose }) {
  const m0 = initial?.meta ?? {};

  // Whoever this section belongs to is usually one of the two players — fill
  // their side in with the handle that matches where the game was played.
  const handleFor = (type) => {
    const p = player?.profile ?? {};
    if (type === 'chess.com' && p.chesscom) return p.chesscom;
    if (type === 'lichess' && p.lichess) return p.lichess;
    return player?.name ?? '';
  };
  // Rebuilt as real movetext, not a bare join — the annotated moves (Studio's
  // badges, any comments) have to survive this round trip through the text
  // box the same way a pasted PGN's would, since `parsed` below reads them
  // back out by re-parsing whatever's here. A plain `.join(' ')` was silently
  // the reason nothing carried through: it had nothing for movetextToLines to
  // find, however annotated the original board was.
  const [text, setText] = useState(initial
    ? movesToMovetext(initial.moves, initial.comments, initial.badges)
    : '');
  const [white, setWhite] = useState(m0.white ?? '');
  const [whiteElo, setWhiteElo] = useState(m0.whiteElo ?? '');
  const [black, setBlack] = useState(m0.black ?? '');
  const [blackElo, setBlackElo] = useState(m0.blackElo ?? '');
  const [event, setEvent] = useState(m0.event ?? '');
  const [eventType, setEventType] = useState(m0.eventType ?? 'otb');
  const [round, setRound] = useState(m0.round ?? '');
  const [result, setResult] = useState(m0.result ?? '*');
  const [color, setColor] = useState(m0.color ?? 'white');
  // Shown as it was when the game was played; editing it belongs on the
  // player's own profile, not on one game.
  const [rating] = useState(player?.profile?.rating ?? '');
  const [date, setDate] = useState(m0.date ?? todayIso());
  const [timeControl, setTimeControl] = useState(m0.timeControl ?? '');
  const [notes, setNotes] = useState(m0.notes ?? '');
  const [categoryId, setCategoryId] = useState(m0.categoryId ?? '');
  const [photo, setPhoto] = useState(m0.photo ?? null);

  useBackGuard(true, onClose);

  // Only for a game being created — never overwrite what's already saved.
  const [pasted, setPasted] = useState(false); // a PGN's own names take over
  const isNew = !initial?.id;
  const mine = handleFor(eventType);
  useEffect(() => {
    if (!isNew || !mine || pasted) return;
    if (color === 'white') {
      setWhite((w) => (w && w !== handleFor('otb') && w !== player?.profile?.chesscom && w !== player?.profile?.lichess ? w : mine));
      if (!whiteElo && rating) setWhiteElo(rating);
    } else if (color === 'black') {
      setBlack((b) => (b && b !== handleFor('otb') && b !== player?.profile?.chesscom && b !== player?.profile?.lichess ? b : mine));
      if (!blackElo && rating) setBlackElo(rating);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, mine, color, pasted]);

  const categories = useMemo(() => (state ? categoryOptions(state) : []), [state]);
  const grouped = useMemo(() => {
    const map = new Map();
    for (const c of categories) {
      if (!map.has(c.group)) map.set(c.group, []);
      map.get(c.group).push(c);
    }
    return [...map.entries()];
  }, [categories]);

  const parsed = useMemo(() => {
    if (!text.trim()) return null;
    const lines = movetextToLines(text);
    if (!lines.length) return { error: 'No moves found in that text.' };
    const line = validateLine(lines[0].moves);
    if (line.moves.length === 0) {
      return { error: `Couldn't read a legal game — stuck at “${line.failedToken}”.` };
    }
    return {
      moves: line.moves,
      comments: lines[0].comments ?? {},
      badges: lines[0].badges ?? {},
      warning: line.ok ? null : `Ignored everything from “${line.failedToken}”.`,
    };
  }, [text]);

  // Pasting a full PGN fills in the players, event and result for you.
  const onPasteText = (value) => {
    setText(value);
    const tags = readTags(value);
    if (Object.keys(tags).length > 0) setPasted(true);
    // The PGN is the record of what happened — its names beat anything already
    // filled in from the player's profile.
    if (tags.White) setWhite(tags.White);
    if (tags.Black) setBlack(tags.Black);
    if (tags.WhiteElo) setWhiteElo(tags.WhiteElo);
    if (tags.BlackElo) setBlackElo(tags.BlackElo);

    // Which side was this player on? Match the handles we know them by.
    const known = [player?.name, player?.profile?.chesscom, player?.profile?.lichess]
      .filter(Boolean).map((n) => n.toLowerCase());
    const isMine = (n) => !!n && known.includes(n.toLowerCase());
    if (isMine(tags.Black) && !isMine(tags.White)) setColor('black');
    else if (isMine(tags.White) && !isMine(tags.Black)) setColor('white');

    const kindFromTags = guessEventType(tags);
    if (tags.Event) setEvent(tidyEvent(tags.Event, kindFromTags ?? eventType));
    if (tags.Round && !round) setRound(tags.Round);
    if (tags.TimeControl && !timeControl) setTimeControl(tags.TimeControl);
    if (kindFromTags) setEventType(kindFromTags);
    const tagResult = tags.Result === '1/2-1/2' ? '½-½' : tags.Result;
    if (tagResult && RESULTS.includes(tagResult)) setResult(tagResult);
    if (tags.Date && /^\d{4}\.\d{2}\.\d{2}$/.test(tags.Date)) setDate(tags.Date.replace(/\./g, '-'));
  };

  const onEventType = (value) => {
    setEventType(value);
    setEvent((e) => tidyEvent(e, value));
  };

  const name = `${white || 'White'} vs ${black || 'Black'}`;

  // No time to transcribe right now? A photo alone is still worth keeping —
  // it archives to the profile and can be typed in or scanned later.
  const canSave = !!parsed?.moves || !!photo;

  const save = () => {
    if (!canSave) return;
    onSave({
      name,
      moves: parsed?.moves ?? [],
      comments: parsed?.comments ?? {},
      badges: parsed?.badges ?? {},
      date: date ? new Date(date).getTime() : Date.now(),
      meta: {
        white, whiteElo, black, blackElo,
        event, eventType, round, result, color, date, timeControl, notes,
        categoryId: categoryId || null,
        photo,
      },
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal game-editor" onClick={(e) => e.stopPropagation()}>
        <h3>{initial?.id ? 'Edit game' : 'Add a game'}</h3>
        <p className="hint">
          Type the moves from your scoresheet, or paste a PGN — names, ratings, event and result are
          read out of the tags when they're there.
        </p>

        <div className="game-fields">
          <label>
            White
            <div className="field-pair">
              <input type="text" value={white} placeholder="Name" onChange={(e) => setWhite(e.target.value)} />
              <input
                type="text" className="elo" inputMode="numeric" value={whiteElo}
                placeholder="Elo" onChange={(e) => setWhiteElo(e.target.value)}
              />
            </div>
          </label>
          <label>
            Black
            <div className="field-pair">
              <input type="text" value={black} placeholder="Name" onChange={(e) => setBlack(e.target.value)} />
              <input
                type="text" className="elo" inputMode="numeric" value={blackElo}
                placeholder="Elo" onChange={(e) => setBlackElo(e.target.value)}
              />
            </div>
          </label>
          <label>
            Where
            <select value={eventType} onChange={(e) => onEventType(e.target.value)}>
              {EVENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>
          <label>
            Event
            <input
              type="text" value={event}
              placeholder={eventType === 'otb' ? 'Club night, open, league…' : 'Rapid 10+0, Titled Tuesday…'}
              onChange={(e) => setEvent(e.target.value)}
            />
          </label>
          <label>Round<input type="text" value={round} placeholder="e.g. 3" onChange={(e) => setRound(e.target.value)} /></label>
          <label>Time control<input type="text" value={timeControl} placeholder="90+30, 10+0…" onChange={(e) => setTimeControl(e.target.value)} /></label>
          <label>Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label>
            Result
            <select value={result} onChange={(e) => setResult(e.target.value)}>
              {RESULTS.map((r) => <option key={r} value={r}>{r === '*' ? 'unfinished' : r}</option>)}
            </select>
          </label>
          <label>
            You played
            <select value={color} onChange={(e) => setColor(e.target.value)}>
              <option value="white">White</option>
              <option value="black">Black</option>
              <option value="none">Neither (someone else's game)</option>
            </select>
          </label>
          <label>
            Category
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Automatic (from your repertoire)</option>
              {grouped.map(([group, items]) => (
                <optgroup key={group} label={group}>
                  {items.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
        </div>

        <textarea
          rows={5}
          value={text}
          placeholder="1.e4 c6 2.d4 d5 3.Nc3 dxe4 4.Nxe4 Bf5 …"
          onChange={(e) => onPasteText(e.target.value)}
        />

        <div className="status-line" style={{ minHeight: 24 }}>
          {parsed?.error && <span className="status-bad">✗ {parsed.error}</span>}
          {parsed?.moves && (
            <span className="status-ok">
              ✓ {parsed.moves.length} moves read{parsed.warning ? ` · ${parsed.warning}` : ''}
            </span>
          )}
        </div>

        <div className="scoresheet-attach-row">
          <ScoresheetPhoto photo={photo} onChange={setPhoto} />
          <span className="hint" style={{ margin: 0 }}>
            {photo
              ? 'Photo archived to this game — type or scan the moves in whenever there’s time.'
              : 'No time to transcribe? Attach a photo of the scoresheet and come back to it later.'}
          </span>
        </div>
        {parsed?.moves && (
          <div className="cmp-paste-preview">
            <MoveText moves={parsed.moves.slice(0, 30)} />
            {parsed.moves.length > 30 && <span className="muted-note"> …</span>}
          </div>
        )}

        <label className="game-notes">
          Notes on the game
          <textarea
            rows={3}
            value={notes}
            placeholder="What went wrong, what to review, time trouble, the plan you missed…"
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>

        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!canSave} onClick={save}>
            {initial?.id ? 'Save changes' : (parsed?.moves ? 'Save game' : 'Archive photo')}
          </button>
        </div>
      </div>
    </div>
  );
}
