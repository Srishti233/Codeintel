import './globals.css';
import type { ReactNode } from 'react';

export const metadata = { title: 'CodeIntel', description: 'AI codebase intelligence, fully local' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
