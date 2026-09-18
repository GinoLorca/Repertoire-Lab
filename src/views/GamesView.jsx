import React from 'react';
import PlayerRoster from '../components/PlayerRoster';

// Your own games — students live in the Coaches tab instead.
export default function GamesView({ onAnalyze, onGameStudio, onScan }) {
  return (
    <PlayerRoster
      kind="self"
      title="Games"
      subtitle="Your own games, matched against your repertoire (transpositions included), filed under the
        opening they belong to, and one press away from the analysis board."
      addLabel="+ Add section"
      emptyLabel='No sections yet. Add one to get started — e.g. "My games".'
      onAnalyze={onAnalyze}
      onGameStudio={onGameStudio}
      onScan={onScan}
    />
  );
}
