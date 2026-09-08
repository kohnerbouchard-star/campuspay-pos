import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import '@/app/globals.css'
import { connection } from 'next/server'

export const metadata: Metadata = { title: 'MICA Money · CampusPay', description: 'MICA Money student store and staff operations' }
export default async function RootLayout({children}:{children:ReactNode}) {
  await connection()
  return <html lang="en"><body>{children}</body></html>
}
