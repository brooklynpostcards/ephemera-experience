import type { Metadata } from 'next';
import './globals.css';
import './museum.css';

export const metadata: Metadata = {
  title: 'Ephemera | The Paper Museum',
  description: 'Walk through an unfolding paper museum of found objects. Seventy-two things kept, one room at a time.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
