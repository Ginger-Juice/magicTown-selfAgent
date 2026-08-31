import type { ReactNode } from 'react';
import { useLocation } from 'react-router';
import { useSmoothScroll } from '@/lib/smoothScroll';
import Navbar from './Navbar';
import Footer from './Footer';

/** Layout owns the offset for the fixed overlay navbar (react-dev.md contract). */
export const NAV_OFFSET = 88;

export default function Layout({ children }: { children: ReactNode }) {
  useSmoothScroll();
  const { pathname } = useLocation();
  const mapShell = pathname === '/';
  return (
    <div className="relative min-h-[100dvh] bg-cream">
      <Navbar />
      <main style={{ paddingTop: NAV_OFFSET }}>{children}</main>
      {mapShell ? null : <Footer />}
    </div>
  );
}
