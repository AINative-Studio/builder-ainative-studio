'use client'

/**
 * OnboardingVideo — left-column slot on the Live dashboard (#51).
 *
 * Renders a clean HTML5 <video> wrapper in the "Hire the swarm" column so the
 * slot is never a raw black box. The video source is driven by a single constant
 * (ONBOARDING_VIDEO_SRC) so swapping in the real onboarding video is a one-line
 * change. A poster image + play affordance gives a professional placeholder state
 * until the real clip arrives.
 *
 * AIKit 0.2.0 ships CodeBlock / StreamingMessage / ProgressBar but no VideoPlayer,
 * so we use a native <video> element styled to match the .modernist chrome.
 */

import { useRef, useState } from 'react'

// ---------------------------------------------------------------------------
// Config — swap these two lines when the real onboarding video is ready.
// ---------------------------------------------------------------------------

/** Primary video source.  Set NEXT_PUBLIC_ONBOARDING_VIDEO_SRC to override. */
export const ONBOARDING_VIDEO_SRC: string =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_ONBOARDING_VIDEO_SRC) ||
  '' // empty = placeholder only (no <source> element, shows poster + CTA copy)

/** Poster frame shown before playback and in placeholder state. */
export const ONBOARDING_VIDEO_POSTER: string =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_ONBOARDING_VIDEO_POSTER) ||
  ''  // empty = CSS gradient poster

// ---------------------------------------------------------------------------

interface OnboardingVideoProps {
  /** Override the video src at the call-site (e.g. in tests). */
  src?: string
  /** Override the poster at the call-site. */
  poster?: string
  className?: string
}

export function OnboardingVideo({ src, poster, className }: OnboardingVideoProps) {
  const videoSrc = src ?? ONBOARDING_VIDEO_SRC
  const videoPoster = poster ?? ONBOARDING_VIDEO_POSTER
  const videoRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)

  const handlePlay = () => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) {
      v.play().catch(() => {})
      setPlaying(true)
    } else {
      v.pause()
      setPlaying(false)
    }
  }

  const onEnded = () => setPlaying(false)
  const onPause = () => setPlaying(false)
  const onPlaying = () => setPlaying(true)

  const isPlaceholder = !videoSrc

  return (
    <div
      className={`m-live-card m-onboarding-video${className ? ` ${className}` : ''}`}
      data-testid="onboarding-video-card"
    >
      <div className="m-mono m-live-card-h">
        <span className="m-glyph">▶</span> Onboarding
      </div>

      {/* Video / placeholder container */}
      <div
        className="m-onboarding-video-wrap"
        data-testid="onboarding-video-wrap"
        data-placeholder={isPlaceholder ? 'true' : undefined}
        role="region"
        aria-label="Onboarding tutorial video"
      >
        {isPlaceholder ? (
          /* Placeholder: gradient poster + "coming soon" affordance */
          <div className="m-onboarding-video-placeholder" data-testid="onboarding-video-placeholder">
            <div className="m-onboarding-video-play-icon" aria-hidden="true">▶</div>
            <p className="m-mono m-onboarding-video-label">Onboarding tutorial · coming soon</p>
          </div>
        ) : (
          /* Real video: native <video> with controls overlay */
          <>
            <video
              ref={videoRef}
              className="m-onboarding-video-el"
              data-testid="onboarding-video-el"
              src={videoSrc}
              poster={videoPoster || undefined}
              preload="metadata"
              playsInline
              onEnded={onEnded}
              onPause={onPause}
              onPlaying={onPlaying}
              aria-label="Onboarding tutorial"
            />
            {/* Custom play overlay — hidden once playing */}
            {!playing && (
              <button
                className="m-onboarding-video-play-btn"
                data-testid="onboarding-video-play-btn"
                onClick={handlePlay}
                aria-label="Play onboarding video"
              >
                <span className="m-onboarding-video-play-icon" aria-hidden="true">▶</span>
              </button>
            )}
          </>
        )}
      </div>

      <p className="m-live-card-body" style={{ marginTop: 10 }}>
        {isPlaceholder
          ? "A short walkthrough is on its way — it'll show you exactly how to get the most out of Cody and the swarm."
          : 'Watch how Cody builds and runs companies autonomously while you focus on what matters.'}
      </p>
    </div>
  )
}
