import Link from 'next/link';
import { FF_APP_ID } from '@/lib/ff/constants';

export const metadata = {
  title: 'Frameforge — OWeb satellite',
  description: 'Scene-based AI video studio with ComfyUI, shared OneID, and workspace context.',
};

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[#050505] text-white flex flex-col items-center justify-center px-6 text-center">
      <p className="text-xs tracking-[0.2em] text-white/40 uppercase">OWeb constellation</p>
      <h1 className="mt-4 text-4xl md:text-5xl font-black tracking-tight">Frameforge</h1>
      <p className="mt-4 max-w-xl text-white/60">
        Local-first scene editor for AI video — references, timeline, Set Studio, and ComfyUI
        generation. Sign in with the same OneID you use on OWeb.
      </p>
      <p className="mt-2 text-xs text-white/35">app_id: {FF_APP_ID}</p>
      <div className="mt-8 flex flex-wrap gap-3 justify-center">
        <Link
          href="/login"
          className="rounded-full bg-[#d9ff00] px-6 py-2.5 text-sm font-semibold text-black hover:bg-[#c4e600]"
        >
          Sign in
        </Link>
        <Link
          href="/studio"
          className="rounded-full border border-white/20 px-6 py-2.5 text-sm font-medium hover:border-white/40"
        >
          Open studio
        </Link>
      </div>
    </main>
  );
}
