import React from 'react';
import PlayerRoster from '../components/PlayerRoster';

// One section per private student: their profile (USCF/FIDE/chess.com/
// lichess), their games, and their own repertoire — built once from the
// Library's "Students" tab, it comes up automatically whenever you analyze
// one of their games.
export default function CoachesView({ onAnalyze, onScan, onOpenLibrary, onOpenCollections }) {
  return (
    <PlayerRoster
      kind="student"
      title="Coach"
      subtitle="One section per private student. Add their USCF ID and online accounts to pull in live
        ratings, log their games, build a repertoire just for them, and star or theme the lines
        they're working on — all of it loads automatically when you send one of their games to the
        analysis board."
      addLabel="+ Add student"
      emptyLabel="No students yet. Add one to start tracking their games and repertoire."
      onAnalyze={onAnalyze}
      onScan={onScan}
      onOpenLibrary={onOpenLibrary}
      onOpenCollections={onOpenCollections}
    />
  );
}
