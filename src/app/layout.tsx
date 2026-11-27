import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'ASCII Studio — Real-Time WebGL2 & Procedural ASCII Art',
  description:
    'Open-source client-side WebGL2 & Canvas 2D studio for real-time media-to-ASCII rendering and procedural generative ASCII art.',
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="h-screen w-screen overflow-hidden bg-zinc-950 text-zinc-100 antialiased">
        {children}
      </body>
    </html>
  );
}
