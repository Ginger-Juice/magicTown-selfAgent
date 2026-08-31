import DebugMap from '@/components/DebugMap';

/** Debug shell: painted map only. Login / agents stay available for API work. */
export default function Home() {
  return (
    <div className="-mt-[88px]">
      <DebugMap />
    </div>
  );
}
