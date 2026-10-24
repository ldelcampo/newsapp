import type { WeatherKind } from '@shared/widgets'

const CLOUD = 'M20 46h30a11 11 0 0 0 0-22 15 15 0 0 0-28.6-3.6A10 10 0 0 0 20 46Z'

function Sun(): React.JSX.Element {
  return (
    <g className="sun">
      <g className="rays">
        {Array.from({ length: 8 }, (_, i) => (
          <line key={i} x1="40" y1="8" x2="40" y2="14" transform={`rotate(${i * 45} 40 32)`} />
        ))}
      </g>
      <circle cx="40" cy="32" r="11" />
    </g>
  )
}

const Moon = (): React.JSX.Element => <path className="moon" d="M46 18a14 14 0 1 0 8 25 12 12 0 0 1-8-25Z" />

const Cloud = ({ className = 'cloud', dx = 0, dy = 0 }: { className?: string; dx?: number; dy?: number }): React.JSX.Element => (
  // The offset sits on a wrapper: a CSS animation on the path would override an SVG transform.
  <g transform={`translate(${dx} ${dy})`}>
    <path className={className} d={CLOUD} />
  </g>
)

/** Falling drops or flakes, spread across the cloud with staggered timing. */
function Fall({ kind, count }: { kind: 'drop' | 'flake'; count: number }): React.JSX.Element {
  return (
    <g>
      {Array.from({ length: count }, (_, i) => {
        const x = 24 + (i * 32) / Math.max(1, count - 1)
        const style = { animationDelay: `${(i * 0.37) % 1.2}s` } as React.CSSProperties
        return kind === 'drop' ? (
          <line key={i} className="drop" x1={x} y1="50" x2={x - 2} y2="56" style={style} />
        ) : (
          <circle key={i} className="flake" cx={x} cy="52" r="1.8" style={style} />
        )
      })}
    </g>
  )
}

/** A small animated picture of the current weather. Motion stops under reduced motion. */
export function WeatherScene({ kind, isDay }: { kind: WeatherKind; isDay: boolean }): React.JSX.Element {
  const sky = isDay ? <Sun /> : <Moon />
  return (
    <svg className={`scene scene-${kind}`} viewBox="0 0 80 64" role="img" aria-hidden="true">
      {kind === 'clear' && sky}
      {kind === 'partly' && (
        <>
          <g transform="translate(-8 -6)">{sky}</g>
          <Cloud dx={4} dy={4} />
        </>
      )}
      {kind === 'cloudy' && (
        <>
          <Cloud className="cloud back" dx={10} dy={-6} />
          <Cloud />
        </>
      )}
      {kind === 'fog' && (
        <>
          <Cloud dy={-6} />
          <g className="fog">
            <line x1="14" y1="48" x2="58" y2="48" />
            <line x1="22" y1="55" x2="66" y2="55" />
          </g>
        </>
      )}
      {(kind === 'drizzle' || kind === 'rain' || kind === 'storm') && (
        <>
          <Cloud dy={-8} />
          <Fall kind="drop" count={kind === 'drizzle' ? 3 : 5} />
        </>
      )}
      {kind === 'storm' && <path className="bolt" d="M40 38l-6 11h6l-4 10 10-13h-6l4-8Z" />}
      {kind === 'snow' && (
        <>
          <Cloud dy={-8} />
          <Fall kind="flake" count={5} />
        </>
      )}
    </svg>
  )
}
