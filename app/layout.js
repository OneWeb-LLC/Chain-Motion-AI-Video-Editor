import './globals.css';

export const metadata = {
  title: 'Frameforge — OWeb satellite video studio',
  description:
    'Scene-based AI video editor with ComfyUI, timeline continuity, Set Studio, and shared OneID.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
