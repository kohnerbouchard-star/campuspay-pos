import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import '@/app/globals.css'

export const metadata: Metadata = { title: 'MICA Money · CampusPay', description: 'MICA Money student store and staff operations' }
export default function RootLayout({children}:{children:ReactNode}){return <html lang="en"><body>{children}</body></html>}
