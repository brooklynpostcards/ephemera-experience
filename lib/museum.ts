export const EXHIBITS = Object.freeze([
  '1_dollar_back.jpg', '1_dollar_monopoly_bill.jpg', '10_cents_ticket.jpg',
  '169_bar.jpg', '169_bar_receipt.jpg', '169_dry_cleaner.jpg', '299_price.jpg',
  '45_adapter_beige.jpg', '45_adapter_red_circles.jpg', '45_adapter_red_spin_2.jpg',
  '45_adapter_red_spin_4.jpg', '45_adapter_yellow_spin.jpg', '5_dollar_bill_rip.jpg',
  '5_papers_left.jpg', 'a_and_s_tag.jpg', 'A1_label.jpg', 'AA_coin.jpg',
  'abc_visitor.jpg', 'adidas_tag-(2).jpg', 'adidas_tag.jpg', 'admit_one.jpg',
  'amtrak_seat_check.jpg', 'angelica_ticket_stub.jpg', 'apple_computer_sticker_vintage.jpg',
  'apple_sticker_new.jpg', 'astor_barber_business_card.jpg', 'astoria_bank.jpg',
  'astro_land.jpg', 'atm_washington_ave.jpg', 'attention_yellow.jpg', 'b_and_h_ad.jpg',
  'b14_thing_back.jpg', 'bam_ticket.jpg', 'bam_ticket_front.jpg', 'bandaid_6.jpg',
  'bandaid_new.jpg', 'bandaid_see_thru.jpg', 'bar_code.jpg', 'barcode.jpg',
  'bart_transit_card.jpg', 'baseball_card_back.jpg', 'beer_coaster_rheingold.jpg',
  'bingo_purple__.jpg', 'bingo_red.jpg', 'blank_green_bread_tag.jpg', 'bline_card_subway.jpg',
  'blockbuster_id_card.jpg', 'blockbuster_receipt.jpg', 'blue_bracelet_.jpg',
  'blue_rubberband_produce.jpg', 'blue_shoe_repair.jpg', 'boiler_drain.jpg',
  'bottle_cap___-(2).jpg', 'bottle_cap___-(3).jpg', 'bottle_cap___-(4).jpg',
  'bottle_cap___-(5).jpg', 'bottle_cap___-(6).jpg', 'bottle_cap_green_back.jpg',
  'bottle_cap_old_english.jpg', 'bottle_cap_rc_cola.jpg', 'bottle_cap_reingold.jpg',
  'bottle_cap_reingold_back.jpg', 'bracelet_saturday.jpg', 'bread_tag_etc.jpg',
  'bread_tag_etc_green_tall.jpg', 'bread_tag_etc_red.jpg', 'bread_tag_etc_white.jpg',
  'bread_tag_etc_white_14.jpg', 'bread_tag_etc_white_2.jpg', 'L_late_night.jpg',
  'LIRR_souvenir.jpg', 'LIRR_zone_stub.jpg',
]);

export type Facing = 0 | 1 | 2 | 3;
export type Position = { depth: number; facing: Facing; seed: number };
export type Action = 'forward' | 'back' | 'left' | 'right';
export const INITIAL: Position = { depth: 0, facing: 0, seed: 21 };
export const FACES = ['North', 'East', 'South', 'West'] as const;
export const mod = (value: number, size: number) => ((value % size) + size) % size;

export function move(position: Position, action: Action): Position {
  if (action === 'forward' || action === 'back') {
    return { ...position, depth: position.depth + (action === 'forward' ? 1 : -1) };
  }
  return { ...position, facing: mod(position.facing + (action === 'right' ? 1 : -1), 4) as Facing };
}

export function titleFor(filename: string): string {
  return filename.replace(/\.jpg$/i, '').replace(/[_-]+/g, ' ').trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function describeRoom(position: Position) {
  const { depth, facing, seed } = position;
  const index = mod(mod(depth, EXHIBITS.length) * 35 + seed + facing * 18, EXHIBITS.length);
  const hash = Math.imul((depth ^ Math.imul(facing + 1, 2654435761) ^ seed) >>> 0, 2246822519) >>> 0;
  const filename = EXHIBITS[index];
  return {
    key: `${depth}:${facing}:${seed}`, depth, facing, index,
    src: `/exhibits/${encodeURIComponent(filename)}`, title: titleFor(filename),
    accent: ['#c74826', '#167889', '#9b7407'][hash % 3],
    fold: hash % 2 === 0 ? 'left' : 'right',
    number: `${depth < 0 ? '−' : ''}${String(Math.abs(depth) + 1).padStart(3, '0')}`,
  };
}

export type Room = ReturnType<typeof describeRoom>;

// Bounded recursion: the museum is always three descriptions, never an accumulated map.
export function buildWindow(position: Position, offset = -1): Array<Room & { offset: number }> {
  if (offset > 1) return [];
  return [
    { ...describeRoom({ ...position, depth: position.depth + offset }), offset },
    ...buildWindow(position, offset + 1),
  ];
}
