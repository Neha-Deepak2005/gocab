import "leaflet/dist/leaflet.css";
import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Toaster } from "react-hot-toast";
import Navbar from "@/components/Navbar";
import { AuthProvider } from "@/lib/auth";

export const metadata: Metadata = {
  title: "GoCab – Book rides in seconds",
  description: "Book bikes, autos and cabs with live tracking, wallet, promo codes and instant receipts.",
};
export const viewport: Viewport = { themeColor: "#7c3aed", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
        <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🚕</text></svg>" />
      </head>
      <body className="min-h-screen font-sans antialiased">
        <AuthProvider>
          <Navbar />
          <main>{children}</main>
          <Toaster position="top-center" toastOptions={{ style: { borderRadius: "16px", fontWeight: 600 } }} />
        </AuthProvider>
      </body>
    </html>
  );
}
