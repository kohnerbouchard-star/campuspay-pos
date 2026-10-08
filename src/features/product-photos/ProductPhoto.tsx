"use client"
import { useState } from 'react'
import type { ProductPhoto as Photo } from './domain'
import { ProductCategoryIcon } from '@/components/ui/ProductCategoryIcon'
import styles from './photos.module.css'

export function ProductPhoto({ photo, name, category, variant = 'thumbnail', decorative = false }: {
  photo?: Photo | null; name: string; category: string; variant?: 'thumbnail' | 'catalog' | 'detail'; decorative?: boolean
}) {
  const url = variant === 'detail' ? photo?.url : photo?.thumbnail_url
  return <ImageSurface key={url ?? 'missing'} url={url} name={name} category={category} variant={variant} decorative={decorative}
    width={variant === 'detail' ? photo?.width : photo?.thumbnail_width} height={variant === 'detail' ? photo?.height : photo?.thumbnail_height}/>
}
function ImageSurface({ url, name, category, variant, decorative, width, height }: {
  url?: string; name: string; category: string; variant: string; decorative: boolean; width?: number; height?: number
}) {
  const [loaded, setLoaded] = useState(false), [failed, setFailed] = useState(false)
  return <span className={`${styles.image} ${styles[variant]}`} data-product-photo={failed ? 'failed' : !url ? 'missing' : loaded ? 'loaded' : 'loading'} aria-hidden={decorative || undefined}>
    {(!url || failed || !loaded) && <span className={styles.fallback} role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : `${name}: ${url && !failed ? 'photo loading' : failed ? 'photo unavailable' : 'no photo'}`}><ProductCategoryIcon category={category} size={32}/>{variant === 'detail' && <small>{url && !failed ? 'Loading photo…' : failed ? 'Photo unavailable' : 'No photo'}</small>}</span>}
    {/* Already re-encoded/resized by our server. Never proxy arbitrary remote URLs through an image optimizer. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {url && !failed && <img src={url} alt={decorative ? '' : `Photo of ${name}`} width={width} height={height} loading="lazy" decoding="async" referrerPolicy="no-referrer"
      className={loaded ? styles.loaded : styles.loading} onLoad={() => setLoaded(true)} onError={() => setFailed(true)}/>}
  </span>
}
