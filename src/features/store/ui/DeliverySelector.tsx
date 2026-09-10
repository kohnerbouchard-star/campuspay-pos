'use client'
import { useState } from 'react'
import type { DeliveryLocation } from '@/features/store/domain'
import styles from './store.module.css'

export function DeliverySelector({ locations, value, onChange, disabled }: {
  locations: DeliveryLocation[]; value: string; onChange: (value: string) => void; disabled: boolean
}) {
  const first = locations.find((location) => location.location_id === value) ?? locations.find((location) => location.orderable)
  const [building, setBuilding] = useState(first?.building ?? '')
  const [floor, setFloor] = useState(first ? String(first.floor) : '')
  const buildings = [...new Set(locations.map((location) => location.building))]
  const floors = [...new Set(locations.filter((location) => location.building === building).map((location) => location.floor))]
  const rooms = locations.filter((location) => location.building === building && String(location.floor) === floor && location.orderable && location.room)
  return <fieldset className={styles.delivery} disabled={disabled}>
    <legend>Room delivery</legend>
    {!value && rooms.length > 0 && <p id="delivery-required" className={styles.notice}>Choose a room below to continue to order review.</p>}
    <div className={styles.deliveryGrid}>
      <label className={styles.field} htmlFor="delivery-building">Building<select id="delivery-building" value={building} onChange={(event) => {
        const next = event.target.value
        setBuilding(next); setFloor(String(locations.find((location) => location.building === next)?.floor ?? '')); onChange('')
      }}><option value="" disabled>Choose building</option>{buildings.map((name) => <option key={name}>{name}</option>)}</select></label>
      <label className={styles.field} htmlFor="delivery-floor">Floor<select id="delivery-floor" value={floor} onChange={(event) => { setFloor(event.target.value); onChange('') }}><option value="" disabled>Choose floor</option>{floors.map((number) => <option key={number} value={number}>Floor {number}</option>)}</select></label>
    </div>
    <label className={styles.field} htmlFor="delivery-room">Room<select id="delivery-room" aria-describedby={!value && rooms.length > 0 ? "delivery-required" : undefined} required value={value} disabled={disabled || rooms.length === 0} onChange={(event) => onChange(event.target.value)}><option value="">Choose a room</option>{rooms.map((room) => <option key={room.location_id} value={room.location_id}>Room {room.room}</option>)}</select></label>
    {rooms.length === 0 && <p className={styles.notice} role="status">Rooms on this floor are not available for delivery yet. Choose another building or floor.</p>}
  </fieldset>
}
