import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Delivera — Performance-Based Contracting",
  description:
    "Escrow that releases itself. Payments unlock only when GenLayer validator consensus verifies the work was actually delivered.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.theme==='dark'||(!('theme' in localStorage)&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
