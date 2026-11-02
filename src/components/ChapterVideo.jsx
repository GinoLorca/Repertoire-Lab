import React, {
  forwardRef, useEffect, useImperativeHandle, useRef, useState,
} from 'react';
import {
  putVideo, getVideo, deleteVideo, videoObjectUrl, MAX_VIDEO_BYTES,
} from '../lib/videoStore';
import {
  cloudVideosReady, startUpload, uploadStatus, watchUpload, cloudVideoUrl, saveOffline, deleteCloudVideo,
} from '../lib/cloud/videos';
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
// A file is also uploaded to the cloud when you're signed in (lib/cloud/
// videos.js): `onCloud(videoId, cloud)` records it on the chapter once it's
// there, and every other device then streams it from there — or saves it
// for offline, after which it plays there with no connection too.
const mb = (bytes) => `${Math.max(1, Math.round((bytes ?? 0) / 1024 / 1024))} MB`;
const pct = (p) => `${Math.floor((p ?? 0) * 100)}%`;

const ChapterVideo = forwardRef(({
  video, onChange, onCloud, hideEmpty = false,
}, ref) => {
  const [mode, setMode] = useState(null); // null | 'upload' | 'url'
  const [urlInput, setUrlInput] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [objectUrl, setObjectUrl] = useState(null);
  // An uploaded file's bytes live on the device it was added from; the
  // chapter's note of it syncs, the file doesn't. 'missing': not here.
  const [fileStatus, setFileStatus] = useState('loading'); // 'loading' | 'ready' | 'missing'
  const [fileTick, setFileTick] = useState(0); // bumped when the file is added here
  const hereRef = useRef(null);
  // The cloud: whether it can hold videos here (signed in, with a bucket),
  // this video's upload, a link to stream it from, and saving it for offline.
  const [cloudOk, setCloudOk] = useState(false);
  const [uploading, setUploading] = useState(null); // { progress, error }
  const [streamUrl, setStreamUrl] = useState(null);
  const [saving, setSaving] = useState(null); // { progress } | { error }
  const [currentTime, setCurrentTime] = useState(0);
  const [reloadKey, setReloadKey] = useState(0); // bumped to force an embed iframe to reload at a new start=
  const fileRef = useRef(null);
  const videoRef = useRef(null);

  useEffect(() => {
    let url;
    let cancelled = false;
    if (video?.kind === 'file') {
      setFileStatus('loading');
      videoObjectUrl(video.id)
        .catch(() => null)
        .then((u) => {
          if (cancelled) { if (u) URL.revokeObjectURL(u); return; }
          url = u;
          setObjectUrl(u);
          setFileStatus(u ? 'ready' : 'missing');
        });
    } else {
      setObjectUrl(null);
    }
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [video?.id, video?.kind, fileTick]);

  useEffect(() => {
    let live = true;
    cloudVideosReady().then((ok) => { if (live) setCloudOk(ok); });
    return () => { live = false; };
  }, []);

  // An upload of this video, wherever it was started from.
  useEffect(() => {
    if (video?.kind !== 'file') { setUploading(null); return undefined; }
    setUploading(uploadStatus(video.id));
    return watchUpload(video.id, (u) => setUploading(u.done ? null : u));
  }, [video?.id, video?.kind, uploading === null]); // eslint-disable-line react-hooks/exhaustive-deps

  const sendToCloud = (videoId, file) => {
    startUpload({ videoId, file, onDone: (c) => onCloud?.(videoId, c) }).then((started) => {
      if (started) setUploading(uploadStatus(videoId));
    });
  };
  // One already on this device, from before videos went to the cloud.
  const uploadExisting = async () => {
    const blob = await getVideo(video.id);
    if (blob) sendToCloud(video.id, blob);
  };

  // Not on this device but in the cloud: stream it from there.
  useEffect(() => {
    let live = true;
    setStreamUrl(null);
    if (video?.kind === 'file' && fileStatus === 'missing' && video.cloud?.path && cloudOk) {
      cloudVideoUrl(video.cloud.path).then((u) => { if (live) setStreamUrl(u); }).catch(() => {});
    }
    return () => { live = false; };
  }, [video?.id, video?.kind, video?.cloud?.path, fileStatus, cloudOk]);

  const keepOffline = async () => {
    setSaving({ progress: 0 });
    try {
      await saveOffline({
        videoId: video.id, path: video.cloud.path, onProgress: (p) => setSaving({ progress: p }),
      });
      setSaving(null);
      setFileTick((t) => t + 1);
    } catch {
      setSaving({ error: true });
    }
  };

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
      if (video?.cloud?.path) deleteCloudVideo(video.cloud.path);
      const id = uid();
      await putVideo(id, file);
      onChange({
        id, kind: 'file', name: file.name, mime: file.type, size: file.size, addedAt: Date.now(),
      });
      setMode(null);
      if (cloudOk) sendToCloud(id, file);
    } catch {
      setError('Could not store that file — it may be too large for this browser to keep offline.');
    } finally {
      setBusy(false);
    }
  };

  // The same video, added on this device too: kept under the same id, so the
  // chapter (and every line linked to a moment in it) is unchanged everywhere.
  const addHere = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('video/')) { setError('That file doesn’t look like a video.'); return; }
    if (file.size > MAX_VIDEO_BYTES) {
      setError(`That file is ${Math.round(file.size / 1024 / 1024)} MB — the limit is ${Math.round(MAX_VIDEO_BYTES / 1024 / 1024)} MB.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await putVideo(video.id, file);
      setFileTick((t) => t + 1);
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
    if (video?.cloud?.path) deleteCloudVideo(video.cloud.path);
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
    if (video?.cloud?.path) deleteCloudVideo(video.cloud.path);
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
  // Where an uploaded file is — here, in the cloud, on its way — and what
  // can be done about it.
  const act = (label, onClick) => <button type="button" className="linkish cv-act" onClick={onClick}>{label}</button>;
  const fileLine = () => {
    if (uploading?.error) return <>Upload to the cloud didn’t finish {act('Try again', uploadExisting)}</>;
    if (uploading) return `Uploading to the cloud… ${pct(uploading.progress)} — keep the app open till it’s done`;
    if (fileStatus === 'ready') {
      if (video.cloud?.path) return 'On this device and in the cloud — plays offline here';
      return cloudOk
        ? <>Only on this device {act('Upload to the cloud', uploadExisting)}</>
        : 'Stored on this device — plays offline';
    }
    if (streamUrl) {
      if (saving?.error) return <>Couldn’t save it for offline {act('Try again', keepOffline)}</>;
      if (saving) return `Saving for offline… ${pct(saving.progress)}`;
      return <>Streaming from the cloud {act(`Save for offline (${mb(video.cloud.size ?? video.size)})`, keepOffline)}</>;
    }
    return fileStatus === 'missing' ? 'Not on this device' : '';
  };

  return (
    <div className="chapter-video">
      <div className={`cv-player${video.kind === 'file' && fileStatus === 'missing' ? ' missing' : ''}`}>
        {video.kind === 'file' && streamUrl && (
          <video
            ref={videoRef}
            src={streamUrl}
            controls
            preload="metadata"
            playsInline
            onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          />
        )}
        {video.kind === 'file' && fileStatus === 'missing' && !streamUrl && (
          <div className="cv-missing">
            <strong>This video isn’t on this device</strong>
            {video.cloud?.path ? (
              <p>
                It’s in the cloud — sign in (Settings → Account) to play it here. Or add the same
                file to this device, or use a link instead.
              </p>
            ) : (
              <p>
                It’s saved on the device it was added from{video.name ? ` (“${video.name}”)` : ''}
                {' '}and isn’t in the cloud yet — open it there, signed in, and press “Upload to the
                cloud”. Or add the same file here, from Files or after AirDropping it, or use a link.
              </p>
            )}
            <div className="cv-missing-actions">
              <input
                ref={hereRef}
                type="file"
                accept="video/*"
                hidden
                onChange={(e) => addHere(e.target.files[0])}
              />
              <button className="small primary" disabled={busy} onClick={() => hereRef.current?.click()}>
                <UploadIcon size={14} /> {busy ? 'Storing…' : 'Add the file on this device'}
              </button>
              <button className="small" onClick={() => setMode('replace')}>
                <LinkIcon size={14} /> Use a video link instead
              </button>
            </div>
          </div>
        )}
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
            ? fileLine()
            : `Streamed from ${video.kind === 'youtube' ? 'YouTube' : video.kind === 'vimeo' ? 'Vimeo' : 'a link'} — needs a connection`}
        </span>
        <span style={{ flex: 1 }} />
        {!isEmbed && (fileStatus !== 'missing' || streamUrl) && (
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
