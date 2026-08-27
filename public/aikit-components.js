// AIKit Components Library for Preview Environment
// Browser-compatible versions of AINative AI Kit components
// These make AI-specific UI patterns available in generated previews

(function() {
  function cn(...classes) {
    return classes.filter(Boolean).join(' ');
  }

  // ============================================================
  // RENDER HARDENING (wallkind crash class, 2026-08-27)
  // LLM-authored apps pass reasonable-but-unexpected prop shapes (e.g.
  // actions={[{label:'Sign in', variant:'ghost'}]}). Rendering a raw object as
  // a React child throws "Objects are not valid as a React child" and the
  // ErrorBoundary white-screens the WHOLE app. These helpers coerce any value
  // into something renderable, and every exported component is wrapped in a
  // boundary so one bad prop can never take down the app again.
  // ============================================================
  function isReactEl(v) { return v && typeof v === 'object' && v.$$typeof !== undefined; }

  /** Coerce ANY value into a renderable child. Objects render their most
   *  label-like field; unrenderable values render as nothing (never throw). */
  function safeChild(v) {
    if (v == null || typeof v === 'boolean') return null;
    if (typeof v === 'string' || typeof v === 'number') return v;
    if (isReactEl(v)) return v;
    if (Array.isArray(v)) return v.map(function (x, i) {
      var c = safeChild(x);
      return isReactEl(c) && c.key == null ? React.cloneElement(c, { key: i }) : c;
    });
    if (typeof v === 'object') {
      return safeChild(v.label !== undefined ? v.label
        : v.title !== undefined ? v.title
        : v.name !== undefined ? v.name
        : v.text !== undefined ? v.text
        : v.children !== undefined ? v.children
        : v.value !== undefined ? v.value
        : null);
    }
    return null;
  }

  /** Render an "action" that may be a React node OR an {label, variant, onClick}
   *  object (the shape LLMs naturally emit) — objects become real buttons. */
  function renderActionLike(a, i) {
    if (a == null || typeof a === 'boolean') return null;
    if (typeof a === 'string' || typeof a === 'number' || isReactEl(a)) return safeChild(a);
    if (Array.isArray(a)) return a.map(renderActionLike);
    if (typeof a === 'object') {
      var label = safeChild(a.label !== undefined ? a.label : (a.title !== undefined ? a.title : a.text));
      if (label == null) return null;
      var subtle = a.variant === 'ghost' || a.variant === 'secondary' || a.variant === 'outline' || a.variant === 'link';
      return React.createElement('button', {
        key: i, onClick: typeof a.onClick === 'function' ? a.onClick : undefined,
        className: subtle
          ? 'px-3 py-2 rounded-lg text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors'
          : 'px-4 py-2 rounded-lg text-sm font-semibold bg-[#5867EF] text-white hover:bg-[#4756d6] transition-colors'
      }, label);
    }
    return null;
  }

  /** Initials for a user prop that may be a string OR an object. */
  function userInitials(user) {
    if (typeof user === 'string') return user.slice(0, 2).toUpperCase();
    if (user && typeof user === 'object') {
      var src = user.initials || user.name || user.email || user.label || '';
      if (typeof src === 'string' && src) return src.slice(0, 2).toUpperCase();
    }
    return '·';
  }

  /** Wrap a component in an error boundary: a crashing AIKit component renders
   *  nothing instead of white-screening the entire generated app. */
  function harden(Component, name) {
    var Boundary = class extends React.Component {
      constructor(props) { super(props); this.state = { failed: false }; }
      static getDerivedStateFromError() { return { failed: true }; }
      componentDidCatch(err) {
        try { console.warn('[AIKit] ' + name + ' failed to render:', err && err.message); } catch (_) {}
      }
      render() {
        if (this.state.failed) return null;
        return React.createElement(Component, this.props);
      }
    };
    Boundary.displayName = name;
    return Boundary;
  }

  function hardenAll(components) {
    var out = {};
    for (var k in components) out[k] = harden(components[k], k);
    return out;
  }

  // ============================================================
  // StreamingIndicator — Animated loading indicators (dots/pulse/wave)
  // ============================================================
  const StreamingIndicator = ({ variant = 'dots', className = '', size = 'default', color = '#5867EF', label = 'Loading...', ...props }) => {
    const sizeMap = { sm: 6, default: 8, lg: 12 };
    const dotSize = sizeMap[size] || 8;

    const styleTag = React.createElement('style', { key: 'styles' }, `
      @keyframes aikit-pulse-dot {
        0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
        40% { opacity: 1; transform: scale(1); }
      }
      @keyframes aikit-pulse-ring {
        0% { transform: scale(1); opacity: 0.8; }
        100% { transform: scale(2.5); opacity: 0; }
      }
      @keyframes aikit-wave {
        0%, 40%, 100% { transform: scaleY(0.4); }
        20% { transform: scaleY(1); }
      }
    `);

    if (variant === 'pulse') {
      return React.createElement('div', {
        className: cn('inline-flex items-center justify-center', className),
        role: 'status',
        'aria-label': label,
        ...props
      },
        styleTag,
        React.createElement('div', { className: 'relative', style: { width: dotSize * 4, height: dotSize * 4 } },
          React.createElement('div', { style: {
            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            width: dotSize, height: dotSize, borderRadius: '50%', backgroundColor: color
          }}),
          React.createElement('div', { style: {
            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            width: dotSize * 2.5, height: dotSize * 2.5, borderRadius: '50%',
            border: `2px solid ${color}`, animation: 'aikit-pulse-ring 1.5s ease-out infinite'
          }})
        )
      );
    }

    if (variant === 'wave') {
      return React.createElement('div', {
        className: cn('inline-flex items-end gap-0.5', className),
        role: 'status',
        'aria-label': label,
        style: { height: dotSize * 3 },
        ...props
      },
        styleTag,
        [0, 1, 2, 3].map(i =>
          React.createElement('div', {
            key: i,
            style: {
              width: dotSize * 0.5, height: dotSize * 2.5, borderRadius: 2,
              backgroundColor: color, animation: `aikit-wave 1.2s ease-in-out infinite`,
              animationDelay: `${i * 0.1}s`
            }
          })
        )
      );
    }

    // Default: dots
    return React.createElement('div', {
      className: cn('inline-flex items-center gap-1', className),
      role: 'status',
      'aria-label': label,
      ...props
    },
      styleTag,
      [0, 1, 2].map(i =>
        React.createElement('div', {
          key: i,
          style: {
            width: dotSize, height: dotSize, borderRadius: '50%',
            backgroundColor: color, animation: 'aikit-pulse-dot 1.4s infinite',
            animationDelay: `${i * 0.2}s`
          }
        })
      )
    );
  };

  // ============================================================
  // VideoPlayer — Enhanced HTML5 video with custom controls
  // ============================================================
  const VideoPlayer = ({ src, poster, title, autoPlay = false, controls = true, loop = false, muted = false, className = '', aspectRatio = '16/9', rounded = true, ...props }) => {
    const videoRef = React.useRef(null);
    const [isPlaying, setIsPlaying] = React.useState(autoPlay);
    const [progress, setProgress] = React.useState(0);
    const [duration, setDuration] = React.useState(0);
    const [currentTime, setCurrentTime] = React.useState(0);
    const [isMuted, setIsMuted] = React.useState(muted);
    const [showControls, setShowControls] = React.useState(true);

    const formatTime = (seconds) => {
      const m = Math.floor(seconds / 60);
      const s = Math.floor(seconds % 60);
      return m + ':' + (s < 10 ? '0' : '') + s;
    };

    const togglePlay = () => {
      const v = videoRef.current;
      if (!v) return;
      if (v.paused) { v.play(); setIsPlaying(true); }
      else { v.pause(); setIsPlaying(false); }
    };

    const toggleMute = () => {
      const v = videoRef.current;
      if (!v) return;
      v.muted = !v.muted;
      setIsMuted(v.muted);
    };

    const handleTimeUpdate = () => {
      const v = videoRef.current;
      if (!v) return;
      setCurrentTime(v.currentTime);
      setProgress((v.currentTime / v.duration) * 100);
    };

    const handleSeek = (e) => {
      const v = videoRef.current;
      if (!v) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const pct = (e.clientX - rect.left) / rect.width;
      v.currentTime = pct * v.duration;
    };

    // Play/Pause icons as inline SVG
    const PlayIcon = React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'white', stroke: 'none' },
      React.createElement('polygon', { points: '6,3 20,12 6,21' })
    );
    const PauseIcon = React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'white', stroke: 'none' },
      React.createElement('rect', { x: '5', y: '3', width: '4', height: '18', rx: '1' }),
      React.createElement('rect', { x: '15', y: '3', width: '4', height: '18', rx: '1' })
    );
    const VolumeIcon = React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'white', strokeWidth: 2 },
      isMuted
        ? React.createElement('path', { d: 'M11 5L6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6' })
        : React.createElement('path', { d: 'M11 5L6 9H2v6h4l5 4V5zM19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07' })
    );

    return React.createElement('div', {
      className: cn('relative group overflow-hidden bg-black', rounded && 'rounded-xl', className),
      style: { aspectRatio: aspectRatio },
      onMouseEnter: () => setShowControls(true),
      onMouseLeave: () => isPlaying && setShowControls(false),
      ...props
    },
      // Video element
      React.createElement('video', {
        ref: videoRef,
        src: src,
        poster: poster,
        autoPlay: autoPlay,
        loop: loop,
        muted: muted,
        playsInline: true,
        className: 'w-full h-full object-cover',
        onTimeUpdate: handleTimeUpdate,
        onLoadedMetadata: () => { if (videoRef.current) setDuration(videoRef.current.duration); },
        onEnded: () => setIsPlaying(false),
        onClick: togglePlay
      }),

      // Title overlay
      title && React.createElement('div', {
        className: 'absolute top-0 left-0 right-0 p-4 bg-gradient-to-b from-black/60 to-transparent',
        style: { opacity: showControls ? 1 : 0, transition: 'opacity 0.3s' }
      },
        React.createElement('p', { className: 'text-white font-semibold text-sm' }, title)
      ),

      // Center play button (when paused)
      !isPlaying && React.createElement('div', {
        className: 'absolute inset-0 flex items-center justify-center cursor-pointer',
        onClick: togglePlay
      },
        React.createElement('div', {
          className: 'w-16 h-16 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center hover:bg-white/30 transition-colors'
        },
          React.createElement('svg', { width: 28, height: 28, viewBox: '0 0 24 24', fill: 'white' },
            React.createElement('polygon', { points: '8,4 20,12 8,20' })
          )
        )
      ),

      // Bottom controls bar
      controls && React.createElement('div', {
        className: 'absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/80 to-transparent',
        style: { opacity: showControls ? 1 : 0, transition: 'opacity 0.3s' }
      },
        // Progress bar
        React.createElement('div', {
          className: 'w-full h-1 bg-white/30 rounded-full mb-2 cursor-pointer group/progress',
          onClick: handleSeek
        },
          React.createElement('div', {
            className: 'h-full bg-[#5867EF] rounded-full relative transition-all',
            style: { width: progress + '%' }
          },
            React.createElement('div', {
              className: 'absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full opacity-0 group-hover/progress:opacity-100 transition-opacity'
            })
          )
        ),
        // Controls row
        React.createElement('div', { className: 'flex items-center justify-between' },
          React.createElement('div', { className: 'flex items-center gap-3' },
            React.createElement('button', { onClick: togglePlay, className: 'text-white hover:text-white/80 transition-colors' },
              isPlaying ? PauseIcon : PlayIcon
            ),
            React.createElement('button', { onClick: toggleMute, className: 'text-white hover:text-white/80 transition-colors' },
              VolumeIcon
            ),
            React.createElement('span', { className: 'text-white/80 text-xs font-mono' },
              formatTime(currentTime) + ' / ' + formatTime(duration)
            )
          )
        )
      )
    );
  };

  // ============================================================
  // CodeDisplay — Syntax-highlighted code block with copy button
  // ============================================================
  const CodeDisplay = ({ code, language = 'javascript', title, showLineNumbers = true, theme = 'dark', className = '', ...props }) => {
    const [copied, setCopied] = React.useState(false);

    const themes = {
      dark: { bg: '#1e1e2e', text: '#cdd6f4', line: '#45475a', keyword: '#cba6f7', string: '#a6e3a1', comment: '#6c7086', number: '#fab387', fn: '#89b4fa', header: '#313244' },
      light: { bg: '#ffffff', text: '#1e293b', line: '#e2e8f0', keyword: '#7c3aed', string: '#059669', comment: '#94a3b8', number: '#ea580c', fn: '#2563eb', header: '#f8fafc' },
      'vs-dark': { bg: '#1e1e1e', text: '#d4d4d4', line: '#404040', keyword: '#569cd6', string: '#ce9178', comment: '#6a9955', number: '#b5cea8', fn: '#dcdcaa', header: '#252526' },
      monokai: { bg: '#272822', text: '#f8f8f2', line: '#3e3d32', keyword: '#f92672', string: '#e6db74', comment: '#75715e', number: '#ae81ff', fn: '#a6e22e', header: '#1e1f1c' },
    };

    const t = themes[theme] || themes.dark;

    const handleCopy = () => {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    };

    const lines = code.split('\n');

    return React.createElement('div', {
      className: cn('rounded-xl overflow-hidden border border-slate-200', className),
      ...props
    },
      // Header
      React.createElement('div', {
        className: 'flex items-center justify-between px-4 py-2',
        style: { backgroundColor: t.header }
      },
        React.createElement('div', { className: 'flex items-center gap-2' },
          React.createElement('div', { className: 'flex gap-1.5' },
            React.createElement('div', { className: 'w-3 h-3 rounded-full bg-red-500/80' }),
            React.createElement('div', { className: 'w-3 h-3 rounded-full bg-yellow-500/80' }),
            React.createElement('div', { className: 'w-3 h-3 rounded-full bg-green-500/80' })
          ),
          (title || language) && React.createElement('span', {
            style: { color: t.comment, fontSize: 12, marginLeft: 8, fontFamily: 'monospace' }
          }, title || language)
        ),
        React.createElement('button', {
          onClick: handleCopy,
          className: 'text-xs px-2 py-1 rounded transition-colors',
          style: { color: copied ? '#a6e3a1' : t.comment, backgroundColor: 'transparent', border: 'none', cursor: 'pointer' }
        }, copied ? 'Copied!' : 'Copy')
      ),
      // Code body
      React.createElement('div', {
        style: { backgroundColor: t.bg, padding: '16px', overflowX: 'auto' }
      },
        React.createElement('pre', { style: { margin: 0, fontFamily: "'Fira Code', 'Cascadia Code', 'JetBrains Mono', monospace", fontSize: 13, lineHeight: 1.6 } },
          lines.map((line, i) =>
            React.createElement('div', { key: i, className: 'flex' },
              showLineNumbers && React.createElement('span', {
                style: { color: t.line, minWidth: 40, textAlign: 'right', paddingRight: 16, userSelect: 'none', fontSize: 12 }
              }, i + 1),
              React.createElement('span', { style: { color: t.text } }, line || ' ')
            )
          )
        )
      )
    );
  };

  // ============================================================
  // StreamingText — Typewriter/streaming text effect
  // ============================================================
  const StreamingText = ({ text, speed = 30, className = '', onComplete, ...props }) => {
    const [displayed, setDisplayed] = React.useState('');
    const [isComplete, setIsComplete] = React.useState(false);

    React.useEffect(() => {
      let i = 0;
      setDisplayed('');
      setIsComplete(false);
      const timer = setInterval(() => {
        if (i < text.length) {
          setDisplayed(text.slice(0, i + 1));
          i++;
        } else {
          clearInterval(timer);
          setIsComplete(true);
          if (onComplete) onComplete();
        }
      }, speed);
      return () => clearInterval(timer);
    }, [text, speed]);

    return React.createElement('span', { className: className, ...props },
      displayed,
      !isComplete && React.createElement('span', {
        className: 'inline-block w-0.5 h-5 bg-current ml-0.5',
        style: { animation: 'aikit-pulse-dot 1s infinite' }
      })
    );
  };

  // ============================================================
  // ChatBubble — AI/User message display
  // ============================================================
  const ChatBubble = ({ role = 'assistant', children, avatar, name, timestamp, className = '', ...props }) => {
    const isUser = role === 'user';

    return React.createElement('div', {
      className: cn('flex gap-3', isUser && 'flex-row-reverse', className),
      ...props
    },
      // Avatar
      React.createElement('div', {
        className: cn(
          'w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0',
          isUser ? 'bg-[#5867EF] text-white' : 'bg-slate-200 text-slate-600'
        )
      }, avatar || (isUser ? 'U' : 'AI')),
      // Bubble
      React.createElement('div', { className: cn('max-w-[80%]', isUser && 'items-end') },
        name && React.createElement('p', {
          className: cn('text-xs font-medium text-slate-500 mb-1', isUser && 'text-right')
        }, name),
        React.createElement('div', {
          className: cn(
            'px-4 py-3 rounded-2xl text-sm leading-relaxed',
            isUser
              ? 'bg-[#5867EF] text-white rounded-tr-sm'
              : 'bg-slate-100 text-slate-800 rounded-tl-sm'
          )
        }, children),
        timestamp && React.createElement('p', {
          className: cn('text-xs text-slate-400 mt-1', isUser && 'text-right')
        }, timestamp)
      )
    );
  };

  // ============================================================
  // MediaGallery — Image/video grid with lightbox feel
  // ============================================================
  const MediaGallery = ({ items = [], columns = 3, gap = 4, className = '', ...props }) => {
    const [selected, setSelected] = React.useState(null);

    return React.createElement('div', { className: className, ...props },
      // Grid
      React.createElement('div', {
        className: 'grid gap-' + gap,
        style: { gridTemplateColumns: 'repeat(' + columns + ', 1fr)' }
      },
        items.map((item, i) =>
          React.createElement('div', {
            key: i,
            className: 'relative group cursor-pointer overflow-hidden rounded-xl bg-slate-100 aspect-video',
            onClick: () => setSelected(i)
          },
            item.type === 'video'
              ? React.createElement('video', {
                  src: item.src, poster: item.poster, className: 'w-full h-full object-cover',
                  muted: true, playsInline: true,
                  onMouseEnter: (e) => e.target.play(),
                  onMouseLeave: (e) => { e.target.pause(); e.target.currentTime = 0; }
                })
              : React.createElement('img', {
                  src: item.src, alt: item.alt || '', className: 'w-full h-full object-cover',
                  loading: 'lazy'
                }),
            // Overlay
            React.createElement('div', {
              className: 'absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-end'
            },
              item.title && React.createElement('p', {
                className: 'text-white text-sm font-medium p-3 opacity-0 group-hover:opacity-100 transition-opacity'
              }, item.title)
            )
          )
        )
      ),

      // Lightbox overlay
      selected !== null && React.createElement('div', {
        className: 'fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-8',
        onClick: () => setSelected(null)
      },
        React.createElement('button', {
          className: 'absolute top-4 right-4 text-white/70 hover:text-white text-2xl',
          onClick: () => setSelected(null)
        }, 'x'),
        items[selected] && (
          items[selected].type === 'video'
            ? React.createElement('video', {
                src: items[selected].src, controls: true, autoPlay: true,
                className: 'max-w-full max-h-full rounded-lg'
              })
            : React.createElement('img', {
                src: items[selected].src, alt: items[selected].alt || '',
                className: 'max-w-full max-h-full object-contain rounded-lg'
              })
        )
      )
    );
  };

  // ============================================================
  // Skeleton — Loading placeholder
  // ============================================================
  const Skeleton = ({ width, height, rounded = 'md', className = '', ...props }) => {
    const roundedMap = { sm: 'rounded', md: 'rounded-md', lg: 'rounded-lg', xl: 'rounded-xl', full: 'rounded-full' };
    return React.createElement('div', {
      className: cn('animate-pulse bg-slate-200', roundedMap[rounded] || 'rounded-md', className),
      style: { width: width || '100%', height: height || '1rem' },
      ...props
    });
  };

  // ============================================================
  // SkeletonCard — Card-shaped loading placeholder
  // ============================================================
  const SkeletonCard = ({ className = '', lines = 3, showAvatar = false, showImage = false, ...props }) => {
    return React.createElement('div', {
      className: cn('p-6 rounded-xl border border-slate-200 bg-white space-y-4', className),
      ...props
    },
      showImage && React.createElement(Skeleton, { height: '160px', rounded: 'lg' }),
      showAvatar && React.createElement('div', { className: 'flex items-center gap-3' },
        React.createElement(Skeleton, { width: '40px', height: '40px', rounded: 'full' }),
        React.createElement('div', { className: 'space-y-2 flex-1' },
          React.createElement(Skeleton, { width: '60%', height: '14px' }),
          React.createElement(Skeleton, { width: '40%', height: '12px' })
        )
      ),
      Array.from({ length: lines }).map((_, i) =>
        React.createElement(Skeleton, { key: i, width: i === lines - 1 ? '60%' : '100%', height: '12px' })
      )
    );
  };

  // ============================================================
  // MetricCard — Enhanced stat card with sparkline support
  // ============================================================
  const MetricCard = ({ title, value, change, changeType = 'neutral', icon, subtitle, sparklineData, className = '', ...props }) => {
    const changeColors = {
      positive: 'text-emerald-600 bg-emerald-50',
      negative: 'text-rose-600 bg-rose-50',
      neutral: 'text-slate-600 bg-slate-50'
    };

    // Simple sparkline using SVG polyline
    const renderSparkline = (data) => {
      if (!data || data.length < 2) return null;
      const max = Math.max(...data);
      const min = Math.min(...data);
      const range = max - min || 1;
      const w = 80, h = 30;
      const points = data.map((v, i) =>
        (i / (data.length - 1)) * w + ',' + (h - ((v - min) / range) * h)
      ).join(' ');

      return React.createElement('svg', { width: w, height: h, className: 'ml-auto' },
        React.createElement('polyline', {
          points: points,
          fill: 'none',
          stroke: changeType === 'positive' ? '#10b981' : changeType === 'negative' ? '#f43f5e' : '#5867EF',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round'
        })
      );
    };

    return React.createElement('div', {
      className: cn('bg-white rounded-xl border border-slate-200 shadow-ds-sm p-6 hover:shadow-ds-md transition-shadow', className),
      ...props
    },
      React.createElement('div', { className: 'flex items-start justify-between mb-4' },
        React.createElement('div', null,
          React.createElement('p', { className: 'text-sm font-medium text-slate-500' }, title),
          React.createElement('p', { className: 'text-2xl font-bold text-slate-900 mt-1' }, value)
        ),
        icon && React.createElement('div', {
          className: 'w-10 h-10 rounded-lg bg-[#5867EF]/10 flex items-center justify-center'
        }, icon)
      ),
      React.createElement('div', { className: 'flex items-center justify-between' },
        React.createElement('div', { className: 'flex items-center gap-2' },
          change && React.createElement('span', {
            className: cn('text-xs font-semibold px-2 py-0.5 rounded-full', changeColors[changeType])
          }, change),
          subtitle && React.createElement('span', { className: 'text-xs text-slate-400' }, subtitle)
        ),
        sparklineData && renderSparkline(sparklineData)
      )
    );
  };

  // ============================================================
  // EmptyState — Placeholder for empty content areas
  // ============================================================
  const EmptyState = ({ icon, title = 'No data', description, action, actionLabel = 'Get Started', className = '', ...props }) => {
    return React.createElement('div', {
      className: cn('flex flex-col items-center justify-center py-16 px-6 text-center', className),
      ...props
    },
      icon && React.createElement('div', {
        className: 'w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4 text-slate-400'
      }, icon),
      React.createElement('h3', { className: 'text-lg font-semibold text-slate-900 mb-2' }, title),
      description && React.createElement('p', { className: 'text-sm text-slate-500 max-w-sm mb-6' }, description),
      action && React.createElement('button', {
        onClick: action,
        className: 'h-10 px-6 bg-[#5867EF] hover:bg-[#4B6FED] text-white rounded-lg text-sm font-semibold transition-colors'
      }, actionLabel)
    );
  };

  // ============================================================
  // AIKitSidebar — Collapsible sidebar navigation
  // ============================================================
  const AIKitSidebar = ({ items = [], activeItem, onItemClick, collapsed = false, onToggle, logo, title, className = '', ...props }) => {
    return React.createElement('aside', {
      className: cn('flex flex-col bg-[#131726] text-white transition-all duration-300 sticky top-0 h-screen', collapsed ? 'w-16' : 'w-64', className),
      ...props
    },
      // Header
      React.createElement('div', { className: 'p-4 flex items-center justify-between border-b border-white/10' },
        !collapsed && React.createElement('div', { className: 'flex items-center gap-2' },
          logo || React.createElement('div', { className: 'w-8 h-8 bg-[#5867EF] rounded-lg flex items-center justify-center text-white font-bold text-sm' }, (title || 'A')[0]),
          React.createElement('span', { className: 'font-bold text-lg' }, title || 'App')
        ),
        onToggle && React.createElement('button', {
          onClick: onToggle, className: 'p-1.5 rounded-lg hover:bg-white/10 transition-colors'
        }, React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
          collapsed ? React.createElement('path', { d: 'M9 18l6-6-6-6' }) : React.createElement('path', { d: 'M15 18l-6-6 6-6' })
        ))
      ),
      // Nav items
      React.createElement('nav', { className: 'flex-1 p-3 space-y-1 overflow-y-auto' },
        items.map((item, i) =>
          React.createElement('button', {
            key: i,
            onClick: () => onItemClick && onItemClick(item.id || item.label),
            className: cn(
              'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all',
              (activeItem === (item.id || item.label)) ? 'bg-[#5867EF] text-white' : 'text-slate-400 hover:text-white hover:bg-white/10'
            )
          },
            item.icon && React.createElement('span', { className: 'flex-shrink-0 w-5 h-5 flex items-center justify-center' }, item.icon),
            !collapsed && React.createElement('span', null, item.label),
            !collapsed && item.badge && React.createElement('span', {
              className: 'ml-auto text-xs bg-[#5867EF]/30 text-[#5867EF] px-2 py-0.5 rounded-full'
            }, item.badge)
          )
        )
      ),
      // Footer
      React.createElement('div', { className: 'p-3 border-t border-white/10' },
        React.createElement('button', {
          className: 'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-slate-400 hover:text-white hover:bg-white/10 transition-all'
        },
          React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
            React.createElement('path', { d: 'M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9' })
          ),
          !collapsed && React.createElement('span', null, 'Sign Out')
        )
      )
    );
  };

  // ============================================================
  // AIKitHeader — App header with logo, nav, search, user menu
  // ============================================================
  const AIKitHeader = ({ title, logo, navItems = [], actions, user, onSearch, className = '', ...props }) => {
    const [searchOpen, setSearchOpen] = React.useState(false);
    const [searchQuery, setSearchQuery] = React.useState('');

    return React.createElement('header', {
      className: cn('sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200', className),
      ...props
    },
      React.createElement('div', { className: 'max-w-7xl mx-auto px-6 h-16 flex items-center justify-between' },
        // Left: logo + nav
        React.createElement('div', { className: 'flex items-center gap-8' },
          React.createElement('div', { className: 'flex items-center gap-2' },
            logo || React.createElement('div', { className: 'w-8 h-8 bg-[#5867EF] rounded-lg flex items-center justify-center' },
              React.createElement('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'white', strokeWidth: 2.5 },
                React.createElement('polygon', { points: '13 2 3 14 12 14 11 22 21 10 12 10 13 2' })
              )
            ),
            React.createElement('span', { className: 'text-xl font-bold text-slate-900' }, safeChild(title) || 'App')
          ),
          navItems.length > 0 && React.createElement('nav', { className: 'hidden md:flex items-center gap-6' },
            navItems.map((item, i) =>
              React.createElement('a', {
                key: i, href: item.href || '#',
                className: cn('text-sm font-medium transition-colors', item.active ? 'text-slate-900' : 'text-slate-600 hover:text-slate-900')
              }, safeChild(item.label))
            )
          )
        ),
        // Right: search + actions + user
        React.createElement('div', { className: 'flex items-center gap-3' },
          onSearch && React.createElement('div', { className: 'relative hidden md:block' },
            React.createElement('svg', { className: 'absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400', width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
              React.createElement('circle', { cx: '11', cy: '11', r: '8' }),
              React.createElement('path', { d: 'm21 21-4.3-4.3' })
            ),
            React.createElement('input', {
              placeholder: 'Search...', value: searchQuery,
              onChange: (e) => { setSearchQuery(e.target.value); onSearch(e.target.value); },
              className: 'pl-10 h-9 w-64 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-[#5867EF]/20 focus:border-[#5867EF]'
            })
          ),
          renderActionLike(actions),
          user && React.createElement('div', { className: 'w-9 h-9 rounded-full bg-[#5867EF] flex items-center justify-center text-white text-sm font-semibold' },
            userInitials(user)
          )
        )
      )
    );
  };

  // ============================================================
  // AIKitTable — Data table with sorting, filtering
  // ============================================================
  const AIKitTable = ({ columns = [], data = [], onSort, sortColumn, sortDirection, className = '', ...props }) => {
    return React.createElement('div', { className: cn('overflow-x-auto rounded-xl border border-slate-200', className), ...props },
      React.createElement('table', { className: 'w-full' },
        React.createElement('thead', null,
          React.createElement('tr', { className: 'bg-slate-50 border-b border-slate-200' },
            columns.map((col, i) =>
              React.createElement('th', {
                key: i, className: 'px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer hover:text-slate-700',
                onClick: () => onSort && onSort(col.key)
              },
                React.createElement('div', { className: 'flex items-center gap-1' },
                  safeChild(col.label),
                  sortColumn === col.key && React.createElement('svg', { width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
                    sortDirection === 'asc' ? React.createElement('path', { d: 'M12 19V5M5 12l7-7 7 7' }) : React.createElement('path', { d: 'M12 5v14M5 12l7 7 7-7' })
                  )
                )
              )
            )
          )
        ),
        React.createElement('tbody', null,
          data.map((row, i) =>
            React.createElement('tr', { key: i, className: 'border-b border-slate-100 hover:bg-slate-50/50 transition-colors' },
              columns.map((col, j) =>
                React.createElement('td', { key: j, className: 'px-4 py-3 text-sm text-slate-700' },
                  safeChild(col.render ? col.render(row[col.key], row) : (row[col.key] != null ? row[col.key] : ''))
                )
              )
            )
          )
        )
      )
    );
  };

  // ============================================================
  // AIKitTimeline — Event timeline
  // ============================================================
  const AIKitTimeline = ({ items = [], className = '', ...props }) => {
    return React.createElement('div', { className: cn('space-y-0', className), ...props },
      items.map((item, i) =>
        React.createElement('div', { key: i, className: 'flex gap-4' },
          // Line + dot
          React.createElement('div', { className: 'flex flex-col items-center' },
            React.createElement('div', {
              className: cn('w-3 h-3 rounded-full border-2 flex-shrink-0', item.color || 'border-[#5867EF] bg-[#5867EF]')
            }),
            i < items.length - 1 && React.createElement('div', { className: 'w-0.5 flex-1 bg-slate-200 my-1' })
          ),
          // Content
          React.createElement('div', { className: 'pb-6 -mt-0.5' },
            React.createElement('p', { className: 'text-sm font-semibold text-slate-900' }, item.title),
            item.description && React.createElement('p', { className: 'text-sm text-slate-500 mt-0.5' }, item.description),
            item.time && React.createElement('p', { className: 'text-xs text-slate-400 mt-1' }, item.time)
          )
        )
      )
    );
  };

  // ============================================================
  // AIKitStepper — Multi-step progress indicator
  // ============================================================
  const AIKitStepper = ({ steps = [], currentStep = 0, className = '', ...props }) => {
    return React.createElement('div', { className: cn('flex items-center', className), ...props },
      steps.map((step, i) =>
        React.createElement(React.Fragment, { key: i },
          React.createElement('div', { className: 'flex items-center gap-2' },
            React.createElement('div', {
              className: cn(
                'w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors',
                i < currentStep ? 'bg-[#338585] text-white' :
                i === currentStep ? 'bg-[#5867EF] text-white' :
                'bg-slate-200 text-slate-500'
              )
            }, i < currentStep
              ? React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 3 }, React.createElement('path', { d: 'M20 6L9 17l-5-5' }))
              : i + 1
            ),
            React.createElement('span', {
              className: cn('text-sm font-medium', i <= currentStep ? 'text-slate-900' : 'text-slate-400')
            }, step)
          ),
          i < steps.length - 1 && React.createElement('div', {
            className: cn('flex-1 h-0.5 mx-3', i < currentStep ? 'bg-[#338585]' : 'bg-slate-200')
          })
        )
      )
    );
  };

  // ============================================================
  // AIKitPriceCard — Pricing card with features list
  // ============================================================
  const AIKitPriceCard = ({ name, price, period = '/month', description, features = [], cta = 'Get Started', popular = false, onAction, className = '', ...props }) => {
    return React.createElement('div', {
      className: cn(
        'rounded-xl transition-all duration-300 p-8',
        popular ? 'border-2 border-[#5867EF] shadow-ds-lg relative' : 'border border-slate-200 shadow-ds-sm hover:shadow-ds-md',
        className
      ),
      ...props
    },
      popular && React.createElement('div', { className: 'absolute -top-3 left-1/2 -translate-x-1/2' },
        React.createElement('span', { className: 'bg-[#5867EF] text-white text-xs font-semibold px-3 py-1 rounded-full' }, 'Most Popular')
      ),
      React.createElement('h3', { className: 'text-lg font-semibold text-slate-900' }, name),
      description && React.createElement('p', { className: 'text-sm text-slate-500 mt-1' }, description),
      React.createElement('div', { className: 'mt-6 mb-6' },
        React.createElement('span', { className: 'text-4xl font-bold text-slate-900' }, price),
        React.createElement('span', { className: 'text-slate-500' }, period)
      ),
      React.createElement('button', {
        onClick: onAction,
        className: cn(
          'w-full h-11 rounded-xl font-semibold text-sm transition-colors',
          popular ? 'bg-[#5867EF] hover:bg-[#4B6FED] text-white' : 'bg-slate-900 hover:bg-slate-800 text-white'
        )
      }, cta),
      React.createElement('div', { className: 'mt-8 space-y-3' },
        features.map((f, i) =>
          React.createElement('div', { key: i, className: 'flex items-center gap-3 text-sm text-slate-600' },
            React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: '#338585', strokeWidth: 2, className: 'flex-shrink-0' },
              React.createElement('path', { d: 'M20 6L9 17l-5-5' })
            ),
            f
          )
        )
      )
    );
  };

  // ============================================================
  // AIKitRating — Star rating display
  // ============================================================
  const AIKitRating = ({ value = 0, max = 5, size = 16, color = '#FCAE39', showValue = false, reviews, className = '', ...props }) => {
    return React.createElement('div', { className: cn('flex items-center gap-1', className), ...props },
      Array.from({ length: max }).map((_, i) =>
        React.createElement('svg', {
          key: i, width: size, height: size, viewBox: '0 0 24 24',
          fill: i < Math.floor(value) ? color : 'none',
          stroke: color, strokeWidth: 2
        },
          React.createElement('polygon', { points: '12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2' })
        )
      ),
      showValue && React.createElement('span', { className: 'text-sm font-semibold text-slate-900 ml-1' }, value.toFixed(1)),
      reviews !== undefined && React.createElement('span', { className: 'text-sm text-slate-400' }, '(' + reviews.toLocaleString() + ')')
    );
  };

  // ============================================================
  // AIKitProductCard — E-commerce product card
  // ============================================================
  const AIKitProductCard = ({ name, price, originalPrice, image, rating, reviews, badge, colors = [], onAddToCart, className = '', ...props }) => {
    return React.createElement('div', {
      className: cn('group border border-slate-200 rounded-xl overflow-hidden hover:shadow-ds-md transition-all duration-300 hover:-translate-y-0.5', className),
      ...props
    },
      // Image area
      React.createElement('div', { className: 'aspect-[4/3] bg-slate-100 relative overflow-hidden' },
        image
          ? React.createElement('img', { src: image, alt: name, className: 'w-full h-full object-cover', loading: 'lazy' })
          : React.createElement('div', { className: 'w-full h-full flex items-center justify-center' },
              React.createElement('svg', { width: 48, height: 48, viewBox: '0 0 24 24', fill: 'none', stroke: '#cbd5e1', strokeWidth: 1.5 },
                React.createElement('path', { d: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4' })
              )
            ),
        badge && React.createElement('div', { className: 'absolute top-3 left-3' },
          React.createElement('span', { className: 'bg-white/90 backdrop-blur-sm text-slate-900 text-xs font-semibold px-2.5 py-1 rounded-full shadow-sm' }, badge)
        ),
        React.createElement('button', { className: 'absolute top-3 right-3 p-2 rounded-full bg-white/90 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity shadow-sm hover:bg-white' },
          React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: '#475569', strokeWidth: 2 },
            React.createElement('path', { d: 'M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z' })
          )
        )
      ),
      // Content
      React.createElement('div', { className: 'p-5' },
        React.createElement('div', { className: 'flex items-start justify-between mb-2' },
          React.createElement('h3', { className: 'font-semibold text-slate-900 leading-snug' }, name),
          React.createElement('div', { className: 'text-right ml-3' },
            React.createElement('span', { className: 'text-lg font-bold text-slate-900' }, 'USD ' + price),
            originalPrice && React.createElement('span', { className: 'text-sm text-slate-400 line-through ml-2' }, 'USD ' + originalPrice)
          )
        ),
        (rating || reviews) && React.createElement(AIKitRating, { value: rating || 0, showValue: true, reviews: reviews, size: 14, className: 'mb-4' }),
        React.createElement('div', { className: 'flex items-center justify-between' },
          colors.length > 0 && React.createElement('div', { className: 'flex gap-1.5' },
            colors.map((c, i) => React.createElement('div', { key: i, className: 'w-5 h-5 rounded-full border-2 border-white shadow-sm', style: { backgroundColor: c } }))
          ),
          React.createElement('button', {
            onClick: onAddToCart,
            className: 'h-9 px-4 bg-[#5867EF] hover:bg-[#4B6FED] text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2'
          },
            React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
              React.createElement('circle', { cx: '9', cy: '21', r: '1' }),
              React.createElement('circle', { cx: '20', cy: '21', r: '1' }),
              React.createElement('path', { d: 'M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6' })
            ),
            'Add to Cart'
          )
        )
      )
    );
  };

  // ============================================================
  // AIKitBanner — Announcement/notification banner
  // ============================================================
  const AIKitBanner = ({ children, variant = 'info', icon, dismissible = false, onDismiss, className = '', ...props }) => {
    const [dismissed, setDismissed] = React.useState(false);
    if (dismissed) return null;

    const variants = {
      info: 'bg-[#5867EF]/10 text-[#5867EF] border-[#5867EF]/20',
      success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      warning: 'bg-[#FCAE39]/10 text-amber-700 border-[#FCAE39]/20',
      error: 'bg-rose-50 text-rose-700 border-rose-200',
    };

    return React.createElement('div', {
      className: cn('flex items-center gap-3 px-4 py-3 rounded-xl border text-sm', variants[variant], className),
      role: variant === 'error' ? 'alert' : 'status',
      ...props
    },
      icon,
      React.createElement('span', { className: 'flex-1' }, children),
      dismissible && React.createElement('button', {
        onClick: () => { setDismissed(true); onDismiss && onDismiss(); },
        className: 'p-1 rounded hover:bg-black/5 transition-colors'
      }, React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
        React.createElement('path', { d: 'M18 6L6 18M6 6l12 12' })
      ))
    );
  };

  // ============================================================
  // AIKitAvatar — Enhanced avatar with status indicator
  // ============================================================
  const AIKitAvatar = ({ src, name, size = 'md', status, className = '', ...props }) => {
    const sizes = { sm: 'w-8 h-8 text-xs', md: 'w-10 h-10 text-sm', lg: 'w-12 h-12 text-base', xl: 'w-16 h-16 text-lg' };
    const statusColors = { online: 'bg-emerald-500', offline: 'bg-slate-400', busy: 'bg-rose-500', away: 'bg-amber-500' };
    const initials = name ? name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() : '?';

    return React.createElement('div', { className: cn('relative inline-flex', className), ...props },
      src
        ? React.createElement('img', { src, alt: name, className: cn('rounded-full object-cover', sizes[size]) })
        : React.createElement('div', {
            className: cn('rounded-full bg-[#5867EF]/10 text-[#5867EF] font-semibold flex items-center justify-center', sizes[size])
          }, initials),
      status && React.createElement('div', {
        className: cn('absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white', statusColors[status] || 'bg-slate-400')
      })
    );
  };

  // ============================================================
  // AIKitBreadcrumb — Navigation breadcrumbs
  // ============================================================
  const AIKitBreadcrumb = ({ items = [], className = '', ...props }) => {
    return React.createElement('nav', { className: cn('flex items-center gap-1 text-sm', className), 'aria-label': 'Breadcrumb', ...props },
      items.map((item, i) =>
        React.createElement(React.Fragment, { key: i },
          i > 0 && React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: '#94a3b8', strokeWidth: 2, className: 'mx-1' },
            React.createElement('path', { d: 'M9 18l6-6-6-6' })
          ),
          i === items.length - 1
            ? React.createElement('span', { className: 'font-medium text-slate-900' }, item.label)
            : React.createElement('a', { href: item.href || '#', className: 'text-slate-500 hover:text-slate-700 transition-colors' }, item.label)
        )
      )
    );
  };

  // ============================================================
  // AIKitPagination — Page navigation
  // ============================================================
  const AIKitPagination = ({ currentPage = 1, totalPages = 1, onPageChange, className = '', ...props }) => {
    const pages = [];
    for (let i = Math.max(1, currentPage - 2); i <= Math.min(totalPages, currentPage + 2); i++) pages.push(i);

    return React.createElement('div', { className: cn('flex items-center gap-1', className), ...props },
      React.createElement('button', {
        onClick: () => onPageChange && onPageChange(currentPage - 1),
        disabled: currentPage <= 1,
        className: 'h-9 w-9 rounded-lg border border-slate-200 flex items-center justify-center hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
      }, React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 }, React.createElement('path', { d: 'M15 18l-6-6 6-6' }))),
      pages.map(p =>
        React.createElement('button', {
          key: p,
          onClick: () => onPageChange && onPageChange(p),
          className: cn('h-9 w-9 rounded-lg text-sm font-medium transition-colors',
            p === currentPage ? 'bg-[#5867EF] text-white' : 'border border-slate-200 hover:bg-slate-50 text-slate-600')
        }, p)
      ),
      React.createElement('button', {
        onClick: () => onPageChange && onPageChange(currentPage + 1),
        disabled: currentPage >= totalPages,
        className: 'h-9 w-9 rounded-lg border border-slate-200 flex items-center justify-center hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
      }, React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 }, React.createElement('path', { d: 'M9 18l6-6-6-6' })))
    );
  };

  // ============================================================
  // AgentCard — Individual agent status display
  // ============================================================
  const AgentCard = ({ name, role, status = 'idle', avatar, tasks = 0, uptime, model, tokenUsage, onAction, className = '', ...props }) => {
    const statusConfig = {
      active: { color: 'bg-emerald-500', label: 'Active', ring: 'ring-emerald-500/20' },
      idle: { color: 'bg-slate-400', label: 'Idle', ring: 'ring-slate-400/20' },
      busy: { color: 'bg-amber-500', label: 'Busy', ring: 'ring-amber-500/20' },
      error: { color: 'bg-rose-500', label: 'Error', ring: 'ring-rose-500/20' },
      offline: { color: 'bg-slate-300', label: 'Offline', ring: 'ring-slate-300/20' },
    };
    const st = statusConfig[status] || statusConfig.idle;

    return React.createElement('div', {
      className: cn('bg-white rounded-xl border border-slate-200 shadow-ds-sm p-5 hover:shadow-ds-md transition-all', className),
      ...props
    },
      React.createElement('div', { className: 'flex items-start justify-between mb-4' },
        React.createElement('div', { className: 'flex items-center gap-3' },
          React.createElement('div', { className: 'relative' },
            React.createElement('div', { className: cn('w-11 h-11 rounded-xl bg-[#5867EF]/10 flex items-center justify-center text-[#5867EF] font-bold text-sm') },
              avatar || (name ? name.slice(0, 2).toUpperCase() : 'AG')
            ),
            React.createElement('div', { className: cn('absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white', st.color) })
          ),
          React.createElement('div', null,
            React.createElement('h4', { className: 'font-semibold text-slate-900 text-sm' }, name),
            React.createElement('p', { className: 'text-xs text-slate-500' }, role)
          )
        ),
        React.createElement('span', {
          className: cn('text-xs font-medium px-2 py-1 rounded-full', st.color === 'bg-emerald-500' ? 'bg-emerald-50 text-emerald-700' : st.color === 'bg-amber-500' ? 'bg-amber-50 text-amber-700' : st.color === 'bg-rose-500' ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-600')
        }, st.label)
      ),
      React.createElement('div', { className: 'grid grid-cols-2 gap-3 mb-4' },
        React.createElement('div', { className: 'text-center p-2 bg-slate-50 rounded-lg' },
          React.createElement('p', { className: 'text-lg font-bold text-slate-900' }, tasks),
          React.createElement('p', { className: 'text-xs text-slate-500' }, 'Tasks')
        ),
        uptime && React.createElement('div', { className: 'text-center p-2 bg-slate-50 rounded-lg' },
          React.createElement('p', { className: 'text-lg font-bold text-slate-900' }, uptime),
          React.createElement('p', { className: 'text-xs text-slate-500' }, 'Uptime')
        )
      ),
      (model || tokenUsage) && React.createElement('div', { className: 'flex items-center justify-between text-xs text-slate-400 mb-3' },
        model && React.createElement('span', null, model),
        tokenUsage && React.createElement('span', null, tokenUsage + ' tokens')
      ),
      onAction && React.createElement('button', {
        onClick: onAction,
        className: 'w-full h-9 text-sm font-medium rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 transition-colors'
      }, status === 'active' ? 'Pause' : status === 'error' ? 'Restart' : 'Start')
    );
  };

  // ============================================================
  // SwarmView — Multi-agent swarm visualization
  // ============================================================
  const SwarmView = ({ agents = [], title = 'Agent Swarm', status = 'active', totalTasks = 0, completedTasks = 0, className = '', ...props }) => {
    const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    return React.createElement('div', {
      className: cn('bg-white rounded-xl border border-slate-200 shadow-ds-sm', className),
      ...props
    },
      // Header
      React.createElement('div', { className: 'p-5 border-b border-slate-100' },
        React.createElement('div', { className: 'flex items-center justify-between mb-3' },
          React.createElement('div', { className: 'flex items-center gap-2' },
            React.createElement('div', { className: 'w-2 h-2 rounded-full bg-emerald-500 animate-pulse' }),
            React.createElement('h3', { className: 'font-semibold text-slate-900' }, title)
          ),
          React.createElement('span', {
            className: cn('text-xs font-medium px-2.5 py-1 rounded-full', status === 'active' ? 'bg-emerald-50 text-emerald-700' : status === 'error' ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-600')
          }, status.charAt(0).toUpperCase() + status.slice(1))
        ),
        // Progress bar
        totalTasks > 0 && React.createElement('div', null,
          React.createElement('div', { className: 'flex items-center justify-between text-xs text-slate-500 mb-1' },
            React.createElement('span', null, completedTasks + ' / ' + totalTasks + ' tasks'),
            React.createElement('span', null, progress + '%')
          ),
          React.createElement('div', { className: 'h-2 bg-slate-100 rounded-full overflow-hidden' },
            React.createElement('div', { className: 'h-full bg-[#5867EF] rounded-full transition-all', style: { width: progress + '%' } })
          )
        )
      ),
      // Agent grid
      React.createElement('div', { className: 'p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4' },
        agents.map(function(agent, i) {
          return React.createElement(AgentCard, Object.assign({ key: i }, agent));
        })
      )
    );
  };

  // ============================================================
  // AgentTimeline — Agent execution trace/timeline
  // ============================================================
  const AgentTimeline = ({ events = [], title = 'Execution Trace', className = '', ...props }) => {
    const typeConfig = {
      thinking: { color: 'border-purple-500 bg-purple-500', icon: 'B', label: 'Thinking' },
      tool_call: { color: 'border-[#5867EF] bg-[#5867EF]', icon: 'T', label: 'Tool Call' },
      response: { color: 'border-emerald-500 bg-emerald-500', icon: 'R', label: 'Response' },
      error: { color: 'border-rose-500 bg-rose-500', icon: '!', label: 'Error' },
      handoff: { color: 'border-amber-500 bg-amber-500', icon: 'H', label: 'Handoff' },
      checkpoint: { color: 'border-[#338585] bg-[#338585]', icon: 'C', label: 'Checkpoint' },
    };

    return React.createElement('div', { className: cn('bg-white rounded-xl border border-slate-200 shadow-ds-sm p-5', className), ...props },
      React.createElement('h3', { className: 'font-semibold text-slate-900 mb-4' }, title),
      React.createElement('div', { className: 'space-y-0' },
        events.map(function(event, i) {
          var cfg = typeConfig[event.type] || typeConfig.response;
          return React.createElement('div', { key: i, className: 'flex gap-3' },
            React.createElement('div', { className: 'flex flex-col items-center' },
              React.createElement('div', { className: cn('w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0', cfg.color) }, cfg.icon),
              i < events.length - 1 && React.createElement('div', { className: 'w-0.5 flex-1 bg-slate-200 my-1' })
            ),
            React.createElement('div', { className: 'pb-5 -mt-0.5 flex-1 min-w-0' },
              React.createElement('div', { className: 'flex items-center gap-2 mb-0.5' },
                React.createElement('span', { className: 'text-sm font-semibold text-slate-900' }, event.agent || cfg.label),
                event.duration && React.createElement('span', { className: 'text-xs text-slate-400' }, event.duration)
              ),
              event.message && React.createElement('p', { className: 'text-sm text-slate-600' }, event.message),
              event.tokens && React.createElement('span', { className: 'text-xs text-slate-400 mt-1 block' }, event.tokens + ' tokens')
            )
          );
        })
      )
    );
  };

  // ============================================================
  // SafetyBadge — AI safety / trust score indicator
  // ============================================================
  const SafetyBadge = ({ score, label, level, className = '', ...props }) => {
    var lvl = level || (score >= 90 ? 'safe' : score >= 70 ? 'caution' : 'warning');
    var config = {
      safe: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', icon: 'M20 6L9 17l-5-5' },
      caution: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', icon: 'M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
      warning: { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200', icon: 'M12 9v2m0 4h.01m5.66-9.66a9 9 0 11-12.73 0' },
    };
    var c = config[lvl] || config.caution;

    return React.createElement('div', {
      className: cn('inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold', c.bg, c.text, c.border, className),
      ...props
    },
      React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.5 },
        React.createElement('path', { d: c.icon })
      ),
      label || (score !== undefined ? score + '%' : lvl.charAt(0).toUpperCase() + lvl.slice(1))
    );
  };

  // ============================================================
  // GuardrailPanel — AI safety guardrails display
  // ============================================================
  const GuardrailPanel = ({ rules = [], title = 'Safety Guardrails', className = '', ...props }) => {
    return React.createElement('div', {
      className: cn('bg-white rounded-xl border border-slate-200 shadow-ds-sm p-5', className),
      ...props
    },
      React.createElement('div', { className: 'flex items-center gap-2 mb-4' },
        React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: '#5867EF', strokeWidth: 2 },
          React.createElement('path', { d: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' })
        ),
        React.createElement('h3', { className: 'font-semibold text-slate-900' }, title)
      ),
      React.createElement('div', { className: 'space-y-2' },
        rules.map(function(rule, i) {
          var passed = rule.status === 'passed' || rule.passed;
          return React.createElement('div', {
            key: i, className: 'flex items-center gap-3 p-3 rounded-lg bg-slate-50'
          },
            React.createElement('div', {
              className: cn('w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0', passed ? 'bg-emerald-100' : 'bg-rose-100')
            },
              React.createElement('svg', { width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none', stroke: passed ? '#059669' : '#e11d48', strokeWidth: 3 },
                passed ? React.createElement('path', { d: 'M20 6L9 17l-5-5' }) : React.createElement('path', { d: 'M18 6L6 18M6 6l12 12' })
              )
            ),
            React.createElement('div', { className: 'flex-1 min-w-0' },
              React.createElement('p', { className: 'text-sm font-medium text-slate-900' }, rule.name),
              rule.description && React.createElement('p', { className: 'text-xs text-slate-500' }, rule.description)
            ),
            React.createElement(SafetyBadge, { level: passed ? 'safe' : 'warning', label: passed ? 'Pass' : 'Fail' })
          );
        })
      )
    );
  };

  // ============================================================
  // TokenUsageBar — Token consumption visualization
  // ============================================================
  const TokenUsageBar = ({ used = 0, limit = 100000, label = 'Token Usage', className = '', ...props }) => {
    var pct = Math.min(Math.round((used / limit) * 100), 100);
    var color = pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : '#5867EF';

    return React.createElement('div', { className: cn('', className), ...props },
      React.createElement('div', { className: 'flex items-center justify-between mb-1' },
        React.createElement('span', { className: 'text-sm font-medium text-slate-700' }, label),
        React.createElement('span', { className: 'text-sm text-slate-500' }, used.toLocaleString() + ' / ' + limit.toLocaleString())
      ),
      React.createElement('div', { className: 'h-2.5 bg-slate-100 rounded-full overflow-hidden' },
        React.createElement('div', { className: 'h-full rounded-full transition-all duration-500', style: { width: pct + '%', backgroundColor: color } })
      ),
      React.createElement('p', { className: 'text-xs text-slate-400 mt-1' }, pct + '% used')
    );
  };

  // ============================================================
  // ConnectionStatus — Agent connection state indicator
  // ============================================================
  const ConnectionStatus = ({ status = 'disconnected', agentName, latency, className = '', ...props }) => {
    var config = {
      connected: { color: 'bg-emerald-500', text: 'text-emerald-700', bg: 'bg-emerald-50', label: 'Connected' },
      connecting: { color: 'bg-amber-500', text: 'text-amber-700', bg: 'bg-amber-50', label: 'Connecting...' },
      disconnected: { color: 'bg-slate-400', text: 'text-slate-600', bg: 'bg-slate-50', label: 'Disconnected' },
      reconnecting: { color: 'bg-amber-500', text: 'text-amber-700', bg: 'bg-amber-50', label: 'Reconnecting...' },
      error: { color: 'bg-rose-500', text: 'text-rose-700', bg: 'bg-rose-50', label: 'Error' },
    };
    var c = config[status] || config.disconnected;

    return React.createElement('div', {
      className: cn('inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium', c.bg, c.text, className),
      ...props
    },
      React.createElement('div', { className: cn('w-2 h-2 rounded-full', c.color, status === 'connecting' || status === 'reconnecting' ? 'animate-pulse' : '') }),
      agentName && React.createElement('span', { className: 'font-semibold' }, agentName + ':'),
      React.createElement('span', null, c.label),
      latency && status === 'connected' && React.createElement('span', { className: 'text-slate-400' }, latency + 'ms')
    );
  };

  // ============================================================
  // Export ALL AIKit/AINative Primitive components
  // ============================================================
  if (typeof window !== 'undefined') {
    window.AIKitComponents = hardenAll({
      // Core AI Components
      StreamingIndicator,
      VideoPlayer,
      CodeDisplay,
      StreamingText,
      ChatBubble,
      // Layout & Navigation
      AIKitSidebar,
      AIKitHeader,
      AIKitBreadcrumb,
      AIKitPagination,
      AIKitStepper,
      AIKitTimeline,
      // Data Display
      MetricCard,
      AIKitTable,
      AIKitRating,
      AIKitProductCard,
      AIKitPriceCard,
      AIKitAvatar,
      AIKitBanner,
      // Media
      MediaGallery,
      // Agent & Swarm
      AgentCard,
      SwarmView,
      AgentTimeline,
      ConnectionStatus,
      TokenUsageBar,
      // AI Safety
      SafetyBadge,
      GuardrailPanel,
      // Loading & Empty States
      Skeleton,
      SkeletonCard,
      EmptyState,
    });
  }
})();
