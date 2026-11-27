import type { Metadata } from 'next';
import { Geist_Mono, JetBrains_Mono } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

const geistMono = Geist_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-geist-mono',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'ASCII Studio — Real-Time WebGL2 & Procedural ASCII Art',
  description:
    'Open-source client-side WebGL2 & Canvas 2D studio for real-time media-to-ASCII rendering and procedural generative ASCII art.',
  icons: {
    icon: '/icon.svg',
  },
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`dark ${geistMono.variable} ${jetbrainsMono.variable}`}
    >
      <body
        className={`${geistMono.variable} ${jetbrainsMono.variable} h-screen w-screen overflow-hidden bg-zinc-950 font-mono text-zinc-100 antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
