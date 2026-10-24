const PATHS: Record<string, string> = {
  dashboard: 'M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6v-9h-6v9Zm0-16v5h6V4h-6Z',
  mail: 'M4 6h16v12H4V6Zm0 0 8 7 8-7',
  calendar: 'M5 5h14v15H5V5Zm0 5h14M9 3v4m6-4v4',
  news: 'M5 5h11v14H6a1 1 0 0 1-1-1V5Zm11 4h3v9a1 1 0 0 1-1 1h-2M8 9h5M8 13h5M8 16h3',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7.5 7.5 0 0 0-2-1.2L14.6 3h-4l-.4 2.6a7.5 7.5 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5a7.4 7.4 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-.9a7.5 7.5 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7.5 7.5 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6',
  arrow: 'M5 12h14m-5-5 5 5-5 5',
  left: 'm14 6-6 6 6 6',
  right: 'm10 6 6 6-6 6',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6 6 18',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  edit: 'M4 20h4L19 9l-4-4L4 16v4Zm9-13 4 4',
  check: 'm5 12 5 5 9-10',
  stories: 'M5 5h11v14H6a1 1 0 0 1-1-1V5Zm11 4h3v9a1 1 0 0 1-1 1h-2M8 9h5M8 13h5M8 16h3',
  stats: 'M5 19V11m7 8V5m7 14v-6',
  currency: 'M12 3v18m4-14.5C15 5.5 13.6 5 12 5c-2.2 0-4 1.1-4 3s1.8 2.6 4 3 4 1.1 4 3-1.8 3-4 3c-1.7 0-3.2-.6-4-1.6',
  weather: 'M12 3v2m0 14v2M5.6 5.6l1.4 1.4m10 10 1.4 1.4M3 12h2m14 0h2M5.6 18.4 7 17M17 7l1.4-1.4M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  clocks: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v4l3 2',
  work: 'M4 8h16v11H4V8Zm5 0V5h6v3M4 13h16',
  tickets: 'M4 8h16v11H4V8Zm5 0V5h6v3M4 13h16',
  meetings: 'M5 5h14v15H5V5Zm0 5h14M9 3v4m6-4v4'
}

export function Icon({ name, className }: { name: keyof typeof PATHS | string; className?: string }): React.JSX.Element {
  return (
    <svg className={`icon ${className ?? ''}`} viewBox="0 0 24 24" aria-hidden="true">
      <path d={PATHS[name]} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
