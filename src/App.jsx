import { useState, useRef, useEffect } from 'preact/hooks';

function formatTime(t) {
  if (!t || !isFinite(t)) return '0:00';
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return m + ':' + s.toString().padStart(2, '0');
}

function SearchBar({ value, onChange, onSearch }) {
  return (
    <div class="search-wrapper">
      <div class="search-container">
        <div class="search-icon-svg">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
        </div>
        <input
          type="text"
          placeholder="Search movies or shows..."
          value={value}
          onInput={(e) => onChange(e.target.value)}
          onKeyPress={(e) => {
            if (e.key === 'Enter') onSearch();
          }}
        />
        <button onClick={onSearch}>
          <span>Search</span>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
        </button>
      </div>
    </div>
  );
}

function ResultCard({ item, onSelect }) {
  const isTV = item.type === 'tv' || item.type === 'tvSeries' || item.type === 'tvMiniSeries';
  return (
    <div class="result-item" onClick={() => onSelect(item)}>
      <div class="result-poster-wrapper">
        <img
          src={item.image || 'https://via.placeholder.com/180x260?text=No+Poster'}
          alt={item.title}
          loading="lazy"
        />
        <div class="poster-badge-container">
          <span class="type-badge-glass">{isTV ? 'TV' : 'Movie'}</span>
          {item.vote_average ? (
            <span class="rating-badge-glass">
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="currentColor"
                style="margin-right: 3px;"
              >
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
              </svg>
              {Number(item.vote_average).toFixed(1)}
            </span>
          ) : null}
        </div>
        <div class="result-poster-overlay">
          <div class="play-hover-badge">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
          </div>
        </div>
      </div>
      <div class="result-content">
        <h3>{item.title}</h3>
        <p>{item.year || 'N/A'}</p>
      </div>
    </div>
  );
}

function ResultsGrid({ results, onSelect }) {
  if (!results.length) return null;
  return (
    <div class="results">
      {results.map((item) => (
        <ResultCard key={item.id} item={item} onSelect={onSelect} />
      ))}
    </div>
  );
}

