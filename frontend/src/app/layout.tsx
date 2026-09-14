import type { Metadata } from "next";
import "./globals.css";
import { AppKitProvider } from "@/components/AppKitProvider";

export const metadata: Metadata = {
  title: "Delivera — Performance-Based Contracting",
  description:
    "Escrow that releases itself. Payments unlock only when GenLayer validator consensus verifies the work was actually delivered.",
  icons: {
    icon: "/icon.svg",
  },
};

export const viewport = {
  themeColor: "#3525CD",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html className="light" lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap"
          rel="stylesheet"
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.theme==='dark'||(!('theme' in localStorage)&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}`,
          }}
        />
      </head>
      <body className="font-sans">
        <AppKitProvider>{children}</AppKitProvider>
      </body>
    </html>
  );
}
