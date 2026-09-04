import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import '@/app/globals.css'

export const metadata: Metadata = { title: 'CampusPay', description: 'School RFID/NFC wallet point of sale' }
export default function RootLayout({children}:{children:ReactNode}){return <html lang="en"><body>{children}</body></html>}
