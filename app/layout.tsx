import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Schema-per-Branch Demo',
  description: 'Portable schema-per-branch preview deployments for Postgres + Vercel',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="auto">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
