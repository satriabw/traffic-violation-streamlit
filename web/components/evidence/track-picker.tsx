'use client';

import { label, SERIES, type Track } from '@/lib/evidence';

export function TrackPicker({ tracks, selected, onChange }: {
  tracks: Track[];
  selected: number[];
  onChange: (ids: number[]) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="font-medium">Road users to highlight</legend>
      <p className="text-sm text-muted-foreground">The violating vehicle and the pedestrians in the crosswalk during the event. Up to three at a time, so the colours stay easy to tell apart, including for colour-blind viewers. Everyone else is still outlined in grey on the image.</p>
      <div className="flex flex-wrap gap-4">
        {tracks.map(track => (
          <label key={track.trackId} className="flex items-center gap-2">
            <input type="checkbox" checked={selected.includes(track.trackId)}
              disabled={!selected.includes(track.trackId) && selected.length >= SERIES.length}
              onChange={event => onChange(event.target.checked
                ? [...selected, track.trackId].slice(0, SERIES.length)
                : selected.filter(id => id !== track.trackId))} />
            {label(track)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
