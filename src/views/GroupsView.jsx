import React, { useMemo, useState } from 'react';
import { useStore } from '../store';
import MoveText from '../components/MoveText';
import { isDue } from '../lib/srs';
import {
  StarIcon, TagIcon, ClockIcon, CheckIcon, PencilIcon, PlayIcon, CapIcon,
} from '../components/Icons';

// Every variation, with the tags and stars it inherits from its chapter and
// opening. Tagging or starring a container applies to everything inside it.
function flatten(state) {
  const rows = [];
  for (const opening of state.openings) {
    for (const chapter of opening.chapters) {
      for (const variation of chapter.variations) {
        rows.push({
          opening,
          chapter,
          variation,
          tags: [...new Set([
            ...(opening.tags ?? []),
            ...(chapter.tags ?? []),
            ...(variation.tags ?? []),
          ])],
          starred: !!(variation.starred || chapter.starred || opening.starred),
        });
      }
    }
  }
  return rows;
}

function Row({
  kind, title, crumbs, moves, badges, onOpen, onPractice, practiceTitle, onUntag, untagTitle, fading,
}) {
  return (
    <div className={`group-row group-row-${kind}${fading ? ' fading' : ''}`}>
      {onUntag && (
        <button
          className="tag-btn on row-untag"
          title={untagTitle}
          onClick={onUntag}
        >
          <TagIcon size={16} />
        </button>
      )}
      <button className="group-row-main" title="Open this in the library" onClick={onOpen}>
        <span className="group-row-name">
          <span className={`row-kind ${kind}`}>{kind}</span>
          {title}
        </span>
        {crumbs && <span className="group-row-crumbs">{crumbs}</span>}
        {moves && <span className="group-row-moves"><MoveText moves={moves} /></span>}
      </button>
      <span className="group-row-tail">
        {badges}
        <button className="small" title={practiceTitle} onClick={onPractice}>
          <PlayIcon size={14} />
        </button>
      </span>
    </div>
  );
}

function VariationRow({ row, onOpenChapter, onPractice, onUntag, untagTitle, fading }) {
  const { opening, chapter, variation } = row;
  return (
    <Row
      kind="line"
      onUntag={onUntag}
      untagTitle={untagTitle}
      fading={fading}
      title={variation.name}
      crumbs={`${opening.name} ▸ ${chapter.name}`}
      moves={variation.moves.slice(0, 10)}
      badges={(
        <>
          {variation.learned && !isDue(variation) && <CheckIcon size={14} className="done-tick" />}
          {isDue(variation) && <span className="due-pill"><ClockIcon size={13} /></span>}
        </>
      )}
      onOpen={() => onOpenChapter(opening.id, chapter.id)}
      onPractice={() => onPractice({
        openingId: opening.id,
        chapterId: chapter.id,
        variationId: variation.id,
        mode: 'practice',
      })}
      practiceTitle="Practice this line, then carry on through its chapter"
    />
  );
}

function ChapterRow({ opening, chapter, onOpenChapter, onPractice, onUntag, untagTitle, fading }) {
  return (
    <Row
      kind="chapter"
      onUntag={onUntag}
      untagTitle={untagTitle}
      fading={fading}
      title={chapter.name}
      crumbs={[opening.name, chapter.section, chapter.subsection].filter(Boolean).join(' ▸ ')}
      badges={<span className="muted-note">{chapter.variations.length} lines</span>}
      onOpen={() => onOpenChapter(opening.id, chapter.id)}
      onPractice={() => onPractice({ openingId: opening.id, chapterId: chapter.id, mode: 'practice' })}
      practiceTitle="Practice this whole chapter"
    />
  );
}

function OpeningRow({ opening, onPractice, onUntag, untagTitle, fading }) {
  const lines = opening.chapters.reduce((a, c) => a + c.variations.length, 0);
  return (
    <Row
      kind="opening"
      onUntag={onUntag}
      untagTitle={untagTitle}
      fading={fading}
      title={opening.name}
      crumbs={`${opening.chapters.length} chapters · you play ${opening.color}`}
      badges={<span className="muted-note">{lines} lines</span>}
      onOpen={() => onPractice({ openingId: opening.id, mode: 'practice' })}
      onPractice={() => onPractice({ openingId: opening.id, mode: 'practice' })}
      practiceTitle="Practice this whole opening"
    />
  );
}

