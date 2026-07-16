import type {Metadata} from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import Script from 'next/script';
import './globals.css'; // Global styles

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'Rastro - Telemetria Tática em Tempo Real',
  description: 'Sistema de rastreamento e telemetria tática em tempo real para coordenação de equipes.',
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="pt-BR" className={`${inter.variable} ${jetbrainsMono.variable} dark`}>
      <head>
        <link href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet" />
        <Script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js" strategy="beforeInteractive" />
      </head>
      <body suppressHydrationWarning className="bg-[#131313] text-[#e5e2e1] font-sans antialiased selection:bg-[#00ff41]/20 selection:text-[#00ff41]">
        {children}
      </body>
    </html>
  );
}