function VideoPlayer({ url }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const progressPlayedRef = useRef(null);
  const progressThumbRef = useRef(null);
  const progressBufferRef = useRef(null);
  const timeDisplayRef = useRef(null);
  const wrapperRef = useRef(null);
  const hideTimerRef = useRef(null);

  const [, setShowControls] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [showCC, setShowCC] = useState(false);
  const [subEnabled, setSubEnabled] = useState(false);
  const [subTrack, setSubTrack] = useState(-1);
  const [subSize, setSubSize] = useState(100);
  const [subPos, setSubPos] = useState(0);
  const [, setAudioTracks] = useState([]);
  const [, setCurAudio] = useState(0);
  const [subTracks, setSubTracks] = useState([]);

  const initControls = () => {
    setShowControls(true);
    clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setShowControls(false), 3000);
  };

  const updateProgress = (video) => {
    if (!video || !video.duration) return;
    const pct = (video.currentTime / video.duration) * 100;
    if (progressPlayedRef.current) progressPlayedRef.current.style.width = pct + '%';
    if (progressThumbRef.current) progressThumbRef.current.style.left = pct + '%';
    if (video.buffered.length > 0) {
      const end = video.buffered.end(video.buffered.length - 1);
      const bufPct = (end / video.duration) * 100;
      if (progressBufferRef.current) progressBufferRef.current.style.width = bufPct + '%';
    }
    if (timeDisplayRef.current) {
      timeDisplayRef.current.textContent =
        formatTime(video.currentTime) + ' / ' + formatTime(video.duration);
    }
  };

  const updateSubTracks = (hls) => {
    if (!hls || !hls.subtitleTracks) return;
    setSubTracks(hls.subtitleTracks);
  };

  const applySubPos = () => {
    const pos = 95 - subPos;
    const video = videoRef.current;
    if (!video) return;
    for (let i = 0; i < video.textTracks.length; i++) {
      const tt = video.textTracks[i];
      if (tt.kind !== 'subtitles' && tt.kind !== 'captions') continue;
      for (let j = 0; j < tt.cues.length; j++) {
        const cue = tt.cues[j];
        cue.snapToLines = false;
        cue.line = pos;
      }
    }
  };

  useEffect(() => {
    if (!url) return;
    const video = videoRef.current;
    if (!video) return;
    let hls = null;

    if (window.Hls && Hls.isSupported()) {
      hls = new Hls({ subtitleDisplay: true });
      hlsRef.current = hls;
      video.controls = false;
      video.removeAttribute('src');
      hls.loadSource(url);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        initControls();
        video.play().catch(() => {});
        if (hls.audioTracks && hls.audioTracks.length) {
          setAudioTracks(hls.audioTracks);
          const eng = hls.audioTracks.findIndex((t) => t.lang && t.lang.startsWith('eng'));
          const idx = eng >= 0 ? eng : 0;
          hls.audioTrack = idx;
          setCurAudio(idx);
        }
        updateSubTracks(hls);
      });

      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
        if (hls.audioTracks) {
          setAudioTracks(hls.audioTracks);
          const eng = hls.audioTracks.findIndex((t) => t.lang && t.lang.startsWith('eng'));
          if (eng >= 0 && hls.audioTrack !== eng) {
            hls.audioTrack = eng;
            setCurAudio(eng);
          }
        }
      });

      hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => updateSubTracks(hls));
      hls.on(Hls.Events.CUES_PARSED, () => applySubPos());
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.controls = true;
      video.src = url;
      video.play();
    }

    const onTime = () => updateProgress(video);
    const onLoad = () => updateProgress(video);
    const onProg = () => updateProgress(video);
    const onPlay = () => {
      setPlaying(true);
      updateProgress(video);
    };
    const onPause = () => setPlaying(false);

    video.addEventListener('timeupdate', onTime);
    video.addEventListener('loadedmetadata', onLoad);
    video.addEventListener('progress', onProg);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);

    return () => {
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('loadedmetadata', onLoad);
      video.removeEventListener('progress', onProg);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      if (hls) {
        hls.destroy();
        hlsRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  };

  const seek = (e) => {
    const video = videoRef.current;
    if (!video) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    video.currentTime = x * video.duration;
  };

  const toggleFS = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else if (wrapperRef.current) {
      wrapperRef.current.requestFullscreen();
    }
  };

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const onMove = () => {
      wrapper.classList.add('show-controls');
      clearTimeout(hideTimerRef.current);
      if (videoRef.current && !videoRef.current.paused) {
        hideTimerRef.current = setTimeout(() => wrapper.classList.remove('show-controls'), 3000);
      }
    };
    const onLeave = () => {
      if (videoRef.current && !videoRef.current.paused) {
        wrapper.classList.remove('show-controls');
      }
    };
    const onDbl = (e) => {
      if (e.target.closest('.custom-controls')) return;
      toggleFS();
    };
    const onClick = (e) => {
      if (e.target.closest('.custom-controls')) return;
      const isShowing = wrapper.classList.contains('show-controls');
      if (isShowing) {
        wrapper.classList.remove('show-controls');
        clearTimeout(hideTimerRef.current);
      } else {
        wrapper.classList.add('show-controls');
        clearTimeout(hideTimerRef.current);
        if (videoRef.current && !videoRef.current.paused) {
          hideTimerRef.current = setTimeout(() => wrapper.classList.remove('show-controls'), 3000);
        }
      }
    };
    wrapper.addEventListener('mousemove', onMove);
    wrapper.addEventListener('mouseleave', onLeave);
    wrapper.addEventListener('dblclick', onDbl);
    wrapper.addEventListener('click', onClick);
    return () => {
      wrapper.removeEventListener('mousemove', onMove);
      wrapper.removeEventListener('mouseleave', onLeave);
      wrapper.removeEventListener('dblclick', onDbl);
      wrapper.removeEventListener('click', onClick);
    };
  }, []);

  useEffect(() => {
    if (!subEnabled || !hlsRef.current) {
      if (hlsRef.current) hlsRef.current.subtitleTrack = -1;
      return;
    }
    const hls = hlsRef.current;
    const sel = document.getElementById('cc-track-select');
    if (!sel) return;
    const eng = hls.subtitleTracks
      ? hls.subtitleTracks.findIndex((t) => t.lang && t.lang.startsWith('eng'))
      : -1;
    const idx = eng >= 0 ? eng : hls.subtitleTracks && hls.subtitleTracks.length > 0 ? 0 : -1;
    sel.value = idx;
    hls.subtitleTrack = idx;
    setSubTrack(idx);
  }, [subEnabled]);

  useEffect(() => {
    applySubPos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subPos]);

  return (
    <div class="video-wrapper show-controls" ref={wrapperRef}>
      <video ref={videoRef} preload="auto" playsinline></video>
      <div
        class="center-play"
        onClick={(e) => {
          e.stopPropagation();
          togglePlay();
        }}
      >
        {playing ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16"></rect>
            <rect x="14" y="4" width="4" height="16"></rect>
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5 3 19 12 5 21 5 3"></polygon>
          </svg>
        )}
      </div>
      <div class="custom-controls">
        <div class="progress-container" onClick={seek}>
          <div class="track"></div>
          <div class="buffer" ref={progressBufferRef}></div>
          <div class="played" ref={progressPlayedRef}></div>
          <div class="thumb" ref={progressThumbRef}></div>
        </div>
        <div class="controls-row">
          <button class="control-btn" onClick={togglePlay}>
            {playing ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16"></rect>
                <rect x="14" y="4" width="4" height="16"></rect>
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3"></polygon>
              </svg>
            )}
          </button>

          <div class="volume-container">
            <button
              class="control-btn"
              onClick={() => {
                const v = videoRef.current;
                if (!v) return;
                v.muted = !v.muted;
                setMuted(v.muted);
              }}
            >
              {muted ? (
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                  <line x1="23" y1="9" x2="17" y2="15"></line>
                  <line x1="17" y1="9" x2="23" y2="15"></line>
                </svg>
              ) : volume > 0.5 ? (
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                </svg>
              ) : (
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                </svg>
              )}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={volume}
              onInput={(e) => {
                const v = parseFloat(e.target.value);
                setVolume(v);
                const video = videoRef.current;
                if (video) {
                  video.volume = v;
                  video.muted = false;
                  setMuted(false);
                }
              }}
            />
          </div>

          <span class="time-display" ref={timeDisplayRef}>
            0:00 / 0:00
          </span>

          <div class="controls-spacer"></div>

          <button
            class="control-btn"
            title="Rewind 10s"
            onClick={() => {
              const v = videoRef.current;
              if (v) v.currentTime = Math.max(0, v.currentTime - 10);
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
              <polyline points="3 3 3 8 8 8"></polyline>
              <text
                x="12"
                y="15"
                font-size="8"
                font-family="system-ui"
                font-weight="bold"
                text-anchor="middle"
                fill="currentColor"
                stroke="none"
              >
                10
              </text>
            </svg>
          </button>

          <button
            class="control-btn"
            title="Forward 10s"
            onClick={() => {
              const v = videoRef.current;
              if (v) v.currentTime = Math.min(v.duration, v.currentTime + 10);
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M21 12a9 9 0 1 1-9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path>
              <polyline points="21 3 21 8 16 8"></polyline>
              <text
                x="12"
                y="15"
                font-size="8"
                font-family="system-ui"
                font-weight="bold"
                text-anchor="middle"
                fill="currentColor"
                stroke="none"
              >
                10
              </text>
            </svg>
          </button>

          <button
            class="control-btn"
            title="Subtitles & CC"
            onClick={(e) => {
              e.stopPropagation();
              setShowCC((s) => !s);
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="7" y1="10" x2="11" y2="10"></line>
              <line x1="7" y1="14" x2="17" y2="14"></line>
              <line x1="15" y1="10" x2="17" y2="10"></line>
            </svg>
          </button>

          <button class="control-btn" title="Toggle Fullscreen" onClick={toggleFS}>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path>
            </svg>
          </button>
        </div>

        <div class={'cc-popup' + (showCC ? ' show' : '')} onClick={(e) => e.stopPropagation()}>
          <div class="cc-toggle">
            <span>Subtitles</span>
            <label class="checkbox-container" style="margin:0">
              <input
                type="checkbox"
                checked={subEnabled}
                onChange={(e) => setSubEnabled(e.target.checked)}
              />
              <span>On</span>
            </label>
          </div>
          <label>
            Track:
            <select
              id="cc-track-select"
              value={subTrack}
              onChange={(e) => {
                const idx = parseInt(e.target.value);
                setSubTrack(idx);
                setSubEnabled(idx >= 0);
                if (hlsRef.current) hlsRef.current.subtitleTrack = idx;
              }}
            >
              <option value="-1">Off</option>
              {subTracks.map((t, i) => (
                <option key={i} value={i}>
                  {t.name || t.lang || 'Track ' + i}
                </option>
              ))}
            </select>
          </label>
          <label>
            Size:
            <input
              type="range"
              min="50"
              max="500"
              value={subSize}
              onInput={(e) => {
                const s = parseFloat(e.target.value);
                setSubSize(s);
                const video = videoRef.current;
                if (video) video.style.setProperty('--subtitle-size', s / 100 + 'em');
              }}
            />
          </label>
          <label>
            Position:
            <input
              type="range"
              min="0"
              max="95"
              value={subPos}
              onInput={(e) => {
                setSubPos(parseInt(e.target.value));
              }}
            />
          </label>
        </div>
      </div>
    </div>
  );
}

const WATCHSERIES_PROVIDERS = {
  vaplayer: {
    name: 'VidAPI',
    url: (id, type, s, e) =>
      type === 'movie'
        ? `https://vaplayer.ru/embed/movie/${id}`
        : `https://vaplayer.ru/embed/tv/${id}/${s}/${e}`,
  },
  embedmaster: {
    name: 'EmbedMaster',
    url: (id, type, s, e) =>
      type === 'movie'
        ? `https://embedmaster.link/movie/${id}`
        : `https://embedmaster.link/tv/${id}/${s}/${e}`,
  },
  vidsrccc: {
    name: 'VidSrc.cc',
    url: (id, type, s, e) =>
      type === 'movie'
        ? `https://vidsrc.cc/v2/embed/movie/${id}`
        : `https://vidsrc.cc/v2/embed/tv/${id}/${s}/${e}`,
  },
  vidfast: {
    name: 'VidFast',
    url: (id, type, s, e) =>
      type === 'movie'
        ? `https://vidfast.pro/movie/${id}`
        : `https://vidfast.pro/tv/${id}/${s}/${e}`,
  },
  vidsrcembed: {
    name: 'VidSrc Embed',
    url: (id, type, s, e) =>
      type === 'movie'
        ? `https://vidsrc-embed.ru/embed/movie/${id}`
        : `https://vidsrc-embed.ru/embed/tv/${id}/${s}/${e}`,
  },
  videasy: {
    name: 'Videoasy',
    url: (id, type, s, e) =>
      type === 'movie'
        ? `https://player.videasy.net/movie/${id}`
        : `https://player.videasy.net/tv/${id}/${s}/${e}`,
  },
};

function Player({
  item,
  source,
  season,
  episode,
  qualityIdx,
  onClose,
  onSourceChange,
  onSeasonChange,
  onEpisodeChange,
  onQualityChange,
}) {
  const [vixsrcSources, setVixsrcSources] = useState([]);
  const [vixsrcReferer, setVixsrcReferer] = useState('');
  const [vidnestSources, setVidnestSources] = useState([]);
  const [streamLoading, setStreamLoading] = useState(false);
  const [streamError, setStreamError] = useState('');

  const [tmdbSeasons, setTmdbSeasons] = useState([]);
  const [tmdbEpisodes, setTmdbEpisodes] = useState([]);
  const [resolvedUrl, setResolvedUrl] = useState('');

  const isMovie = item.type === 'movie';
  const isEmbedProvider = [
    'vaplayer',
    'embedmaster',
    'vidsrccc',
    'vidfast',
    'vidsrcembed',
    'videasy',
    'vidsrcto',
    'vidrock',
  ].includes(source);

  const maxEpisodes = tmdbEpisodes.length || Number.MAX_SAFE_INTEGER;

  useEffect(() => {
    if (isMovie) return;
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch(`/api/tmdb/details/tv/${item.id}`);
        const d = await r.json();
        if (cancelled) return;
        if (d.seasons) setTmdbSeasons(d.seasons);
      } catch {}
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [item.id, isMovie]);

  useEffect(() => {
    if (isMovie) return;
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch(`/api/tmdb/episodes/${item.id}/${season}`);
        const d = await r.json();
        if (cancelled) return;
        if (d.episodes) setTmdbEpisodes(d.episodes);
      } catch {}
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [item.id, season, isMovie]);

  useEffect(() => {
    if (source !== 'vixsrc' || !item) return;
    let cancelled = false;
    async function load() {
      setStreamLoading(true);
      setStreamError('');
      try {
        const type = isMovie ? 'movie' : 'tv';
        let streamUrl = '/api/vixsrc/' + type + '/' + item.id;
        if (type === 'tv') streamUrl += '?season=' + season + '&episode=' + episode;
        const streamRes = await fetch(streamUrl);
        const streamData = await streamRes.json();
        if (cancelled) return;
        setStreamLoading(false);
        if (!streamData.sources || !streamData.sources.length) {
          setStreamError('No VixSrc streams available.');
          return;
        }
        setVixsrcSources(streamData.sources);
        setVixsrcReferer(streamData.referer || 'https://vixsrc.to/');
      } catch (err) {
        if (!cancelled) {
          setStreamLoading(false);
          setStreamError('Failed to load stream.');
          console.error(err);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [item, item.id, source, season, episode, isMovie]);

  useEffect(() => {
    if (source !== 'vidnest' || !item) return;
    let cancelled = false;
    async function load() {
      setStreamLoading(true);
      setStreamError('');
      try {
        const type = isMovie ? 'movie' : 'tv';
        let streamUrl = '/api/vidnest/' + type + '/' + item.id;
        if (type === 'tv') streamUrl += '?season=' + season + '&episode=' + episode;
        const streamRes = await fetch(streamUrl);
        const streamData = await streamRes.json();
        if (cancelled) return;
        setStreamLoading(false);
        if (!streamData.sources || !streamData.sources.length) {
          setStreamError('No VidNest streams available.');
          return;
        }
        setVidnestSources(streamData.sources);
      } catch (err) {
        if (!cancelled) {
          setStreamLoading(false);
          setStreamError('Failed to load stream.');
          console.error(err);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [item, item.id, source, season, episode, isMovie]);

  const currentUrl =
    source === 'vixsrc'
      ? vixsrcSources[qualityIdx]?.url
      : source === 'vidnest'
        ? vidnestSources[qualityIdx]?.url
        : '';

  const embedProvider = WATCHSERIES_PROVIDERS[source];
  const iframeUrl = embedProvider
    ? embedProvider.url(item.id, isMovie ? 'movie' : 'tv', season, episode)
    : source === 'vidsrcto'
      ? 'https://vidsrc.to/embed/' +
        (isMovie ? 'movie' : 'tv') +
        '/' +
        item.id +
        (isMovie ? '' : '/' + season + '/' + episode)
      : source === 'vidrock'
        ? 'https://vidrock.ru/' +
          (isMovie ? 'movie' : 'tv') +
          '/' +
          item.id +
          (isMovie ? '' : '/' + season + '/' + episode)
        : '';

  useEffect(() => {
    if (!isEmbedProvider || !iframeUrl) return;
    setResolvedUrl('');
    fetch('/api/resolve?url=' + encodeURIComponent(iframeUrl))
      .then((r) => r.json())
      .then((data) => {
        if (data.finalUrl) setResolvedUrl(data.finalUrl);
      })
      .catch((e) => console.error('Resolve failed', e));
  }, [isEmbedProvider, iframeUrl]);

  return (
    <div class="player-container">
      <div class="player-header">
        <div>
          <h2>{item.title}</h2>
          <div class="player-meta-info">
            <span class={`type-badge-glass ${isMovie ? 'movie' : 'tv'}`}>
              {isMovie ? 'Movie' : 'TV Show'}
            </span>
            {!isMovie && (
              <span class="player-meta-badge">
                Season {season} · Episode {episode}
              </span>
            )}
          </div>
        </div>
        <button class="close-player" title="Close Player" onClick={onClose}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
      <div class="controls">
        <label>
          Source
          <select value={source} onChange={onSourceChange}>
            <optgroup label="WatchSeries Providers">
              <option value="vaplayer">VidAPI (vaplayer)</option>
              <option value="embedmaster">EmbedMaster</option>
              <option value="vidsrccc">VidSrc.cc</option>
              <option value="vidfast">VidFast</option>
              <option value="vidsrcembed">VidSrc Embed</option>
              <option value="videasy">Videoasy</option>
            </optgroup>
            <optgroup label="Other Providers">
              <option value="vixsrc">VixSrc (HLS)</option>
              <option value="vidnest">VidNest (HLS)</option>
              <option value="vidsrcto">VidSrc.to</option>
              <option value="vidrock">VidRock</option>
            </optgroup>
          </select>
        </label>
        {!isMovie && (
          <>
            <label>
              Season
              <select value={season} onChange={onSeasonChange}>
                {tmdbSeasons.length > 0
                  ? tmdbSeasons.map((s) => (
                      <option key={s.season_number} value={s.season_number}>
                        Season {s.season_number} ({s.episode_count} ep)
                      </option>
                    ))
                  : [...Array(20)].map((_, i) => (
                      <option key={i + 1} value={i + 1}>
                        Season {i + 1}
                      </option>
                    ))}
              </select>
            </label>
            <label>
              Episode
              <select value={episode} onChange={onEpisodeChange}>
                {tmdbEpisodes.length > 0
                  ? tmdbEpisodes.map((ep) => (
                      <option key={ep.episode_number} value={ep.episode_number}>
                        Ep {ep.episode_number} - {ep.name || ''}
                      </option>
                    ))
                  : [...Array(50)].map((_, i) => (
                      <option key={i + 1} value={i + 1}>
                        Episode {i + 1}
                      </option>
                    ))}
              </select>
            </label>
          </>
        )}
        {(source === 'vixsrc' && vixsrcSources.length > 0) ||
        (source === 'vidnest' && vidnestSources.length > 0) ? (
          <label>
            Quality
            <select value={qualityIdx} onChange={onQualityChange}>
              {(source === 'vixsrc' ? vixsrcSources : vidnestSources).map((s, i) => (
                <option key={i} value={i}>
                  {s.quality || 'Auto'} {s.server ? '(' + s.server + ')' : ''}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {!isMovie && (
          <div style="display: flex; gap: 6px; align-self: flex-end;">
            <button
              class="control-nav-btn"
              title="Previous Episode"
              disabled={episode <= 1}
              onClick={() => onEpisodeChange({ target: { value: Math.max(1, episode - 1) } })}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polyline points="15 18 9 12 15 6"></polyline>
              </svg>
            </button>
            <button
              class="control-nav-btn"
              title="Next Episode"
              disabled={episode >= maxEpisodes}
              onClick={() => onEpisodeChange({ target: { value: episode + 1 } })}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </button>
          </div>
        )}
      </div>

      {streamLoading && <div class="status-msg">Loading stream...</div>}
      {streamError && <div class="status-msg status-msg-text-only">{streamError}</div>}

      {source === 'vixsrc' && currentUrl && !streamLoading && !streamError && (
        <VideoPlayer
          url={
            '/api/proxy?url=' +
            encodeURIComponent(currentUrl) +
            '&referer=' +
            encodeURIComponent(vixsrcReferer)
          }
        />
      )}
      {source === 'vidnest' && currentUrl && !streamLoading && !streamError && (
        <VideoPlayer
          url={
            '/api/proxy?url=' +
            encodeURIComponent(currentUrl) +
            '&referer=' +
            encodeURIComponent('https://vidnest.fun/')
          }
        />
      )}
      {(isEmbedProvider || source === 'vidsrcto' || source === 'vidrock') &&
        (resolvedUrl || iframeUrl) && (
          <iframe
            class="video-frame"
            src={resolvedUrl || iframeUrl}
            allowFullScreen
            allow="autoplay; fullscreen"
          ></iframe>
        )}
    </div>
  );
}

const SUGGESTIONS = [
  'Stranger Things',
  'Breaking Bad',
  'House of the Dragon',
  'Wednesday',
  'The Boys',
  'Interstellar',
  'Dune',
  'Avengers',
  'Oppenheimer',
];

export default function App() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentItem, setCurrentItem] = useState(null);
  const [source, setSource] = useState('vixsrc');
  const [season, setSeason] = useState(1);
  const [episode, setEpisode] = useState(1);
  const [qualityIdx, setQualityIdx] = useState(0);

  const doSearch = async () => {
    const q = query.trim();
    if (!q) return;
    setIsLoading(true);
    setStatus('Searching for "' + q + '"...');
    setResults([]);
    try {
      const res = await fetch('/api/tmdb/search?q=' + encodeURIComponent(q));
      const data = await res.json();
      setIsLoading(false);
      setStatus(data.length ? '' : 'No results found.');
      setResults(data);
    } catch (err) {
      console.error(err);
      setIsLoading(false);
      setStatus('Search failed.');
    }
  };

  const handleSelectSuggestion = async (tag) => {
    setQuery(tag);
    setIsLoading(true);
    setStatus('Searching for "' + tag + '"...');
    setResults([]);
    try {
      const res = await fetch('/api/tmdb/search?q=' + encodeURIComponent(tag));
      const data = await res.json();
      setIsLoading(false);
      setStatus(data.length ? '' : 'No results found.');
      setResults(data);
    } catch (err) {
      console.error(err);
      setIsLoading(false);
      setStatus('Search failed.');
    }
  };

  const openPlayer = (item, s, e) => {
    const merged = { ...item, season: s || item.season || 1 };
    setCurrentItem(merged);
    setSeason(s || item.season || 1);
    setEpisode(e || 1);
    setQualityIdx(0);
  };

  const isTVItem = (item) => {
    if (!item) return false;
    return item.type === 'tv' || item.type === 'tvSeries' || item.type === 'tvMiniSeries';
  };

  const closePlayer = () => {
    setCurrentItem(null);
    document.title = 'cine-web';
    window.history.replaceState(null, '', window.location.pathname);
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    const type = params.get('type');
    const title = params.get('title');
    if (id && type && title) {
      const s = params.has('s') ? Number(params.get('s')) : 1;
      const e = params.has('e') ? Number(params.get('e')) : 1;
      const src = params.get('src') || 'vaplayer';
      const image = params.get('image') || '';
      setSource(src);
      setSeason(s);
      setEpisode(e);
      setCurrentItem({ id, type, title, season: s, image });
    }
  }, []);

  useEffect(() => {
    if (!currentItem) return;
    const params = new URLSearchParams();
    params.set('id', currentItem.id);
    params.set('type', currentItem.type);
    params.set('title', currentItem.title);
    if (currentItem.image) params.set('image', currentItem.image);
    if (isTVItem(currentItem)) {
      params.set('s', season);
      params.set('e', episode);
    }
    params.set('src', source);
    const state = {
      id: currentItem.id,
      type: currentItem.type,
      season,
      episode,
      source,
      title: currentItem.title,
      image: currentItem.image,
    };
    window.history.replaceState(state, '', '?' + params.toString());
    document.title =
      currentItem.title +
      (isTVItem(currentItem) ? ' S' + season + 'E' + episode : '') +
      ' - cineweb';
  }, [currentItem, source, season, episode]);

  useEffect(() => {
    const onPop = (e) => {
      if (e.state && e.state.id) {
        setCurrentItem({
          id: e.state.id,
          type: e.state.type,
          title: e.state.title || '',
          image: e.state.image || '',
        });
        setSource(e.state.source || 'vaplayer');
        setSeason(e.state.season || 1);
        setEpisode(e.state.episode || 1);
      } else {
        setCurrentItem(null);
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const onHeaderClick = () => {
    if (currentItem) closePlayer();
  };

  return (
    <div class="app-container">
      <header class="header">
        <div class="header-inner">
          <a
            href="/"
            class="logo-container"
            onClick={(e) => {
              e.preventDefault();
              onHeaderClick();
            }}
          >
            <span class="app-title">
              cine<span class="logo-highlight">web</span>
            </span>
          </a>
        </div>
      </header>

      <main class="content-wrapper">
        {currentItem && (
          <Player
            item={currentItem}
            source={source}
            season={season}
            episode={episode}
            qualityIdx={qualityIdx}
            onClose={closePlayer}
            onSourceChange={(e) => {
              setSource(e.target.value);
              setQualityIdx(0);
            }}
            onSeasonChange={(e) => setSeason(parseInt(e.target.value) || 1)}
            onEpisodeChange={(e) => {
              const val = parseInt(e.target.value);
              if (val >= 1) setEpisode(val);
            }}
            onQualityChange={(e) => setQualityIdx(parseInt(e.target.value))}
          />
        )}

        <SearchBar value={query} onChange={setQuery} onSearch={doSearch} />

        <div class="suggestions-container">
          {SUGGESTIONS.map((tag) => (
            <button key={tag} class="suggestion-pill" onClick={() => handleSelectSuggestion(tag)}>
              {tag}
            </button>
          ))}
        </div>

        {status && (
          <div class={`status-msg ${!isLoading ? 'status-msg-text-only' : ''}`}>{status}</div>
        )}

        <ResultsGrid results={results} onSelect={openPlayer} />
      </main>

      <footer class="footer">
        <p>
          &copy; {new Date().getFullYear()}{' '}
          <a href="https://github.com/serifpersia/cine-web" target="_blank" rel="noreferrer">
            cine-web
          </a>
        </p>
      </footer>
    </div>
  );
}
