interface Props {
  url: string | undefined
}

function playerUrl(url: string | undefined) {
  if (!url) return undefined

  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
      return undefined
    parsed.searchParams.set('autoplay', 'true')
    parsed.searchParams.set('muted', 'true')
    parsed.searchParams.set('playsInline', 'true')
    return parsed.toString()
  } catch {
    return undefined
  }
}

export function CameraPreview({ url }: Props) {
  const src = playerUrl(url)

  return (
    <div className="mt-5 aspect-video overflow-hidden rounded-xl border border-slate-500 bg-slate-950/40">
      {src ? (
        <iframe
          className="size-full border-0"
          src={src}
          title="Live OBS program preview"
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
        />
      ) : (
        <div
          className="flex size-full items-center justify-center p-6 text-center text-sm text-slate-300"
          role="status"
        >
          Preview unavailable. Configure a valid MediaMTX WebRTC preview URL.
        </div>
      )}
    </div>
  )
}
