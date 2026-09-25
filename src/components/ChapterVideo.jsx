import React, {
  forwardRef, useEffect, useImperativeHandle, useRef, useState,
} from 'react';
import { putVideo, deleteVideo, videoObjectUrl, MAX_VIDEO_BYTES } from '../lib/videoStore';
import { classifyVideoUrl, embedSrc, fmtTime } from '../lib/videoLinks';
import { uid } from '../store';
import { UploadIcon, LinkIcon, PencilIcon } from './Icons';

// One video at the top of a chapter, with the moment it's paused at capturable
// as the timestamp for whichever variation that explanation belongs to.
//
// A file you upload is stored as a Blob in this device's IndexedDB (see
// lib/videoStore.js) and plays with a native <video> element — no network
// involved once it's stored, which is what makes it watchable offline. A
// pasted YouTube/Vimeo link embeds instead: playable, but exactly as
// dependent on a connection as it would be on either site directly, and that
// distinction is shown rather than hidden.
//
// `onRequestSeek` is how the rest of the page (the camera icon on a
// variation) tells an already-open player to jump: this component exposes
// `seekTo(seconds)` via `ref`, and rewrites its own currentTime — a real seek
// for an uploaded file, a reload with a new start point for an embed, since
// neither the YouTube nor Vimeo iframes can be told to seek without pulling
// in their JS SDKs.
// `hideEmpty`: render nothing while there's no video and nobody's adding one.
// The phone's chapter page puts "add a video" in its ⋯ sheet instead of a
// strip of the screen; the sheet reaches in through `openAdd` on the ref.
const ChapterVideo = forwardRef(({ video, onChange, hideEmpty = false }, ref) => {
  const [mode, setMode] = useState(null); // null | 'upload' | 'url'
  const [urlInput, setUrlInput] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [objectUrl, setObjectUrl] = useState(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [reloadKey, setReloadKey] = useState(0); // bumped to force an embed iframe to reload at a new start=
  const fileRef = useRef(null);
  const videoRef = useRef(null);

  useEffect(() => {
    let url;
    let cancelled = false;
    if (video?.kind === 'file') {
      videoObjectUrl(video.id).then((u) => { if (!cancelled) { url = u; setObjectUrl(u); } });
    } else {
      setObjectUrl(null);
    }
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [video?.id, video?.kind]);

  useImperativeHandle(ref, () => ({
    seekTo(seconds) {
      if ((video?.kind === 'file' || video?.kind === 'file-url') && videoRef.current) {
        videoRef.current.currentTime = seconds;
        videoRef.current.play().catch(() => {}); // autoplay can be blocked; a paused seek is still a correct jump
      } else if (video?.kind === 'youtube' || video?.kind === 'vimeo') {
        setCurrentTime(seconds);
        setReloadKey((k) => k + 1);
      }
    },
    // What "link this variation here" actually captures. For an uploaded file
    // this tracks the player continuously. For an embed there's no live
    // readout without pulling in that platform's SDK, so it's the timestamp
    // the frame was last (re)loaded at — reflected in the "needs a
    // connection" line in the bar below, not hidden.
    getCurrentTime: () => currentTime,
    openAdd(which) { setMode(which); setError(null); },
  }), [currentTime]);

  const upload = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('video/')) {
      setError('That file doesn’t look like a video.');
      return;
    }
    if (file.size > MAX_VIDEO_BYTES) {
      setError(`That file is ${Math.round(file.size / 1024 / 1024)} MB — the limit is `
        + `${Math.round(MAX_VIDEO_BYTES / 1024 / 1024)} MB.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Replacing a file video: drop the old blob so it doesn't sit in
      // IndexedDB forever with nothing pointing at it.
      if (video?.kind === 'file') await deleteVideo(video.id);
      const id = uid();
      await putVideo(id, file);
      onChange({
        id, kind: 'file', name: file.name, mime: file.type, size: file.size, addedAt: Date.now(),
      });
      setMode(null);
    } catch {
      setError('Could not store that file — it may be too large for this browser to keep offline.');
    } finally {
      setBusy(false);
    }
  };

  const attachUrl = () => {
    const classified = classifyVideoUrl(urlInput);
    if (classified.kind === 'unknown') {
      setError('That doesn’t look like a YouTube/Vimeo link or a direct video file link.');
      return;
    }
    if (video?.kind === 'file') deleteVideo(video.id).catch(() => {});
    // classified spreads last: for YouTube/Vimeo its `id` IS the platform's
    // video id, which embedSrc() builds the player URL from — a generic id
    // assigned here would silently overwrite it and point the embed at a
    // video that doesn't exist. The fallback id only actually matters for a
    // 'file-url' link, which carries no id of its own.
    onChange({ id: uid(), addedAt: Date.now(), sourceUrl: urlInput.trim(), ...classified });
    setUrlInput('');
    setMode(null);
    setError(null);
  };

  const remove = () => {
    if (!window.confirm('Remove this chapter’s video? Variations linked to a moment in it keep their timestamp, in case a replacement video runs the same way.')) return;
    if (video?.kind === 'file') deleteVideo(video.id).catch(() => {});
    onChange(null);
  };

  if (!video) {
    if (hideEmpty && mode === null) return null;
    return (
      <div className="chapter-video empty">
        {mode === null ? (
          <div className="cv-add-row">
            <button className="small ghost" onClick={() => setMode('upload')}>
              <UploadIcon size={14} /> Add a video for this chapter
            </button>
            <button className="small ghost" onClick={() => setMode('url')}>
              <LinkIcon size={14} /> …or paste a link
            </button>
          </div>
        ) : mode === 'upload' ? (
          <div className="cv-add-row">
            <input
              ref={fileRef}
              type="file"
              accept="video/*"
              hidden
              onChange={(e) => upload(e.target.files[0])}
            />
            <button className="small primary" disabled={busy} onClick={() => fileRef.current?.click()}>
              {busy ? 'Storing…' : 'Choose a video file'}
            </button>
            <span className="muted-note">Stored on this device — plays with no connection once it's in.</span>
            <button className="small ghost" onClick={() => { setMode(null); setError(null); }}>Cancel</button>
          </div>
        ) : (
          <div className="cv-add-row">
            <input
              type="text"
              placeholder="https://youtube.com/watch?v=… or a direct .mp4 link"
              value={urlInput}
              onChange={(e) => { setUrlInput(e.target.value); setError(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') attachUrl(); }}
            />
            <button className="small primary" disabled={!urlInput.trim()} onClick={attachUrl}>Add</button>
            <button className="small ghost" onClick={() => { setMode(null); setError(null); }}>Cancel</button>
          </div>
        )}
        {error && <p className="hint cv-error">{error}</p>}
      </div>
    );
  }

  const isEmbed = video.kind === 'youtube' || video.kind === 'vimeo';

  return (
    <div className="chapter-video">
      <div className="cv-player">
        {video.kind === 'file' && objectUrl && (
          <video
            ref={videoRef}
            src={objectUrl}
            controls
            preload="metadata"
            onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          />
        )}
        {isEmbed && (
          <iframe
            key={reloadKey}
            title={video.name || 'Chapter video'}
            src={embedSrc(video, currentTime)}
            allow="accelerate-compute; autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        )}
        {video.kind === 'file-url' && (
          <video
            ref={videoRef}
            src={video.url}
            controls
            preload="metadata"
            onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          />
        )}
      </div>
      <div className="cv-bar">
        <span className="muted-note cv-source">
          {video.kind === 'file'
            ? 'Stored on this device — plays offline'
            : `Streamed from ${video.kind === 'youtube' ? 'YouTube' : video.kind === 'vimeo' ? 'Vimeo' : 'a link'} — needs a connection`}
        </span>
        <span style={{ flex: 1 }} />
        {!isEmbed && (
          <span className="muted-note cv-time">{fmtTime(currentTime)}</span>
        )}
        <button className="small ghost" title="Replace this video" onClick={() => setMode('replace')}>
          <PencilIcon size={13} /> Replace
        </button>
        <button className="small ghost danger" onClick={remove}>Remove</button>
      </div>
      {mode === 'replace' && (
        <div className="cv-add-row">
          <input
            ref={fileRef}
            type="file"
            accept="video/*"
            hidden
            onChange={(e) => upload(e.target.files[0])}
          />
          <button className="small primary" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? 'Storing…' : 'Choose a video file'}
          </button>
          <input
            type="text"
            placeholder="…or paste a new link"
            value={urlInput}
            onChange={(e) => { setUrlInput(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') attachUrl(); }}
          />
          <button className="small" disabled={!urlInput.trim()} onClick={attachUrl}>Use link</button>
          <button className="small ghost" onClick={() => { setMode(null); setError(null); }}>Cancel</button>
        </div>
      )}
      {error && <p className="hint cv-error">{error}</p>}
    </div>
  );
});

export default ChapterVideo;
