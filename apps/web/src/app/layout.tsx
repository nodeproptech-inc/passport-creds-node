import type { Metadata } from 'next';
import './globals.css';
import { PrivyAppProvider } from '@/providers/PrivyAppProvider';

export const metadata: Metadata = {
  title: 'PassportCreds by Node',
  description: 'White-label Compliance Passport for regulated access.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <PrivyAppProvider>{children}</PrivyAppProvider>
      </body>
    </html>
  );
}
