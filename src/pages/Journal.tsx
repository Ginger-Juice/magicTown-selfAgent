import BulletinHero from '@/components/journal/BulletinHero';
import Passport from '@/components/journal/Passport';
import TrailLedger from '@/components/journal/TrailLedger';
import TownCalendar from '@/components/journal/TownCalendar';
import PostcardWall from '@/components/journal/PostcardWall';
import ClosingStrip from '@/components/journal/ClosingStrip';

/**
 * The town journal (/journal) — journal.md:
 * bulletin-board hero · filterable passport index · visitor trail ·
 * town calendar · postcard wall · closing strip.
 */
export default function Journal() {
  return (
    <div className="-mt-[88px]">
      <BulletinHero />
      <Passport />
      <TrailLedger />
      <TownCalendar />
      <PostcardWall />
      <ClosingStrip />
    </div>
  );
}
