import { useEffect, useState } from 'react'
import type { UpdateState } from '@shared/api'

/** Floating notice once a new version has downloaded; nothing shows otherwise. */
export function UpdateBanner(): React.JSX.Element | null {
  const [state, setState] = useState<UpdateState>({ status: 'idle' })
  useEffect(() => {
    void window.hub.getUpdate().then(setState)
    return window.hub.onUpdate(setState)
  }, [])

  if (state.status !== 'ready') return null
  return (
    <div className="update-banner" role="status">
      <span>
        Version <b>{state.version}</b> is ready.
      </span>
      <button className="primary" onClick={() => void window.hub.installUpdate()}>
        Restart to update
      </button>
    </div>
  )
}
