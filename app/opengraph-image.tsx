import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const alt = 'AINative Builder — Build production-ready React apps with AI in seconds'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          // Vibrant on-brand gradient (was a near-black gradient that read as a
          // "dreadful black default" when shared).
          background:
            'linear-gradient(135deg, #4f46e5 0%, #5867EF 40%, #7c3aed 75%, #a855f7 100%)',
          fontFamily: 'system-ui, sans-serif',
          padding: '72px',
          position: 'relative',
        }}
      >
        {/* soft glow accents */}
        <div style={{ position: 'absolute', top: -120, right: -80, width: 420, height: 420, borderRadius: 9999, background: 'rgba(255,255,255,0.12)', display: 'flex' }} />
        <div style={{ position: 'absolute', bottom: -160, left: -100, width: 460, height: 460, borderRadius: 9999, background: 'rgba(255,255,255,0.08)', display: 'flex' }} />

        {/* top row: logo + brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
          <div style={{ display: 'flex', width: 84, height: 84, borderRadius: 20, background: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="52" height="44" viewBox="0 0 100 85" fill="none">
              <path d="M19.8676 68.0037L32.1669 83.17C32.3171 83.3551 32.4375 83.5627 32.5512 83.7722C33.4124 85.3588 34.8373 85.4186 35.6263 83.8883C35.7713 83.607 35.8184 83.2872 35.8184 82.9708L35.8183 68.0037L19.8676 68.0037Z" fill="white"/>
              <path d="M73.6886 3.57796H82.2931C85.8061 3.57796 88.6539 6.42579 88.6539 9.93878V25.3821C88.6539 27.1918 89.4248 28.9158 90.7734 30.1225L96.2074 34.9845L90.7734 39.8465C89.4248 41.0532 88.6539 42.7772 88.6539 44.5869V59.2351C88.6539 62.7481 85.8061 65.596 82.2931 65.596H73.6886" stroke="white" strokeWidth="7.1413" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M59.7906 65.596L17.4922 65.596C13.9793 65.596 11.1314 62.7481 11.1314 59.2351L11.1314 43.7918C11.1314 41.9821 10.3606 40.2581 9.01197 39.0514L3.57796 34.1894L9.01197 29.3274C10.3606 28.1207 11.1314 26.3967 11.1314 24.587L11.1314 9.93879C11.1314 6.4258 13.9793 3.57796 17.4923 3.57796L59.7906 3.57797" stroke="white" strokeWidth="7.1413" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div style={{ fontSize: 40, fontWeight: 700, color: 'white', letterSpacing: -1 }}>AINative Builder</div>
        </div>

        {/* headline */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 76, fontWeight: 800, color: 'white', lineHeight: 1.05, letterSpacing: -2, marginBottom: 20 }}>
            Build React apps
            <br />with AI in seconds
          </div>
          <div style={{ fontSize: 30, color: 'rgba(255,255,255,0.9)', lineHeight: 1.3, maxWidth: 900 }}>
            Production-ready, fully-interactive apps from a prompt — persistent
            ZeroDB storage and AINative primitives built in.
          </div>
        </div>

        {/* bottom row: pills + url */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 14 }}>
            {['Claude Sonnet 4', 'ZeroDB', 'Agent-Native', 'SEO + AX'].map((f) => (
              <div key={f} style={{ display: 'flex', padding: '12px 22px', borderRadius: 9999, background: 'rgba(255,255,255,0.18)', color: 'white', fontSize: 20, fontWeight: 600 }}>
                {f}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', color: 'rgba(255,255,255,0.85)', fontSize: 22, fontWeight: 600 }}>builder.ainative.studio</div>
        </div>
      </div>
    ),
    { ...size },
  )
}