function GroupBlock({ title, icon, count, subtitle, open, onToggle, onPracticeAll, canPractice, children }) {
  return (
    <div className={`group-block${open ? ' open' : ''}`}>
      <div className="group-head" onClick={onToggle}>
        <button className="collapse-btn">{open ? '▾' : '▸'}</button>
        {icon}
        <h2>{title}</h2>
        <span className="group-count">{count}</span>
        <span style={{ flex: 1 }} />
        {subtitle && <span className="muted-note">{subtitle}</span>}
        <button
          className="small primary"
          disabled={!canPractice}
          onClick={(e) => { e.stopPropagation(); onPracticeAll(); }}
        >
          <PlayIcon size={14} /> Practice all
        </button>
      </div>
      {open && <div className="group-body">{children}</div>}
    </div>
  );
}

// A labelled run of rows inside a group — "Openings", "Chapters", "Lines".
function SubList({ label, children, count }) {
  if (!count) return null;
  return (
    <div className="group-sublist">
      <div className="group-sublist-head">{label} <span className="group-sublist-count">{count}</span></div>
      {children}
    </div>
  );
}

export default function GroupsView({ onOpenChapter, onPractice }) {
  const { state, dispatch } = useStore();
  const [openKeys, setOpenKeys] = useState({ __fav: true });
  const [filter, setFilter] = useState('');
  const [fading, setFading] = useState({});

  const rows = useMemo(() => flatten(state), [state]);

  // Favorites, split by what was actually starred. A line inside a starred
  // chapter is covered by that chapter's entry rather than listed twice.
  const favorites = useMemo(() => {
    const openings = state.openings.filter((o) => o.starred);
    const chapters = [];
    const variations = [];
    for (const opening of state.openings) {
      for (const chapter of opening.chapters) {
        if (chapter.starred && !opening.starred) chapters.push({ opening, chapter });
        for (const variation of chapter.variations) {
          if (variation.starred && !chapter.starred && !opening.starred) {
            variations.push({ opening, chapter, variation });
          }
        }
      }
    }
    return { openings, chapters, variations };
  }, [state.openings]);

  const favCount = rows.filter((r) => r.starred).length;

  // One group per tag, listing whatever carries it — openings, chapters, lines.
  const tagGroups = useMemo(() => {
    const map = new Map();
    const bucket = (tag) => {
      if (!map.has(tag)) map.set(tag, { openings: [], chapters: [], variations: [], lines: 0 });
      return map.get(tag);
    };
    for (const opening of state.openings) {
      for (const tag of opening.tags ?? []) bucket(tag).openings.push(opening);
      for (const chapter of opening.chapters) {
        for (const tag of chapter.tags ?? []) bucket(tag).chapters.push({ opening, chapter });
        for (const variation of chapter.variations) {
          for (const tag of variation.tags ?? []) {
            bucket(tag).variations.push({ opening, chapter, variation });
          }
        }
      }
    }
    for (const row of rows) {
      for (const tag of row.tags) bucket(tag).lines += 1;
    }
    return [...map.entries()]
      .sort((a, b) => b[1].lines - a[1].lines || a[0].localeCompare(b[0]))
      .map(([tag, items]) => ({ tag, ...items }));
  }, [rows, state.openings]);

  const visibleTags = filter.trim()
    ? tagGroups.filter(({ tag }) => tag.toLowerCase().includes(filter.trim().toLowerCase()))
    : tagGroups;

  const toggle = (key) => setOpenKeys((o) => ({ ...o, [key]: !o[key] }));
  const untagged = rows.filter((r) => r.tags.length === 0).length;

  // Taking something out of a group: fade the row first so you can see which
  // one left, then drop the tag.
  const removeFromGroup = (tag, target) => {
    const key = `${tag}:${target.id}`;
    setFading((f) => ({ ...f, [key]: true }));
    setTimeout(() => {
      const without = (tags) => (tags ?? []).filter((t) => t !== tag);
      if (target.kind === 'opening') {
        dispatch({ type: 'setOpeningTags', openingId: target.openingId, tags: without(target.tags) });
      } else if (target.kind === 'chapter') {
        dispatch({
          type: 'setChapterTags',
          openingId: target.openingId,
          chapterId: target.chapterId,
          tags: without(target.tags),
        });
      } else {
        dispatch({
          type: 'setVariationTags',
          openingId: target.openingId,
          chapterId: target.chapterId,
          variationId: target.variationId,
          tags: without(target.tags),
        });
      }
      setFading((f) => { const next = { ...f }; delete next[key]; return next; });
    }, 420);
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>Groups</h1>
        <span className="muted-note">
          Favorites and tags, gathered from every opening, chapter and variation
        </span>
        <span style={{ flex: 1 }} />
        {tagGroups.length > 0 && (
          <input
            type="text"
            className="group-filter"
            placeholder="Filter groups…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        )}
      </div>

      <GroupBlock
        title="Favorites"
        icon={<StarIcon size={17} filled className="group-icon star" />}
        count={favCount}
        subtitle="lines covered"
        open={!!openKeys.__fav}
        onToggle={() => toggle('__fav')}
        canPractice={favCount > 0}
        onPracticeAll={() => onPractice({ starred: true, mode: 'practice' })}
      >
        {favCount === 0 ? (
          <div className="empty-note">
            Nothing starred yet — use the star on an opening, a chapter card, or a variation.
            Starring an opening or chapter covers everything inside it.
          </div>
        ) : (
          <>
            <SubList label="Openings" count={favorites.openings.length}>
              {favorites.openings.map((opening) => (
                <OpeningRow key={opening.id} opening={opening} onPractice={onPractice} />
              ))}
            </SubList>
            <SubList label="Chapters" count={favorites.chapters.length}>
              {favorites.chapters.map(({ opening, chapter }) => (
                <ChapterRow
                  key={chapter.id}
                  opening={opening}
                  chapter={chapter}
                  onOpenChapter={onOpenChapter}
                  onPractice={onPractice}
                />
              ))}
            </SubList>
            <SubList label="Variations" count={favorites.variations.length}>
              {favorites.variations.map((row) => (
                <VariationRow
                  key={row.variation.id}
                  row={row}
                  onOpenChapter={onOpenChapter}
                  onPractice={onPractice}
                />
              ))}
            </SubList>
          </>
        )}
      </GroupBlock>

      {tagGroups.length === 0 && (
        <div className="empty-note">
          No tags yet. Use the tag button on an opening, chapter or variation to group lines under a
          nickname like “bishop trapping plan” — they show up here, wherever they live.
        </div>
      )}

      {visibleTags.map(({ tag, openings, chapters, variations, lines }) => (
        <GroupBlock
          key={tag}
          title={tag}
          icon={<TagIcon size={17} className="group-icon" />}
          count={lines}
          subtitle="lines covered"
          open={!!openKeys[tag]}
          onToggle={() => toggle(tag)}
          canPractice={lines > 0}
          onPracticeAll={() => onPractice({ tag, mode: 'practice' })}
        >
          <div className="group-actions">
            <button
              className="small ghost"
              title="Rename this tag everywhere it's used"
              onClick={() => {
                const name = window.prompt(`Rename “${tag}” everywhere:`, tag);
                if (name?.trim() && name.trim() !== tag) {
                  dispatch({ type: 'renameTag', from: tag, to: name.trim() });
                }
              }}
            >
              <PencilIcon size={14} /> Rename group
            </button>
            <button
              className="small ghost"
              title="Learn mode — moves shown first, then recalled"
              onClick={() => onPractice({ tag, mode: 'learn' })}
            >
              <CapIcon size={14} /> Learn these
            </button>
          </div>

          <SubList label="Openings" count={openings.length}>
            {openings.map((opening) => (
              <OpeningRow
                key={`${tag}-${opening.id}`}
                opening={opening}
                onPractice={onPractice}
                fading={!!fading[`${tag}:${opening.id}`]}
                untagTitle={`Remove “${opening.name}” from ${tag}`}
                onUntag={() => removeFromGroup(tag, {
                  kind: 'opening', id: opening.id, openingId: opening.id, tags: opening.tags,
                })}
              />
            ))}
          </SubList>
          <SubList label="Chapters" count={chapters.length}>
            {chapters.map(({ opening, chapter }) => (
              <ChapterRow
                key={`${tag}-${chapter.id}`}
                opening={opening}
                chapter={chapter}
                onOpenChapter={onOpenChapter}
                onPractice={onPractice}
                fading={!!fading[`${tag}:${chapter.id}`]}
                untagTitle={`Remove “${chapter.name}” from ${tag}`}
                onUntag={() => removeFromGroup(tag, {
                  kind: 'chapter', id: chapter.id, openingId: opening.id, chapterId: chapter.id, tags: chapter.tags,
                })}
              />
            ))}
          </SubList>
          <SubList label="Variations" count={variations.length}>
            {variations.map((row) => (
              <VariationRow
                key={`${tag}-${row.variation.id}`}
                row={row}
                onOpenChapter={onOpenChapter}
                onPractice={onPractice}
                fading={!!fading[`${tag}:${row.variation.id}`]}
                untagTitle={`Remove “${row.variation.name}” from ${tag}`}
                onUntag={() => removeFromGroup(tag, {
                  kind: 'variation',
                  id: row.variation.id,
                  openingId: row.opening.id,
                  chapterId: row.chapter.id,
                  variationId: row.variation.id,
                  tags: row.variation.tags,
                })}
              />
            ))}
          </SubList>
        </GroupBlock>
      ))}

      {untagged > 0 && (
        <div className="muted-note" style={{ marginTop: 14 }}>
          {untagged} variation{untagged === 1 ? '' : 's'} not in any group yet.
        </div>
      )}
    </div>
  );
}
