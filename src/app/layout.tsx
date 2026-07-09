import './globals.css';
import { Suspense } from 'react';
import { Inter } from 'next/font/google';
import RootLayoutClient from '@/components/layout/RootLayoutClient';

const inter = Inter({ subsets: ['latin'] });

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <title>Neutara Technologies Ticketing</title>
        <meta name="description" content="Neutara Technologies Ticketing - Unified Support Platform" />
        <link rel="icon" type="image/png" href="/neutara-logo.png" />
      </head>
      <body className={`${inter.className} antialiased bg-gray-50 text-gray-900 min-h-screen overflow-x-hidden`}>
        <Suspense
          fallback={
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
              <div className="flex items-center justify-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-blue-500 animate-bounce" style={{animationDelay:'-0.3s'}} />
                <span className="h-2.5 w-2.5 rounded-full bg-blue-500 animate-bounce" style={{animationDelay:'-0.15s'}} />
                <span className="h-2.5 w-2.5 rounded-full bg-blue-500 animate-bounce" style={{animationDelay:'0s'}} />
              </div>
            </div>
          }
        >
          <RootLayoutClient>{children}</RootLayoutClient>
        </Suspense>
      </body>
    </html>
  );
}
