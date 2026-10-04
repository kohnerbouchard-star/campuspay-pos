import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import '@/app/globals.css'
import '@/app/usability.css'
import { connection } from 'next/server'

export const metadata: Metadata = { title: 'CampusPay · MICA Store', description: 'MICA Store and campus staff operations, powered by MICA Money.' }
export default async function RootLayout({children}:{children:ReactNode}) {
  await connection()
  return <html lang="en"><body>{children}</body></html>
}
