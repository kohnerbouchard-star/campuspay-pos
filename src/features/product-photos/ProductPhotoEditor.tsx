"use client"
import { useEffect, useId, useRef, useState } from 'react'
import { MAX_PHOTO_BYTES, type PhotoCrop } from './domain'
import { previewDimensions } from './preview'
import { ProductPhoto } from './ProductPhoto'
import { useProductPhoto } from './useProductPhoto'
import styles from './photos.module.css'

export function ProductPhotoEditor({ productId, name, category, userId, onChanged, onPendingChange }: {
  productId: string; name: string; category: string; userId: string; onChanged?: () => void; onPendingChange?: (pending: boolean) => void
}) {
  const photo = useProductPhoto(productId, userId, onChanged)
  const [file, setFile] = useState<File | null>(null), [preview, setPreview] = useState('')
  const [retryFile, setRetryFile] = useState<File | null>(null), [reading, setReading] = useState(false)
  const selection = useRef(0)
  const [reason, setReason] = useState(''), [validation, setValidation] = useState('')
  const [removeReview, setRemoveReview] = useState(false)
  const [crop, setCrop] = useState<PhotoCrop>({ mode: 'fit', x: 50, y: 50 })
  const inputId = useId()
  const dirty = reading || !!file || !!photo.reference || !!photo.busy && photo.busy !== 'loading' || removeReview
  const locked = !!photo.busy || !!photo.reference || photo.blocked || photo.disabled || !photo.snapshot
  const validReason = reason.trim().length >= 10 && reason.trim().length <= 500 && !/[\u0000-\u001f\u007f]/.test(reason)
  useEffect(() => {
    onPendingChange?.(dirty)
    return () => onPendingChange?.(false)
  }, [dirty, onPendingChange])
  useEffect(() => {
    if (!file) return
    const url = URL.createObjectURL(file)
    void Promise.resolve().then(() => setPreview(url))
    return () => URL.revokeObjectURL(url)
  }, [file])
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  useEffect(() => () => { selection.current++ }, [])
  useEffect(() => { if (photo.snapshot?.operation?.state === 'SAVED') void Promise.resolve().then(() => setRetryFile(null)) }, [photo.snapshot])
  async function choose(next: File | null) {
    const attempt = ++selection.current
    setReading(false); setRetryFile(null)
    setValidation(''); setPreview(''); setFile(null); setCrop({ mode: 'fit', x: 50, y: 50 })
    if (!next) return
    if (!next.size || next.size > MAX_PHOTO_BYTES) { setValidation('Choose an image no larger than 4 MB.'); return }
    if (next.type && !['image/jpeg', 'image/png', 'image/webp'].includes(next.type)) { setValidation('Choose a JPEG, PNG or WebP. SVG and other formats are not supported.'); return }
    setReading(true)
    try {
      previewDimensions(new Uint8Array(await next.arrayBuffer()))
      if (attempt === selection.current) setFile(next)
    } catch (error) { if (attempt === selection.current) setValidation(error instanceof Error ? error.message : 'The image header could not be read.') }
    finally { if (attempt === selection.current) setReading(false) }
  }
  const staged = photo.snapshot?.operation?.state === 'READY' ? photo.snapshot.operation.photo : null
  if (photo.disabled) return <section className={styles.editor} aria-label="Product photo"><h4>Product photo</h4><p className="muted">Product photos are not enabled. Product details can still be saved.</p></section>
  return <section className={styles.editor} aria-label="Product photo">
    <h4>Primary product photo</h4>
    <p className="muted">One public catalog image, shared by the POS and MICA Store. Product photos only—never student, staff or sensitive documents. Photo changes are saved separately from product details.</p>
    <div className={styles.previews}>
      <div className={styles.preview}><strong>Current photo</strong><ProductPhoto photo={photo.snapshot?.photo} name={name} category={category} variant="detail"/></div>
      {(file || staged) && <div className={styles.preview}><strong>New photo preview — not saved</strong>{staged ? <ProductPhoto photo={staged} name={`${name} (new preview)`} category={category} variant="detail"/> : preview && <span className={styles.local}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={preview} alt={`New photo preview of ${name}`} style={{ objectFit: crop.mode === 'square' ? 'cover' : 'contain', objectPosition: `${crop.x}% ${crop.y}%` }} onError={() => setValidation('The preview could not be displayed. Server validation will reject damaged or unsupported images.')}/>
      </span>}</div>}
    </div>
    <label className="field" htmlFor={inputId}><span>Choose product photo</span><input id={inputId} type="file" accept="image/jpeg,image/png,image/webp" disabled={locked} onChange={event => { void choose(event.target.files?.[0] ?? null); event.target.value = '' }} aria-describedby={`${inputId}-help`}/></label>
    <p id={`${inputId}-help`} className="muted">JPEG, PNG or WebP. Maximum 4 MB, 8192 pixels per side and 20 megapixels. Location and camera metadata are removed. Unvalidated originals are never published.</p>
    {reading && <p role="status">Checking image dimensions before preview…</p>}
    {file && !photo.reference && <div className={styles.crop}>
      <label className="field"><span>Photo crop</span><select value={crop.mode} disabled={locked} onChange={event => setCrop({ ...crop, mode: event.target.value as PhotoCrop['mode'] })}><option value="fit">Keep full image</option><option value="square">Crop to square</option></select></label>
      {crop.mode === 'square' && <><label className="field"><span>Crop horizontal position: {crop.x}%</span><input aria-label="Crop horizontal position" type="range" min={0} max={100} value={crop.x} disabled={locked} onChange={event => setCrop({ ...crop, x: Number(event.target.value) })}/></label><label className="field"><span>Crop vertical position: {crop.y}%</span><input aria-label="Crop vertical position" type="range" min={0} max={100} value={crop.y} disabled={locked} onChange={event => setCrop({ ...crop, y: Number(event.target.value) })}/></label></>}
    </div>}
    <label className="field"><span>Reason for photo change</span><input value={reason} maxLength={500} disabled={locked} onChange={event => setReason(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') event.preventDefault() }} placeholder="10–500 characters; do not enter personal information"/></label>
    {photo.busy === 'uploading' && <label className="field"><span>{photo.progress < 100 ? `Uploading photo: ${photo.progress}%` : 'Upload sent. Validating and storing photo…'}</span><progress max={100} value={photo.progress}/></label>}
    {photo.busy && photo.busy !== 'uploading' && <p role="status">{photo.busy === 'loading' ? 'Checking current photo status…' : photo.busy === 'saving' ? 'Saving photo change…' : photo.busy === 'removing' ? 'Removing current photo…' : 'Cancelling pending photo change…'}</p>}
    {(validation || photo.error) && <p role="alert" className="error-message">{validation || photo.error}</p>}
    {photo.notice && <p role="status" className="notice">{photo.notice}</p>}
    <div className={styles.actions}>
      {file && !photo.reference && <><button type="button" className="primary-action" disabled={locked || !validReason} onClick={() => { if (file) { setValidation(''); setRetryFile(file); photo.upload(file, reason.trim(), crop); setFile(null); setPreview('') } }}>Upload and validate photo</button><button type="button" className="secondary-action" disabled={!!photo.busy} onClick={() => { setFile(null); setPreview(''); setValidation('') }}>Discard selected photo</button></>}
      {retryFile && !file && !photo.reference && photo.snapshot?.operation?.state !== 'SAVED' && <button type="button" className="secondary-action" disabled={locked} onClick={() => { setValidation(''); setFile(retryFile); setRetryFile(null) }}>Retry selected photo</button>}
      {staged && <button type="button" className="primary-action" disabled={!!photo.busy || photo.uncertain} onClick={photo.save}>Save photo</button>}
      <button type="button" className="secondary-action" disabled={!!photo.busy} onClick={() => { setValidation(''); void photo.check() }}>Check photo status</button>
      {photo.reference && <button type="button" className="secondary-action" disabled={!!photo.busy && photo.busy !== 'uploading'} onClick={photo.cancel}>Cancel pending photo change</button>}
      {photo.snapshot?.photo && !photo.reference && !file && !removeReview && <button type="button" className="secondary-action" disabled={locked} onClick={() => setRemoveReview(true)}>Remove current photo</button>}
    </div>
    {removeReview && <div className="form-stack"><p>Remove only this photo? The product, stock, receipts and historical financial records are unchanged. A 10–500 character reason is required above.</p><div className={styles.actions}><button type="button" className="danger-action" disabled={locked || !validReason} onClick={() => { setRemoveReview(false); photo.remove(reason.trim()) }}>Confirm photo removal</button><button type="button" className="secondary-action" onClick={() => setRemoveReview(false)}>Keep current photo</button></div></div>}
  </section>
}
