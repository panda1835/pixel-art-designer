import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { site } from "@/lib/site";
import "./globals.css";

const geistSans = Geist({
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  applicationName: site.name,
  title: site.title,
  description: site.description,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "/",
    siteName: site.name,
    title: site.title,
    description: site.description,
  },
  twitter: {
    card: "summary_large_image",
    title: site.title,
    description: site.description,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.className} h-full antialiased`}
    >
      <body suppressHydrationWarning className="m-0 min-h-full bg-[#ebe5d8] bg-[radial-gradient(circle_at_top_left,#fef9c3_0%,transparent_48%),radial-gradient(circle_at_bottom_right,#bfdbfe_0%,transparent_42%)] text-[#1c1917]">
        {children}
      </body>
    </html>
  );
}
