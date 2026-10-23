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
    parsed.searchParams.set('playsinline', 'true')
    return parsed.toString()
  } catch {
    return undefined
  }
}

export function CameraPreview({ url }: Props) {
  const src = playerUrl(url)

  return (
    <div className="preview-frame">
      {src ? (
        <iframe
          className="size-full border-0"
          src={src}
          title="Broadcast preview"
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
        />
      ) : (
        <div
          className="text-muted flex size-full items-center justify-center p-6 text-center text-sm"
          role="status"
        >
          Picture unavailable. Ask the operator to check the camera preview.
        </div>
      )}
    </div>
  )
}
